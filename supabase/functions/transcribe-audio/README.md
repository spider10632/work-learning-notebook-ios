# transcribe-audio (Supabase Edge Function)

This function securely proxies audio transcription requests so API keys are not exposed in the frontend.

## Required secrets

Set these in Supabase Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRANSCRIBE_API_KEY` (your OpenAI-compatible STT provider key)

Optional:

- `TRANSCRIBE_API_URL` (default: `https://api.groq.com/openai/v1/audio/transcriptions`)
- `TRANSCRIBE_MODEL` (default: `whisper-large-v3-turbo`)

## Deploy

```bash
supabase functions deploy transcribe-audio
```

## Request body

```json
{
  "path": "USER_ID/NOTE_ID/record-xxx.webm",
  "bucket": "note-audio",
  "langMode": "mixed-zh-en"
}
```

## Response

```json
{
  "text": "transcribed text"
}
```
