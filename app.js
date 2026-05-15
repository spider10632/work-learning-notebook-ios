"use strict";

/*
 * Personal Work Learning Notebook
 * iOS optimized cloud MVP: Supabase + PWA + IndexedDB offline sync
 */

const SUPABASE_URL = "https://zsskayqfhceyghjocgdw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4FvasKv9EkNxtvtaY1tqow_kemJEm4n";
const STORAGE_BUCKET = "note-attachments";

const STORAGE_KEYS = {
  legacy: "pwl_notes_v1",
  prefs: "pwl_prefs_v1",
  migrationPrefix: "pwl_cloud_migrated_"
};

const DB_NAME = "pwl_notebook_db";
const DB_VERSION = 1;
const MAX_ATTACHMENTS = 3;
const SIGNED_URL_TTL_SECONDS = 600;
const SEARCH_COLLAPSE_SCROLL_Y = 80;
const OFFLINE_BLOB_PREFIX = "offline-blob:";
const SPEECH_MODE_MIXED = "mixed-zh-en";
const SUPPORTED_SPEECH_MODES = [SPEECH_MODE_MIXED, "zh-TW", "en-US"];
const MIXED_GLOSSARY = [
  { pattern: /\bcheck[\s-]?in\b/gi, replacement: "Check-in" },
  { pattern: /\bcheck[\s-]?out\b/gi, replacement: "Check-out" },
  { pattern: /\blate[\s-]?check[\s-]?out\b/gi, replacement: "Late Check-out" },
  { pattern: /\bearly[\s-]?check[\s-]?in\b/gi, replacement: "Early Check-in" },
  { pattern: /\bwalk[\s-]?in\b/gi, replacement: "Walk-in" },
  { pattern: /\bno[\s-]?show\b/gi, replacement: "No-show" },
  { pattern: /\bupgrade\b/gi, replacement: "Upgrade" },
  { pattern: /\bconcierge\b/gi, replacement: "Concierge" },
  { pattern: /\bfront[\s-]?desk\b/gi, replacement: "Front Desk" },
  { pattern: /\bfolio\b/gi, replacement: "Folio" },
  { pattern: /\brate[\s-]?code\b/gi, replacement: "Rate Code" },
  { pattern: /\bvip\b/g, replacement: "VIP" },
  { pattern: /\bihg\b/g, replacement: "IHG" },
  { pattern: /\bpms\b/g, replacement: "PMS" }
];

const CATEGORIES = [
  "SOP",
  "System",
  "Guest Handling",
  "Language",
  "Quick Access",
  "Training",
  "Other"
];

let supabaseClient = null;
let dbPromise = null;

const state = {
  user: null,
  notes: [],
  filteredNotes: [],
  signedUrlCache: new Map(),
  editingId: null,
  editorExistingAttachments: [],
  editorNewFiles: [],
  editorPreviewUrls: [],
  speechRecognition: null,
  listening: false,
  toastTimer: null,
  scrollingLastY: 0,
  authListenerBound: false,
  syncInProgress: false,
  pendingOpsCount: 0,
  conflictsCount: 0,
  lastSyncAt: null,
  isOnline: navigator.onLine,
  idbReady: false,
  activeConflict: null
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    showToast("初始化失敗，請重新整理頁面。");
  });
});

async function init() {
  cacheElements();
  populateCategorySelects();
  loadPrefs();
  bindEvents();
  setupScrollCollapse();
  setupSpeechRecognition();
  showAuthErrorFromHashIfAny();
  await registerServiceWorker();

  await initIndexedDb();
  updateSyncStatusUI();

  initSupabaseClient();
  if (!supabaseClient) {
    toggleConfigNotice(true);
    setSignedInUI(false);
    return;
  }

  toggleConfigNotice(false);
  await bootstrapAuth();
}

function cacheElements() {
  refs.cloudActions = byId("cloudActions");
  refs.supabaseConfigNotice = byId("supabaseConfigNotice");
  refs.signedOutView = byId("signedOutView");
  refs.signedInView = byId("signedInView");
  refs.userEmail = byId("userEmail");

  refs.syncPanel = byId("syncPanel");
  refs.networkDot = byId("networkDot");
  refs.networkStatusText = byId("networkStatusText");
  refs.syncStatusText = byId("syncStatusText");
  refs.syncNowBtn = byId("syncNowBtn");
  refs.conflictQueueBtn = byId("conflictQueueBtn");

  refs.searchContainer = byId("searchContainer");
  refs.searchInput = byId("searchInput");
  refs.categoryFilter = byId("categoryFilter");
  refs.resultCount = byId("resultCount");
  refs.pendingCountText = byId("pendingCountText");
  refs.kpiGrid = byId("kpiGrid");
  refs.statTotalNotes = byId("statTotalNotes");
  refs.statFavoriteNotes = byId("statFavoriteNotes");
  refs.statPendingOps = byId("statPendingOps");
  refs.statConflicts = byId("statConflicts");

  refs.notesMain = byId("notesMain");
  refs.notesList = byId("notesList");
  refs.emptyState = byId("emptyState");
  refs.fabAdd = byId("fabAdd");
  refs.quickNav = byId("quickNav");
  refs.navSearchBtn = byId("navSearchBtn");
  refs.navAddBtn = byId("navAddBtn");
  refs.navSyncBtn = byId("navSyncBtn");

  refs.loginBtn = byId("loginBtn");
  refs.logoutBtn = byId("logoutBtn");
  refs.exportBtn = byId("exportBtn");
  refs.importInput = byId("importInput");

  refs.editorOverlay = byId("editorOverlay");
  refs.editorTitle = byId("editorTitle");
  refs.closeEditorBtn = byId("closeEditorBtn");
  refs.noteForm = byId("noteForm");
  refs.noteId = byId("noteId");
  refs.titleInput = byId("titleInput");
  refs.categoryInput = byId("categoryInput");
  refs.tagsInput = byId("tagsInput");
  refs.favoriteInput = byId("favoriteInput");
  refs.contentInput = byId("contentInput");
  refs.speechLangSelect = byId("speechLangSelect");
  refs.speechBtn = byId("speechBtn");
  refs.speechHint = byId("speechHint");
  refs.pickPhotoBtn = byId("pickPhotoBtn");
  refs.takePhotoBtn = byId("takePhotoBtn");
  refs.attachmentsInput = byId("attachmentsInput");
  refs.cameraInput = byId("cameraInput");
  refs.attachmentPreview = byId("attachmentPreview");
  refs.createdAtText = byId("createdAtText");
  refs.updatedAtText = byId("updatedAtText");
  refs.cancelBtn = byId("cancelBtn");
  refs.saveBtn = byId("saveBtn");

  refs.imageModal = byId("imageModal");
  refs.imagePreview = byId("imagePreview");
  refs.closeImageModalBtn = byId("closeImageModalBtn");

  refs.importModeModal = byId("importModeModal");
  refs.importOverwriteBtn = byId("importOverwriteBtn");
  refs.importMergeBtn = byId("importMergeBtn");
  refs.importCancelBtn = byId("importCancelBtn");

  refs.migrationModal = byId("migrationModal");
  refs.migrationMergeBtn = byId("migrationMergeBtn");
  refs.migrationOverwriteBtn = byId("migrationOverwriteBtn");
  refs.migrationIgnoreBtn = byId("migrationIgnoreBtn");

  refs.conflictModal = byId("conflictModal");
  refs.conflictTitleText = byId("conflictTitleText");
  refs.conflictLocalMeta = byId("conflictLocalMeta");
  refs.conflictRemoteMeta = byId("conflictRemoteMeta");
  refs.conflictLocalContent = byId("conflictLocalContent");
  refs.conflictRemoteContent = byId("conflictRemoteContent");
  refs.conflictKeepLocalBtn = byId("conflictKeepLocalBtn");
  refs.conflictKeepRemoteBtn = byId("conflictKeepRemoteBtn");
  refs.conflictKeepBothBtn = byId("conflictKeepBothBtn");

  refs.toast = byId("toast");
}

function bindEvents() {
  refs.loginBtn.addEventListener("click", handleLogin);
  refs.logoutBtn.addEventListener("click", handleLogout);
  refs.searchInput.addEventListener("input", applyFiltersAndRender);
  refs.categoryFilter.addEventListener("change", applyFiltersAndRender);
  refs.fabAdd.addEventListener("click", () => openEditor());
  refs.closeEditorBtn.addEventListener("click", closeEditor);
  refs.cancelBtn.addEventListener("click", closeEditor);
  refs.noteForm.addEventListener("submit", handleSaveNote);
  refs.exportBtn.addEventListener("click", handleExportJson);
  refs.importInput.addEventListener("change", handleImportFileSelect);

  refs.pickPhotoBtn.addEventListener("click", () => refs.attachmentsInput.click());
  refs.takePhotoBtn.addEventListener("click", () => refs.cameraInput.click());
  refs.attachmentsInput.addEventListener("change", handleAttachmentFilePick);
  refs.cameraInput.addEventListener("change", handleAttachmentFilePick);
  refs.attachmentPreview.addEventListener("click", handleAttachmentPreviewClick);

  refs.speechBtn.addEventListener("click", toggleSpeechInput);
  refs.syncNowBtn.addEventListener("click", handleManualSync);
  refs.conflictQueueBtn.addEventListener("click", openConflictFromQueue);
  refs.navSearchBtn.addEventListener("click", focusSearchInput);
  refs.navAddBtn.addEventListener("click", () => openEditor());
  refs.navSyncBtn.addEventListener("click", handleManualSync);

  refs.closeImageModalBtn.addEventListener("click", closeImagePreview);
  refs.imageModal.addEventListener("click", (event) => {
    if (event.target === refs.imageModal) closeImagePreview();
  });
  refs.editorOverlay.addEventListener("click", (event) => {
    if (event.target === refs.editorOverlay) closeEditor();
  });

  refs.importOverwriteBtn.addEventListener("click", () => resolveImportMode("overwrite"));
  refs.importMergeBtn.addEventListener("click", () => resolveImportMode("merge"));
  refs.importCancelBtn.addEventListener("click", () => resolveImportMode("cancel"));

  refs.migrationMergeBtn.addEventListener("click", () => resolveMigrationAction("merge"));
  refs.migrationOverwriteBtn.addEventListener("click", () => resolveMigrationAction("overwrite"));
  refs.migrationIgnoreBtn.addEventListener("click", () => resolveMigrationAction("ignore"));

  refs.conflictKeepLocalBtn.addEventListener("click", () => resolveConflict("local"));
  refs.conflictKeepRemoteBtn.addEventListener("click", () => resolveConflict("remote"));
  refs.conflictKeepBothBtn.addEventListener("click", () => resolveConflict("both"));

  window.addEventListener("online", handleOnlineStateChange);
  window.addEventListener("offline", handleOnlineStateChange);
}

function setupScrollCollapse() {
  state.scrollingLastY = window.scrollY || 0;
  window.addEventListener(
    "scroll",
    () => {
      if (refs.searchContainer.classList.contains("hidden")) return;
      const y = window.scrollY || 0;
      const isDown = y > state.scrollingLastY;
      const shouldCollapse = isDown && y > SEARCH_COLLAPSE_SCROLL_Y;
      refs.searchContainer.classList.toggle("collapsed", shouldCollapse);
      state.scrollingLastY = y;
    },
    { passive: true }
  );
}

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    refs.speechHint.textContent = "此瀏覽器不支援語音辨識，可改用手機鍵盤語音輸入。";
    refs.speechBtn.disabled = true;
    return;
  }

  const recognition = new Recognition();
  recognition.lang = getRecognitionLangFromMode(getPreferredSpeechLang());
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    state.listening = true;
    refs.speechBtn.textContent = "停止語音輸入";
    refs.speechHint.textContent = "語音辨識中...";
  };

  recognition.onend = () => {
    state.listening = false;
    refs.speechBtn.textContent = "開始語音輸入";
    if (!refs.speechHint.textContent.includes("失敗")) {
      applySpeechModeHint(refs.speechLangSelect.value);
    }
  };

  recognition.onerror = () => {
    state.listening = false;
    refs.speechBtn.textContent = "開始語音輸入";
    refs.speechHint.textContent = "語音辨識失敗，請改用手動輸入或重試。";
  };

  recognition.onresult = (event) => {
    const mode = refs.speechLangSelect.value;
    const transcript = pickSpeechTranscript(event, mode);
    if (!transcript) return;
    const normalizedTranscript = normalizeSpeechTranscript(transcript, mode);
    const current = refs.contentInput.value.trim();
    refs.contentInput.value = current ? `${current}\n${normalizedTranscript}` : normalizedTranscript;
    refs.speechHint.textContent =
      mode === SPEECH_MODE_MIXED ? "已加入語音文字（混合模式已優化常見英文術語）。" : "已加入語音文字。";
  };

  refs.speechLangSelect.addEventListener("change", () => {
    const mode = refs.speechLangSelect.value;
    recognition.lang = getRecognitionLangFromMode(mode);
    recognition.maxAlternatives = mode === SPEECH_MODE_MIXED ? 4 : 2;
    if (!state.listening) {
      applySpeechModeHint(mode);
    }
    savePrefs();
  });

  applySpeechModeHint(refs.speechLangSelect.value);
  state.speechRecognition = recognition;
}

function toggleSpeechInput() {
  if (!state.speechRecognition) return;
  if (state.listening) {
    state.speechRecognition.stop();
    return;
  }
  const mode = refs.speechLangSelect.value;
  state.speechRecognition.lang = getRecognitionLangFromMode(mode);
  state.speechRecognition.maxAlternatives = mode === SPEECH_MODE_MIXED ? 4 : 2;
  state.speechRecognition.start();
}

function getRecognitionLangFromMode(mode) {
  return mode === SPEECH_MODE_MIXED ? "zh-TW" : mode || "zh-TW";
}

function applySpeechModeHint(mode) {
  if (mode === SPEECH_MODE_MIXED) {
    refs.speechHint.textContent = "混合模式：中文為主，會優先保留 Check-in / Upgrade / PMS 等英文術語。";
    return;
  }
  refs.speechHint.textContent = "可將結果直接加入內容欄位。";
}

function pickSpeechTranscript(event, mode) {
  const result = event.results?.[event.resultIndex ?? 0] || event.results?.[0];
  if (!result || !result.length) return "";

  if (mode !== SPEECH_MODE_MIXED) {
    return String(result[0]?.transcript || "").trim();
  }

  let bestTranscript = "";
  let bestScore = -Infinity;
  for (const alternative of result) {
    const candidate = String(alternative?.transcript || "").trim();
    if (!candidate) continue;
    const score = scoreSpeechAlternative(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestTranscript = candidate;
    }
  }
  return bestTranscript;
}

function scoreSpeechAlternative(text) {
  const candidate = text.toLowerCase();
  let score = (candidate.match(/[a-z]/g) || []).length * 0.6;
  const keywordBoosts = [
    "check in",
    "check out",
    "upgrade",
    "concierge",
    "front desk",
    "guest",
    "folio",
    "rate code",
    "pms",
    "ihg"
  ];
  for (const keyword of keywordBoosts) {
    if (candidate.includes(keyword)) score += 6;
  }
  return score;
}

function normalizeSpeechTranscript(rawText, mode) {
  let normalized = String(rawText || "")
    .replace(/[。]/g, "。 ")
    .replace(/[，]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  if (mode === SPEECH_MODE_MIXED) {
    for (const item of MIXED_GLOSSARY) {
      normalized = normalized.replace(item.pattern, item.replacement);
    }
  }
  return normalized;
}

function populateCategorySelects() {
  const options = CATEGORIES.map((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    return option;
  });

  for (const option of options) {
    refs.categoryInput.appendChild(option.cloneNode(true));
    refs.categoryFilter.appendChild(option.cloneNode(true));
  }

  refs.categoryInput.value = CATEGORIES[0];
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker register failed", error);
  }
}

async function initIndexedDb() {
  if (!("indexedDB" in window)) {
    state.idbReady = false;
    showToast("此瀏覽器不支援 IndexedDB，離線功能將受限。");
    return;
  }

  try {
    dbPromise = openDb();
    await dbPromise;
    state.idbReady = true;
  } catch (error) {
    console.error(error);
    state.idbReady = false;
    showToast("離線資料庫初始化失敗。");
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes_cache")) {
        const store = db.createObjectStore("notes_cache", { keyPath: "cacheKey" });
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains("pending_ops")) {
        const store = db.createObjectStore("pending_ops", { keyPath: "opId" });
        store.createIndex("userId", "userId", { unique: false });
        store.createIndex("noteId", "noteId", { unique: false });
      }
      if (!db.objectStoreNames.contains("pending_blobs")) {
        const store = db.createObjectStore("pending_blobs", { keyPath: "blobId" });
        store.createIndex("userId", "userId", { unique: false });
        store.createIndex("noteId", "noteId", { unique: false });
      }
      if (!db.objectStoreNames.contains("conflicts")) {
        const store = db.createObjectStore("conflicts", { keyPath: "conflictId" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

function initSupabaseClient() {
  const hasValidConfig =
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

  if (!hasValidConfig || !window.supabase?.createClient) {
    supabaseClient = null;
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function bootstrapAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error(error);
    showToast("讀取登入狀態失敗。");
  }

  await applySession(data?.session || null);

  if (!state.authListenerBound) {
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      await applySession(session || null);
    });
    state.authListenerBound = true;
  }
}

async function applySession(session) {
  const user = session?.user || null;
  state.user = user;
  setSignedInUI(Boolean(user));

  if (!user) {
    state.notes = [];
    state.filteredNotes = [];
    state.signedUrlCache.clear();
    renderNotes();
    closeEditor();
    await refreshQueueIndicators();
    return;
  }

  refs.userEmail.textContent = user.email || user.id;

  await loadCachedNotesForUser(user.id);
  applyFiltersAndRender();
  await refreshQueueIndicators();

  if (state.isOnline) {
    await refreshNotesFromCloud();
    await maybeRunLegacyMigration();
    await processSyncQueue();
  } else {
    showToast("目前離線，將使用本機資料。");
  }
}

function setSignedInUI(isSignedIn) {
  refs.signedOutView.classList.toggle("hidden", isSignedIn);
  refs.signedInView.classList.toggle("hidden", !isSignedIn);
  refs.searchContainer.classList.toggle("hidden", !isSignedIn);
  refs.kpiGrid.classList.toggle("hidden", !isSignedIn);
  refs.notesMain.classList.toggle("hidden", !isSignedIn);
  refs.fabAdd.classList.toggle("hidden", !isSignedIn);
  refs.quickNav.classList.toggle("hidden", !isSignedIn);
  refs.cloudActions.classList.toggle("hidden", !isSignedIn);
  refs.syncPanel.classList.toggle("hidden", !isSignedIn);
}

function toggleConfigNotice(visible) {
  refs.supabaseConfigNotice.classList.toggle("hidden", !visible);
}

async function handleLogin() {
  if (!supabaseClient) {
    showToast("尚未設定 Supabase 金鑰。");
    return;
  }

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo }
  });

  if (error) {
    console.error(error);
    showToast("Google 登入失敗。");
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut({ scope: "local" });
  if (error) {
    console.error(error);
    showToast("登出失敗。");
  }
}

function handleOnlineStateChange() {
  state.isOnline = navigator.onLine;
  updateSyncStatusUI();
  if (state.isOnline) {
    processSyncQueue().catch((error) => {
      console.error(error);
      showToast("自動同步失敗，可點擊立即同步重試。");
    });
  }
}

async function handleManualSync() {
  if (!state.user) return;
  if (!state.isOnline) {
    showToast("目前離線，無法同步。");
    return;
  }
  await processSyncQueue();
}

async function loadCachedNotesForUser(userId) {
  if (!state.idbReady) return;
  const rows = await idbGetAllByUser("notes_cache", userId);
  state.notes = rows.map((item) => normalizeSingleNote(item.note)).filter(Boolean);
  sortNotes(state.notes);
}

async function refreshNotesFromCloud() {
  if (!supabaseClient || !state.user || !state.isOnline) return;

  try {
    const { data, error } = await supabaseClient
      .from("notes")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    state.notes = (data || []).map(mapRowToNote);
    sortNotes(state.notes);
    await saveNotesCacheForUser(state.user.id, state.notes);
    applyFiltersAndRender();
    state.lastSyncAt = new Date().toISOString();
    updateSyncStatusUI();
  } catch (error) {
    console.error(error);
    if (state.notes.length === 0) {
      showToast("雲端讀取失敗，請稍後重試。");
    }
  }
}

function applyFiltersAndRender() {
  const keyword = refs.searchInput.value.trim().toLowerCase();
  const category = refs.categoryFilter.value;

  state.filteredNotes = state.notes.filter((note) => {
    if (category && note.category !== category) return false;
    if (!keyword) return true;
    const haystack = [
      note.title,
      note.content,
      note.category,
      Array.isArray(note.tags) ? note.tags.join(" ") : ""
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });

  sortNotes(state.filteredNotes);
  renderNotes();
}

function renderNotes() {
  refs.notesList.innerHTML = "";
  refs.resultCount.textContent = `${state.filteredNotes.length} 筆`;
  refs.emptyState.classList.toggle("hidden", state.filteredNotes.length > 0);

  for (const note of state.filteredNotes) {
    refs.notesList.appendChild(buildNoteCard(note));
  }
  updateDashboardStats();
}

function buildNoteCard(note) {
  const card = document.createElement("article");
  card.className = "note-card";

  const head = document.createElement("div");
  head.className = "note-head";

  const title = document.createElement("h3");
  title.className = "note-title";
  title.textContent = note.title || "(無標題)";
  head.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "note-controls";

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = `btn icon ghost ${note.favorite ? "favorite-active" : ""}`;
  favBtn.title = "收藏";
  favBtn.textContent = note.favorite ? "★" : "☆";
  favBtn.addEventListener("click", () => toggleFavorite(note.id));
  controls.appendChild(favBtn);

  head.appendChild(controls);
  card.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "note-meta";
  const categoryBadge = document.createElement("span");
  categoryBadge.className = "category-pill";
  categoryBadge.textContent = note.category;
  const updatedText = document.createElement("span");
  updatedText.className = "meta-updated";
  updatedText.textContent = `更新：${formatDateTime(note.updatedAt)}`;
  meta.appendChild(categoryBadge);
  meta.appendChild(updatedText);
  card.appendChild(meta);

  const content = document.createElement("p");
  content.className = "note-content";
  content.textContent = note.content;
  card.appendChild(content);

  const tags = document.createElement("div");
  tags.className = "tag-list";
  for (const tag of note.tags || []) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = `#${tag}`;
    tags.appendChild(chip);
  }
  if ((note.tags || []).length > 0) {
    card.appendChild(tags);
  }

  const thumbList = document.createElement("div");
  thumbList.className = "thumb-list";
  for (const path of note.attachments || []) {
    const img = document.createElement("img");
    img.alt = "attachment";
    img.dataset.path = path;
    const cachedUrl = getCachedSignedUrl(path);
    if (isDataUrlAttachment(path) || isOfflineBlobPath(path)) {
      img.src = "";
    } else if (cachedUrl) {
      img.src = cachedUrl;
    } else {
      hydrateSignedUrlForImage(path, img);
    }
    if (!img.src) {
      img.alt = "pending attachment";
      img.style.opacity = "0.5";
    }
    img.addEventListener("click", () => {
      if (isDataUrlAttachment(path)) {
        openImagePreviewFromUrl(path);
      } else {
        openImagePreviewByPath(path);
      }
    });
    thumbList.appendChild(img);
  }
  if ((note.attachments || []).length > 0) {
    card.appendChild(thumbList);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn secondary";
  editBtn.textContent = "編輯";
  editBtn.addEventListener("click", () => openEditor(note));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn danger";
  deleteBtn.textContent = "刪除";
  deleteBtn.addEventListener("click", () => deleteNote(note.id));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

async function hydrateSignedUrlForImage(path, imgElement) {
  if (isDataUrlAttachment(path) || isOfflineBlobPath(path)) return;
  const ok = await ensureSignedUrls([path]);
  if (!ok) return;
  const url = getCachedSignedUrl(path);
  if (!url) return;
  if (imgElement.isConnected) {
    imgElement.src = url;
  }
}

async function ensureSignedUrls(paths) {
  if (!supabaseClient || !paths.length || !state.isOnline) return false;
  const missing = paths.filter((path) => !isDataUrlAttachment(path) && !isOfflineBlobPath(path) && !getCachedSignedUrl(path));
  if (!missing.length) return true;

  const { data, error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error(error);
    return false;
  }

  const expiresAt = Date.now() + (SIGNED_URL_TTL_SECONDS - 5) * 1000;
  (data || []).forEach((item, index) => {
    const path = item.path || missing[index];
    const signedUrl = item.signedUrl || item.signedURL;
    if (!path || !signedUrl) return;
    state.signedUrlCache.set(path, { url: signedUrl, expiresAt });
  });
  return true;
}

function getCachedSignedUrl(path) {
  if (isDataUrlAttachment(path)) return path;
  const cached = state.signedUrlCache.get(path);
  if (!cached) return "";
  if (Date.now() > cached.expiresAt) {
    state.signedUrlCache.delete(path);
    return "";
  }
  return cached.url;
}

function openEditor(note) {
  state.editingId = note?.id || null;
  clearEditorTransientFiles();

  if (note) {
    refs.editorTitle.textContent = "編輯筆記";
    refs.noteId.value = note.id;
    refs.titleInput.value = note.title;
    refs.contentInput.value = note.content;
    refs.categoryInput.value = note.category;
    refs.tagsInput.value = (note.tags || []).join(", ");
    refs.favoriteInput.checked = Boolean(note.favorite);
    state.editorExistingAttachments = [...(note.attachments || [])];
    refs.createdAtText.textContent = `建立：${formatDateTime(note.createdAt)}`;
    refs.updatedAtText.textContent = `更新：${formatDateTime(note.updatedAt)}`;
  } else {
    refs.editorTitle.textContent = "新增筆記";
    refs.noteForm.reset();
    refs.categoryInput.value = CATEGORIES[0];
    refs.favoriteInput.checked = false;
    state.editorExistingAttachments = [];
    refs.createdAtText.textContent = "";
    refs.updatedAtText.textContent = "";
    refs.speechLangSelect.value = getPreferredSpeechLang();
  }

  renderAttachmentPreview();
  refs.editorOverlay.classList.remove("hidden");
}

function closeEditor() {
  refs.editorOverlay.classList.add("hidden");
  refs.noteForm.reset();
  refs.noteId.value = "";
  refs.createdAtText.textContent = "";
  refs.updatedAtText.textContent = "";
  state.editingId = null;
  state.editorExistingAttachments = [];
  clearEditorTransientFiles();
  refs.attachmentPreview.innerHTML = "";
  if (state.listening && state.speechRecognition) {
    state.speechRecognition.stop();
  }
}

function clearEditorTransientFiles() {
  state.editorNewFiles = [];
  for (const previewUrl of state.editorPreviewUrls) {
    URL.revokeObjectURL(previewUrl);
  }
  state.editorPreviewUrls = [];
  refs.attachmentsInput.value = "";
  refs.cameraInput.value = "";
}

function handleAttachmentFilePick(event) {
  const pickedFiles = Array.from(event.target.files || []);
  if (!pickedFiles.length) return;

  const remaining = MAX_ATTACHMENTS - (state.editorExistingAttachments.length + state.editorNewFiles.length);
  if (remaining <= 0) {
    showToast(`每筆最多 ${MAX_ATTACHMENTS} 張圖片。`);
    refs.attachmentsInput.value = "";
    refs.cameraInput.value = "";
    return;
  }

  const selected = pickedFiles.slice(0, remaining);
  if (selected.length < pickedFiles.length) {
    showToast(`超過上限，僅保留前 ${selected.length} 張。`);
  }

  state.editorNewFiles.push(...selected);
  renderAttachmentPreview();
  refs.attachmentsInput.value = "";
  refs.cameraInput.value = "";
}

function handleAttachmentPreviewClick(event) {
  const button = event.target.closest("button.attachment-remove");
  if (!button) return;

  const index = Number(button.dataset.index);
  const type = button.dataset.type;

  if (type === "existing") {
    const [removedPath] = state.editorExistingAttachments.splice(index, 1);
    if (removedPath) state.signedUrlCache.delete(removedPath);
  } else if (type === "new") {
    state.editorNewFiles.splice(index, 1);
  }

  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  for (const previewUrl of state.editorPreviewUrls) {
    URL.revokeObjectURL(previewUrl);
  }
  state.editorPreviewUrls = [];
  refs.attachmentPreview.innerHTML = "";

  state.editorExistingAttachments.forEach((path, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";
    const img = document.createElement("img");
    const url = getCachedSignedUrl(path);

    if (isDataUrlAttachment(path)) {
      img.src = path;
    } else if (isOfflineBlobPath(path)) {
      img.src = "";
      img.alt = "offline attachment";
      img.style.opacity = "0.5";
    } else if (url) {
      img.src = url;
    } else {
      hydrateSignedUrlForImage(path, img);
    }

    img.alt = img.alt || "existing attachment";
    img.addEventListener("click", () => {
      if (isDataUrlAttachment(path)) {
        openImagePreviewFromUrl(path);
      } else if (!isOfflineBlobPath(path)) {
        openImagePreviewByPath(path);
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.dataset.type = "existing";
    remove.dataset.index = String(index);
    remove.textContent = "×";

    item.appendChild(img);
    item.appendChild(remove);
    refs.attachmentPreview.appendChild(item);
  });

  state.editorNewFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";
    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    state.editorPreviewUrls.push(objectUrl);
    img.src = objectUrl;
    img.alt = "new attachment";
    img.addEventListener("click", () => openImagePreviewFromUrl(objectUrl));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.dataset.type = "new";
    remove.dataset.index = String(index);
    remove.textContent = "×";

    item.appendChild(img);
    item.appendChild(remove);
    refs.attachmentPreview.appendChild(item);
  });
}

async function handleSaveNote(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("請先登入後再操作。");
    return;
  }
  if (!ensureLocalDbReady()) return;

  const title = refs.titleInput.value.trim();
  const content = refs.contentInput.value.trim();
  const category = refs.categoryInput.value;
  const tags = parseTags(refs.tagsInput.value);
  const favorite = refs.favoriteInput.checked;

  if (!title || !content) {
    showToast("標題與內容不可空白。");
    return;
  }

  const totalAttachments = state.editorExistingAttachments.length + state.editorNewFiles.length;
  if (totalAttachments > MAX_ATTACHMENTS) {
    showToast(`每筆最多 ${MAX_ATTACHMENTS} 張圖片。`);
    return;
  }

  const editing = state.notes.find((note) => note.id === state.editingId) || null;
  const noteId = editing?.id || generateId();
  const now = new Date().toISOString();

  try {
    refs.saveBtn.disabled = true;

    const newAttachments = await prepareAttachmentsForSave(noteId, state.editorNewFiles);
    const attachments = [...state.editorExistingAttachments, ...newAttachments];

    const note = {
      id: noteId,
      title,
      content,
      category,
      tags,
      favorite,
      attachments,
      createdAt: editing?.createdAt || now,
      updatedAt: now
    };

    upsertNoteInState(note);
    await saveNotesCacheForUser(state.user.id, state.notes);

    const opType = editing ? "update" : "create";
    await enqueueOperation({
      type: opType,
      noteId: note.id,
      payload: note,
      baseUpdatedAt: editing?.updatedAt || null,
      force: false
    });

    applyFiltersAndRender();
    closeEditor();
    showToast(state.isOnline ? "筆記已儲存，將同步雲端。" : "已離線儲存，連網後自動同步。");

    if (state.isOnline) {
      await processSyncQueue();
    }
  } catch (error) {
    console.error(error);
    showToast(`儲存失敗：${readableError(error)}`);
  } finally {
    refs.saveBtn.disabled = false;
  }
}

async function prepareAttachmentsForSave(noteId, files) {
  const paths = [];
  for (const file of files) {
    const compressedBlob = await compressImageFile(file);
    if (state.isOnline) {
      try {
        const path = await uploadBlobToStorage(noteId, compressedBlob, file.name || "image.jpg");
        paths.push(path);
        continue;
      } catch (error) {
        console.warn("Upload now failed, fallback to offline blob", error);
      }
    }

    const blobId = generateId();
    const placeholder = `${OFFLINE_BLOB_PREFIX}${blobId}`;
    await idbPut("pending_blobs", {
      blobId,
      userId: state.user.id,
      noteId,
      fileName: file.name || "image.jpg",
      blob: compressedBlob,
      createdAt: new Date().toISOString()
    });
    paths.push(placeholder);
  }
  return paths;
}

async function uploadBlobToStorage(noteId, blob, fileName) {
  const safeName = sanitizeFileName(fileName || "image");
  const path = `${state.user.id}/${noteId}/${Date.now()}-${safeName}.jpg`;

  const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, blob, {
    cacheControl: "3600",
    contentType: "image/jpeg",
    upsert: false
  });
  if (error) throw error;

  return path;
}

async function toggleFavorite(noteId) {
  if (!ensureLocalDbReady()) return;
  const current = state.notes.find((note) => note.id === noteId);
  if (!current) return;

  const updated = {
    ...current,
    favorite: !current.favorite,
    updatedAt: new Date().toISOString()
  };

  upsertNoteInState(updated);
  await saveNotesCacheForUser(state.user.id, state.notes);

  await enqueueOperation({
    type: "update",
    noteId,
    payload: updated,
    baseUpdatedAt: current.updatedAt,
    force: false
  });

  applyFiltersAndRender();

  if (state.isOnline) {
    await processSyncQueue();
  }
}

async function deleteNote(noteId) {
  if (!ensureLocalDbReady()) return;
  const ok = window.confirm("確定要刪除這筆筆記嗎？");
  if (!ok) return;

  const target = state.notes.find((note) => note.id === noteId);
  if (!target) return;

  state.notes = state.notes.filter((note) => note.id !== noteId);
  await saveNotesCacheForUser(state.user.id, state.notes);
  applyFiltersAndRender();

  await enqueueOperation({
    type: "delete",
    noteId,
    payload: target,
    baseUpdatedAt: target.updatedAt,
    force: false
  });

  showToast(state.isOnline ? "已加入刪除同步。" : "已離線刪除，連網後同步。");

  if (state.isOnline) {
    await processSyncQueue();
  }
}

async function openImagePreviewByPath(path) {
  if (isOfflineBlobPath(path)) {
    showToast("離線暫存圖片需同步後才能預覽。");
    return;
  }

  const ok = await ensureSignedUrls([path]);
  if (!ok) {
    showToast("圖片讀取失敗。");
    return;
  }
  const url = getCachedSignedUrl(path);
  if (!url) {
    showToast("圖片讀取失敗。");
    return;
  }
  openImagePreviewFromUrl(url);
}

function openImagePreviewFromUrl(url) {
  refs.imagePreview.src = url;
  refs.imageModal.classList.remove("hidden");
}

function closeImagePreview() {
  refs.imagePreview.src = "";
  refs.imageModal.classList.add("hidden");
}

function handleExportJson() {
  if (!state.user) {
    showToast("請先登入。");
    return;
  }
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    notes: state.notes
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `work-learning-notebook-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleImportFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file || !state.user) return;
  if (!ensureLocalDbReady()) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const notes = normalizeImportedNotes(payload);
    if (!notes.length) {
      showToast("匯入檔沒有有效筆記。");
      return;
    }

    const mode = await chooseImportMode();
    if (mode === "cancel") return;

    if (mode === "overwrite") {
      state.notes = notes;
      await deleteAllPendingForUser(state.user.id);
      for (const note of notes) {
        await enqueueOperation({
          type: "create",
          noteId: note.id,
          payload: note,
          baseUpdatedAt: null,
          force: true
        });
      }
    } else {
      const beforeMap = new Map(state.notes.map((note) => [note.id, note]));
      const mergedMap = new Map(state.notes.map((note) => [note.id, note]));
      for (const note of notes) {
        mergedMap.set(note.id, note);
      }
      state.notes = Array.from(mergedMap.values());
      for (const note of notes) {
        const existing = beforeMap.get(note.id);
        await enqueueOperation({
          type: existing ? "update" : "create",
          noteId: note.id,
          payload: note,
          baseUpdatedAt: existing?.updatedAt || null,
          force: true
        });
      }
    }

    sortNotes(state.notes);
    await saveNotesCacheForUser(state.user.id, state.notes);
    applyFiltersAndRender();
    await refreshQueueIndicators();
    showToast("匯入完成，將同步到雲端。");

    if (state.isOnline) {
      await processSyncQueue();
    }
  } catch (error) {
    console.error(error);
    showToast("匯入失敗，請確認 JSON 格式。");
  } finally {
    refs.importInput.value = "";
  }
}

function chooseImportMode() {
  refs.importModeModal.classList.remove("hidden");
  return new Promise((resolve) => {
    refs.importModeModal._resolve = resolve;
  });
}

function resolveImportMode(mode) {
  refs.importModeModal.classList.add("hidden");
  const resolver = refs.importModeModal._resolve;
  refs.importModeModal._resolve = null;
  if (resolver) resolver(mode);
}

async function maybeRunLegacyMigration() {
  const legacy = loadLegacyNotes();
  if (!legacy.length || !state.user) return;
  if (!ensureLocalDbReady()) return;

  const migrationKey = `${STORAGE_KEYS.migrationPrefix}${state.user.id}`;
  if (localStorage.getItem(migrationKey) === "done") return;

  const action = await chooseMigrationAction();
  if (action === "ignore") {
    localStorage.setItem(migrationKey, "done");
    return;
  }

  try {
    if (action === "overwrite") {
      state.notes = legacy;
      await deleteAllPendingForUser(state.user.id);
      for (const note of legacy) {
        await enqueueOperation({
          type: "create",
          noteId: note.id,
          payload: note,
          baseUpdatedAt: null,
          force: true
        });
      }
    } else if (action === "merge") {
      const mergedMap = new Map(state.notes.map((note) => [note.id, note]));
      for (const note of legacy) {
        const existing = mergedMap.get(note.id);
        mergedMap.set(note.id, existing ? { ...existing, ...note } : note);
      }
      state.notes = Array.from(mergedMap.values());
      for (const note of legacy) {
        await enqueueOperation({
          type: "update",
          noteId: note.id,
          payload: note,
          baseUpdatedAt: null,
          force: true
        });
      }
    }

    sortNotes(state.notes);
    await saveNotesCacheForUser(state.user.id, state.notes);
    applyFiltersAndRender();
    localStorage.setItem(migrationKey, "done");

    if (state.isOnline) {
      await processSyncQueue();
    }

    showToast("舊本機資料遷移完成。");
  } catch (error) {
    console.error(error);
    showToast("舊本機資料遷移失敗。");
  }
}

function chooseMigrationAction() {
  refs.migrationModal.classList.remove("hidden");
  return new Promise((resolve) => {
    refs.migrationModal._resolve = resolve;
  });
}

function resolveMigrationAction(action) {
  refs.migrationModal.classList.add("hidden");
  const resolver = refs.migrationModal._resolve;
  refs.migrationModal._resolve = null;
  if (resolver) resolver(action);
}

async function enqueueOperation({ type, noteId, payload, baseUpdatedAt, force }) {
  if (!state.idbReady || !state.user) return;

  const existing = await getPendingOpsForNote(state.user.id, noteId);
  const earliestBase = existing.find((op) => op.baseUpdatedAt)?.baseUpdatedAt || baseUpdatedAt || null;

  for (const op of existing) {
    await idbDelete("pending_ops", op.opId);
  }

  if (type === "delete") {
    await deletePendingBlobsForNote(state.user.id, noteId);
  }

  const op = {
    opId: generateId(),
    userId: state.user.id,
    type,
    noteId,
    payload,
    baseUpdatedAt: type === "create" ? null : earliestBase,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    force: Boolean(force)
  };

  await idbPut("pending_ops", op);
  await refreshQueueIndicators();
}

async function processSyncQueue() {
  if (!state.user || !state.isOnline || !supabaseClient || state.syncInProgress || !state.idbReady) return;

  state.syncInProgress = true;
  updateSyncStatusUI();

  try {
    let progress = true;
    while (progress) {
      progress = false;
      const ops = await getPendingOpsForUser(state.user.id);
      if (!ops.length) break;

      for (const op of ops) {
        try {
          await syncOperation(op);
          progress = true;
        } catch (error) {
          console.error("sync operation failed", error);
          await bumpRetryCount(op);
          showToast(`同步失敗：${readableError(error)}`);
          progress = false;
          break;
        }
      }
    }

    await refreshNotesFromCloud();
    await refreshQueueIndicators();
    state.lastSyncAt = new Date().toISOString();
    updateSyncStatusUI();
  } finally {
    state.syncInProgress = false;
    updateSyncStatusUI();
  }
}

async function syncOperation(op) {
  if (op.type === "delete") {
    await syncDeleteOperation(op);
  } else {
    await syncUpsertOperation(op);
  }
}

async function syncUpsertOperation(op) {
  const localNote = normalizeSingleNote(op.payload);
  if (!localNote) {
    await idbDelete("pending_ops", op.opId);
    return;
  }

  const resolvedAttachments = await resolveOfflineAttachments(localNote.attachments, localNote.id);
  const noteToSync = { ...localNote, attachments: resolvedAttachments, updatedAt: new Date().toISOString() };

  if (!op.force && op.baseUpdatedAt) {
    const remote = await getRemoteNoteById(op.noteId);
    if (remote && remote.updatedAt !== op.baseUpdatedAt) {
      await storeConflict({
        noteId: op.noteId,
        localPayload: noteToSync,
        remotePayload: remote,
        baseUpdatedAt: op.baseUpdatedAt,
        kind: "upsert"
      });
      await idbDelete("pending_ops", op.opId);
      await refreshQueueIndicators();
      return;
    }
  }

  const row = mapNoteToRow(noteToSync, state.user.id);
  const { data, error } = await supabaseClient
    .from("notes")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throw error;

  const synced = mapRowToNote(data);
  upsertNoteInState(synced);
  await saveNotesCacheForUser(state.user.id, state.notes);
  applyFiltersAndRender();

  await idbDelete("pending_ops", op.opId);
}

async function syncDeleteOperation(op) {
  if (!op.force && op.baseUpdatedAt) {
    const remote = await getRemoteNoteById(op.noteId);
    if (remote && remote.updatedAt !== op.baseUpdatedAt) {
      await storeConflict({
        noteId: op.noteId,
        localPayload: op.payload || null,
        remotePayload: remote,
        baseUpdatedAt: op.baseUpdatedAt,
        kind: "delete"
      });
      await idbDelete("pending_ops", op.opId);
      await refreshQueueIndicators();
      return;
    }
  }

  const snapshot = normalizeSingleNote(op.payload);
  const storagePaths = (snapshot?.attachments || []).filter((path) => !isDataUrlAttachment(path) && !isOfflineBlobPath(path));
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabaseClient.storage.from(STORAGE_BUCKET).remove(storagePaths);
    if (storageError) {
      console.warn("storage remove warning", storageError);
    }
  }

  const { error } = await supabaseClient.from("notes").delete().eq("id", op.noteId);
  if (error) throw error;

  state.notes = state.notes.filter((note) => note.id !== op.noteId);
  await saveNotesCacheForUser(state.user.id, state.notes);
  applyFiltersAndRender();

  await idbDelete("pending_ops", op.opId);
  await deletePendingBlobsForNote(state.user.id, op.noteId);
}

async function resolveOfflineAttachments(attachments, noteId) {
  const finalPaths = [];

  for (const path of attachments || []) {
    if (!isOfflineBlobPath(path)) {
      finalPaths.push(path);
      continue;
    }

    const blobId = path.replace(OFFLINE_BLOB_PREFIX, "");
    const blobRec = await idbGet("pending_blobs", blobId);
    if (!blobRec?.blob) {
      continue;
    }

    const storagePath = await uploadBlobToStorage(noteId, blobRec.blob, blobRec.fileName || "image.jpg");
    finalPaths.push(storagePath);
    await idbDelete("pending_blobs", blobId);
  }

  return finalPaths;
}

async function getRemoteNoteById(noteId) {
  const { data, error } = await supabaseClient
    .from("notes")
    .select("*")
    .eq("id", noteId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRowToNote(data);
}

async function bumpRetryCount(op) {
  const next = { ...op, retryCount: (op.retryCount || 0) + 1 };
  await idbPut("pending_ops", next);
  await refreshQueueIndicators();
}

async function storeConflict({ noteId, localPayload, remotePayload, baseUpdatedAt, kind }) {
  await idbPut("conflicts", {
    conflictId: generateId(),
    userId: state.user.id,
    noteId,
    localPayload,
    remotePayload,
    baseUpdatedAt: baseUpdatedAt || null,
    detectedAt: new Date().toISOString(),
    kind
  });
}

async function openConflictFromQueue() {
  if (!state.user || !state.idbReady) return;
  const conflicts = await getConflictsForUser(state.user.id);
  if (!conflicts.length) {
    refs.conflictModal.classList.add("hidden");
    return;
  }

  const conflict = conflicts[0];
  state.activeConflict = conflict;

  const local = normalizeSingleNote(conflict.localPayload);
  const remote = normalizeSingleNote(conflict.remotePayload);
  refs.conflictTitleText.textContent = `筆記：${local?.title || remote?.title || "未知筆記"}`;
  refs.conflictLocalMeta.textContent = local ? `更新：${formatDateTime(local.updatedAt)}` : "本機版本不存在";
  refs.conflictRemoteMeta.textContent = remote ? `更新：${formatDateTime(remote.updatedAt)}` : "雲端版本不存在";
  refs.conflictLocalContent.textContent = local?.content || "(無內容)";
  refs.conflictRemoteContent.textContent = remote?.content || "(無內容)";

  refs.conflictModal.classList.remove("hidden");
}

async function resolveConflict(mode) {
  const conflict = state.activeConflict;
  if (!conflict || !state.user) return;

  const local = normalizeSingleNote(conflict.localPayload);
  const remote = normalizeSingleNote(conflict.remotePayload);

  try {
    if (mode === "local" && local) {
      upsertNoteInState(local);
      await saveNotesCacheForUser(state.user.id, state.notes);
      await enqueueOperation({
        type: "update",
        noteId: local.id,
        payload: local,
        baseUpdatedAt: remote?.updatedAt || null,
        force: true
      });
    } else if (mode === "remote") {
      if (remote) {
        upsertNoteInState(remote);
      } else if (local) {
        state.notes = state.notes.filter((note) => note.id !== local.id);
      }
      await saveNotesCacheForUser(state.user.id, state.notes);
    } else if (mode === "both" && local) {
      if (remote) {
        upsertNoteInState(remote);
      }
      const duplicate = {
        ...local,
        id: generateId(),
        title: `${local.title} (副本)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      upsertNoteInState(duplicate);
      await saveNotesCacheForUser(state.user.id, state.notes);
      await enqueueOperation({
        type: "create",
        noteId: duplicate.id,
        payload: duplicate,
        baseUpdatedAt: null,
        force: true
      });
    }

    await idbDelete("conflicts", conflict.conflictId);
    state.activeConflict = null;
    refs.conflictModal.classList.add("hidden");
    applyFiltersAndRender();
    await refreshQueueIndicators();

    if (state.isOnline) {
      await processSyncQueue();
    }
  } catch (error) {
    console.error(error);
    showToast(`衝突處理失敗：${readableError(error)}`);
  }
}

async function refreshQueueIndicators() {
  if (!state.user || !state.idbReady) {
    state.pendingOpsCount = 0;
    state.conflictsCount = 0;
    refs.pendingCountText.textContent = "待同步 0";
    refs.conflictQueueBtn.classList.add("hidden");
    updateSyncStatusUI();
    updateDashboardStats();
    return;
  }

  const pending = await getPendingOpsForUser(state.user.id);
  const conflicts = await getConflictsForUser(state.user.id);

  state.pendingOpsCount = pending.length;
  state.conflictsCount = conflicts.length;

  refs.pendingCountText.textContent = `待同步 ${pending.length}`;
  refs.conflictQueueBtn.textContent = `衝突 ${conflicts.length}`;
  refs.conflictQueueBtn.classList.toggle("hidden", conflicts.length === 0);
  updateSyncStatusUI();
  updateDashboardStats();
}

function updateSyncStatusUI() {
  refs.networkDot.classList.toggle("online", state.isOnline);
  refs.networkStatusText.textContent = state.isOnline ? "連線中" : "離線";

  if (!state.user) {
    refs.syncStatusText.textContent = "請先登入";
    return;
  }

  if (state.syncInProgress) {
    refs.syncStatusText.textContent = `同步中... 待同步 ${state.pendingOpsCount}`;
  } else if (!state.isOnline) {
    refs.syncStatusText.textContent = `離線模式，待同步 ${state.pendingOpsCount}`;
  } else if (state.conflictsCount > 0) {
    refs.syncStatusText.textContent = `有 ${state.conflictsCount} 筆衝突待處理`;
  } else if (state.pendingOpsCount > 0) {
    refs.syncStatusText.textContent = `待同步 ${state.pendingOpsCount}`;
  } else if (state.lastSyncAt) {
    refs.syncStatusText.textContent = `已同步 ${formatDateTime(state.lastSyncAt)}`;
  } else {
    refs.syncStatusText.textContent = "尚未同步";
  }
}

function focusSearchInput() {
  if (!state.user) return;
  refs.searchContainer.classList.remove("collapsed");
  refs.searchInput.focus({ preventScroll: true });
  refs.searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateDashboardStats() {
  refs.statTotalNotes.textContent = String(state.notes.length);
  refs.statFavoriteNotes.textContent = String(state.notes.filter((note) => note.favorite).length);
  refs.statPendingOps.textContent = String(state.pendingOpsCount);
  refs.statConflicts.textContent = String(state.conflictsCount);
}

function upsertNoteInState(note) {
  const normalized = normalizeSingleNote(note);
  if (!normalized) return;
  const index = state.notes.findIndex((item) => item.id === normalized.id);
  if (index >= 0) {
    state.notes[index] = normalized;
  } else {
    state.notes.push(normalized);
  }
  sortNotes(state.notes);
}

function normalizeImportedNotes(payload) {
  const list = Array.isArray(payload) ? payload : payload?.notes;
  if (!Array.isArray(list)) throw new Error("Invalid import payload");

  return list
    .map((raw) => normalizeSingleNote(raw))
    .filter((note) => Boolean(note && note.title && note.content));
}

function normalizeSingleNote(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : generateId();
  const createdAt = toIsoOrNow(raw.createdAt);
  const updatedAt = toIsoOrNow(raw.updatedAt);
  const category = CATEGORIES.includes(raw.category) ? raw.category : "Other";
  return {
    id,
    title: String(raw.title || "").trim(),
    content: String(raw.content || "").trim(),
    category,
    tags: parseTags(Array.isArray(raw.tags) ? raw.tags.join(",") : raw.tags || ""),
    favorite: Boolean(raw.favorite),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.filter((p) => typeof p === "string") : [],
    createdAt,
    updatedAt
  };
}

function parseTags(input) {
  return String(input || "")
    .replaceAll("，", ",")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

function sortNotes(notes) {
  notes.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function mapRowToNote(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    content: String(row.content || ""),
    category: CATEGORIES.includes(row.category) ? row.category : "Other",
    tags: Array.isArray(row.tags) ? row.tags : [],
    favorite: Boolean(row.favorite),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdAt: toIsoOrNow(row.created_at),
    updatedAt: toIsoOrNow(row.updated_at)
  };
}

function mapNoteToRow(note, userId) {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    category: note.category,
    tags: note.tags,
    favorite: note.favorite,
    attachments: note.attachments,
    created_at: note.createdAt,
    updated_at: note.updatedAt
  };
}

async function saveNotesCacheForUser(userId, notes) {
  if (!state.idbReady) return;
  await idbDeleteByUser("notes_cache", userId);
  for (const note of notes) {
    await idbPut("notes_cache", {
      cacheKey: `${userId}::${note.id}`,
      userId,
      noteId: note.id,
      note,
      updatedAt: note.updatedAt
    });
  }
}

async function deleteAllPendingForUser(userId) {
  await idbDeleteByUser("pending_ops", userId);
  await idbDeleteByUser("pending_blobs", userId);
  await idbDeleteByUser("conflicts", userId);
}

async function getPendingOpsForUser(userId) {
  const items = await idbGetAllByUser("pending_ops", userId);
  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

async function getPendingOpsForNote(userId, noteId) {
  const items = await idbGetAllByUser("pending_ops", userId);
  return items.filter((item) => item.noteId === noteId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

async function getConflictsForUser(userId) {
  const items = await idbGetAllByUser("conflicts", userId);
  return items.sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());
}

async function deletePendingBlobsForNote(userId, noteId) {
  const items = await idbGetAllByUser("pending_blobs", userId);
  for (const item of items) {
    if (item.noteId === noteId) {
      await idbDelete("pending_blobs", item.blobId);
    }
  }
}

async function idbGetAllByUser(storeName, userId) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index("userId");
    const results = [];
    const req = index.openCursor(IDBKeyRange.only(userId));

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
  });
}

async function idbDeleteByUser(storeName, userId) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const index = store.index("userId");
    const req = index.openCursor(IDBKeyRange.only(userId));

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB tx failed"));
  });
}

async function idbPut(storeName, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB put failed"));
  });
}

async function idbGet(storeName, key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
  });
}

async function idbDelete(storeName, key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
  });
}

async function compressImageFile(file) {
  const dataUrl = await fileToDataUrl(file);
  const image = await dataUrlToImage(dataUrl);

  const maxSide = 1600;
  let width = image.width;
  let height = image.height;
  if (width > height && width > maxSide) {
    height = Math.round((height * maxSide) / width);
    width = maxSide;
  } else if (height > maxSide) {
    width = Math.round((width * maxSide) / height);
    height = maxSide;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image compression failed"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.75
    );
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片格式錯誤"));
    image.src = dataUrl;
  });
}

function loadLegacyNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.legacy);
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const list = Array.isArray(payload) ? payload : payload?.notes;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeSingleNote).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.prefs);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (prefs.speechLang && SUPPORTED_SPEECH_MODES.includes(prefs.speechLang)) {
      refs.speechLangSelect.value = prefs.speechLang;
    }
  } catch (_error) {
    // ignore
  }
}

function savePrefs() {
  const prefs = { speechLang: refs.speechLangSelect.value };
  localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(prefs));
}

function getPreferredSpeechLang() {
  const currentMode = refs.speechLangSelect.value;
  return SUPPORTED_SPEECH_MODES.includes(currentMode) ? currentMode : SPEECH_MODE_MIXED;
}

function showAuthErrorFromHashIfAny() {
  if (!window.location.hash) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const errorDescription = params.get("error_description");
  if (!errorDescription) return;
  showToast(errorDescription);
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.remove("hidden");
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    refs.toast.classList.add("hidden");
    refs.toast.textContent = "";
  }, 2600);
}

function readableError(error) {
  return error?.message || "未知錯誤";
}

function formatDateTime(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function toIsoOrNow(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "image";
}

function isDataUrlAttachment(path) {
  return typeof path === "string" && path.startsWith("data:image");
}

function isOfflineBlobPath(path) {
  return typeof path === "string" && path.startsWith(OFFLINE_BLOB_PREFIX);
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

function byId(id) {
  return document.getElementById(id);
}

function ensureLocalDbReady() {
  if (state.idbReady) return true;
  showToast("離線資料庫尚未就緒，請重新整理後再試。");
  return false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
