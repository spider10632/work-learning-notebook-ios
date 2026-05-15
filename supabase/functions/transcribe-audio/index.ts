import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function resolveLanguage(langMode: string) {
  if (langMode === "en-US") return "en";
  return "zh";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const transcribeApiUrl =
    Deno.env.get("TRANSCRIBE_API_URL") ?? "https://api.groq.com/openai/v1/audio/transcriptions";
  const transcribeApiKey = Deno.env.get("TRANSCRIBE_API_KEY") ?? "";
  const transcribeModel = Deno.env.get("TRANSCRIBE_MODEL") ?? "whisper-large-v3-turbo";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse({ error: "Supabase environment is not configured." }, 500);
  }
  if (!transcribeApiKey) {
    return jsonResponse({ error: "TRANSCRIBE_API_KEY is missing." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header." }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Unauthorized user." }, 401);
  }

  let body: { path?: string; bucket?: string; langMode?: string };
  try {
    body = (await req.json()) as { path?: string; bucket?: string; langMode?: string };
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const path = String(body.path || "");
  const bucket = String(body.bucket || "note-audio");
  const langMode = String(body.langMode || "mixed-zh-en");

  if (!path) {
    return jsonResponse({ error: "Missing audio path." }, 400);
  }

  if (!path.startsWith(`${user.id}/`)) {
    return jsonResponse({ error: "Path is not allowed for this user." }, 403);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: audioBlob, error: downloadError } = await serviceClient.storage.from(bucket).download(path);
  if (downloadError || !audioBlob) {
    return jsonResponse({ error: `Download failed: ${downloadError?.message || "unknown error"}` }, 400);
  }

  const fileNameFromPath = path.split("/").pop() || `record-${Date.now()}.webm`;
  const formData = new FormData();
  formData.append("file", new File([audioBlob], fileNameFromPath, { type: audioBlob.type || "audio/webm" }));
  formData.append("model", transcribeModel);
  formData.append("language", resolveLanguage(langMode));
  formData.append("temperature", "0");

  const transcribeResponse = await fetch(transcribeApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${transcribeApiKey}`
    },
    body: formData
  });

  let responseJson: Record<string, unknown> = {};
  try {
    responseJson = (await transcribeResponse.json()) as Record<string, unknown>;
  } catch (_error) {
    responseJson = {};
  }

  if (!transcribeResponse.ok) {
    return jsonResponse(
      {
        error:
          String(responseJson.error || responseJson.message || `Transcribe API failed (${transcribeResponse.status})`)
      },
      502
    );
  }

  const text = String(responseJson.text || "").trim();
  return jsonResponse({ text });
});
