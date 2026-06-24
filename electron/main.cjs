const { app, BrowserWindow, desktopCapturer, ipcMain, shell, screen: electronScreen } = require("electron");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const isDev = !app.isPackaged;
const loadDist = process.env.FAIRY_LOAD_DIST === "1";
let mainWindow;
let db;
let SQL;
let paths;
let lastScreenObservationAt = 0;
const activeRequestControllers = new Map();

const workspaceRoot = path.resolve(__dirname, "..");

const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
const MIMO_CHAT_COMPLETIONS_PATH = "/chat/completions";
const MIMO_MODELS = {
  chat: "mimo-v2.5-pro",
  vision: "mimo-v2.5",
  asr: "mimo-v2.5-asr",
  tts: "mimo-v2.5-tts",
  ttsVoiceDesign: "mimo-v2.5-tts-voicedesign",
  ttsVoiceClone: "mimo-v2.5-tts-voiceclone",
};
const MIMO_PRESET_VOICES = new Set(["mimo_default", "\u51b0\u7cd6", "\u8309\u8389", "\u82cf\u6253", "\u767d\u6866", "Mia", "Chloe", "Milo", "Dean"]);
const MIMO_DEFAULT_PRESET_VOICE = "\u8309\u8389";
const MIMO_AUDIO_STREAM_SAMPLE_RATE = 24000;

const SENSITIVE_KEYWORDS = [
  "password",
  "passcode",
  "login",
  "bank",
  "payment",
  "checkout",
  "wallet",
  "secret",
  "token",
  "api key",
  "private key",
  "seed phrase",
  "incognito",
  "\u9690\u79c1",
  "\u5bc6\u7801",
  "\u652f\u4ed8",
  "\u4ed8\u6b3e",
  "\u94f6\u884c",
  "\u94b1\u5305",
  "\u5bc6\u94a5",
  "\u79c1\u94a5",
  "\u52a9\u8bb0\u8bcd",
  "\u8eab\u4efd\u8bc1",
];

const PRIVATE_WINDOW_KEYWORDS = ["codex", "weixin", "wechat", "\u5fae\u4fe1", "discord", "kook", "fairy"];

const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  modelRoutes: {
    chat: {
      provider: "openai-compatible",
      label: "Default chat model",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      endpoint: "",
      enabled: true,
    },
    vision: {
      provider: "openai-compatible",
      label: "Strong multimodal vision model",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      endpoint: "",
      enabled: false,
    },
    stt: {
      provider: "openai-compatible",
      label: "External speech recognition",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "whisper-1",
      endpoint: "",
      enabled: true,
    },
    tts: {
      provider: "custom",
      label: "Custom cloned voice",
      baseUrl: "",
      apiKey: "",
      model: "",
      endpoint: "",
      enabled: false,
    },
  },
  sttProvider: "openai-compatible",
  sttModel: "whisper-1",
  sttEndpoint: "",
  ttsProvider: "browser",
  ttsEndpoint: "",
  ttsVoiceId: "",
  ttsVoiceName: "",
  ttsVoiceSamplePath: "",
  screenshotEnabled: false,
  screenshotIntervalMs: 20000,
  screenshotSaveImages: true,
  screenSensitiveKeywords: SENSITIVE_KEYWORDS,
  visionUploadEnabled: false,
  visionModel: "gpt-4.1-mini",
  personality:
    "You are fairy, a local-first AI companion and code-life partner. Speak warmly, naturally, and directly. Remember the user's preferences, projects, emotions, and long-running goals. Be proactive but never invasive. Protect privacy and refuse to process secrets, payment screens, passwords, private keys, or sensitive identity data.",
  proactiveMode: "adaptive",
  contextTokenBudget: 8000,
  recentContextMessages: 14,
  chatMaxTokens: 280,
};

const FAST_REPLY_INSTRUCTION =
  "Response speed matters. For normal chat and voice conversation, reply in 1-3 short natural sentences, usually under 80 Chinese characters. If the user asks for code, plans, or detailed analysis, be complete but still concise.";

const MIMO_STABLE_PRESET_VOICE_INSTRUCTION =
  "Use the exact same built-in preset speaker specified by audio.voice for every request. Do not randomize, redesign, or switch the speaker. Keep the same gender, age, accent, timbre, pitch range, speaking speed, emotional intensity, and microphone distance across all responses. Speak naturally in Mandarin Chinese, warm and conversational like a close phone call. Only synthesize the assistant text; do not add extra words.";

const REQUEST_TIMEOUT_MS = {
  chat: 45_000,
  vision: 60_000,
  stt: 25_000,
  tts: 90_000,
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function registerRequestController(requestId, controller) {
  if (!requestId) return () => {};
  activeRequestControllers.set(requestId, controller);
  return () => {
    if (activeRequestControllers.get(requestId) === controller) {
      activeRequestControllers.delete(requestId);
    }
  };
}

async function fetchWithTimeout(url, init = {}, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 1_000, 120_000, 45_000);
  const label = options.label || "Request";
  const controller = new AbortController();
  let timedOut = false;
  let canceled = false;

  const abortFromParent = () => {
    canceled = true;
    controller.abort();
  };

  if (options.signal?.aborted) {
    throw new Error(`${label} canceled.`);
  }

  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (timedOut) throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`);
      if (canceled) throw new Error(`${label} canceled.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(response, fallbackMs = 3500) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;
  const retrySeconds = Number(retryAfter);
  if (Number.isFinite(retrySeconds)) return clampNumber(retrySeconds * 1000, 1000, 15000, fallbackMs);
  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) return clampNumber(retryDate - Date.now(), 1000, 15000, fallbackMs);
  return fallbackMs;
}

async function fetchWithRateLimitRetry(url, init = {}, options = {}) {
  const maxRetries = clampNumber(options.maxRetries, 0, 5, 3);
  let lastResponse = await fetchWithTimeout(url, init, options);
  for (let attempt = 0; attempt < maxRetries && lastResponse.status === 429; attempt += 1) {
    const retryDelay = getRetryAfterMs(lastResponse, 3500 * 2 ** attempt);
    await sleep(retryDelay);
    lastResponse = await fetchWithTimeout(url, init, options);
  }
  return lastResponse;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getPaths() {
  const root = process.env.FAIRY_HOME || path.join(workspaceRoot, "fairy-memory");
  return {
    root,
    dbPath: path.join(root, "fairy.sqlite"),
    secretsPath: path.join(root, "secrets.json"),
    screenshotDir: path.join(root, "screenshots"),
    exportDir: path.join(root, "exports"),
  };
}

function loadLocalSecrets() {
  const envProviders = {
    deepseek: { apiKey: process.env.FAIRY_DEEPSEEK_API_KEY || "" },
    mimo: { apiKey: process.env.FAIRY_MIMO_API_KEY || "" },
  };

  let fileSecrets = {};
  try {
    if (paths?.secretsPath && fs.existsSync(paths.secretsPath)) {
      fileSecrets = JSON.parse(fs.readFileSync(paths.secretsPath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch (error) {
    console.warn("Failed to read local secrets:", error);
  }

  return {
    ...fileSecrets,
    providers: {
      ...(fileSecrets.providers || {}),
      deepseek: {
        ...(fileSecrets.providers?.deepseek || {}),
        ...(envProviders.deepseek.apiKey ? envProviders.deepseek : {}),
      },
      mimo: {
        ...(fileSecrets.providers?.mimo || {}),
        ...(envProviders.mimo.apiKey ? envProviders.mimo : {}),
      },
    },
  };
}

function locateSqlWasm(file) {
  const candidates = [
    path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "sql.js", "dist", file),
    path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  return found || candidates[0];
}

function run(sql, params = []) {
  db.run(sql, params);
  persistDb();
}

function persistDb() {
  if (!db || !paths) return;
  fs.writeFileSync(paths.dbPath, Buffer.from(db.export()));
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject();
    return null;
  } finally {
    stmt.free();
  }
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function redactSecretsForModel(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(sk|pk|ghp|gho|github_pat|xox[baprs]|AIza|ya29|AKIA)[A-Za-z0-9_\-]{16,}\b/g, "[redacted secret]")
    .replace(/\b[A-Za-z0-9_\-]{32,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/g, "[redacted token]")
    .replace(/\b(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*['"]?[^'"\s]{8,}/gi, "$1=[redacted secret]");
}

function sanitizeMessageForModel(message) {
  if (typeof message.content === "string") {
    return { ...message, content: redactSecretsForModel(message.content) };
  }

  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((part) => {
        if (part && part.type === "text") {
          return { ...part, text: redactSecretsForModel(part.text) };
        }
        return part;
      }),
    };
  }

  return message;
}

function normalizeMessage(row) {
  return {
    id: Number(row.id),
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

async function initDatabase() {
  paths = getPaths();
  ensureDir(paths.root);
  ensureDir(paths.screenshotDir);
  ensureDir(paths.exportDir);

  SQL = await initSqlJs({ locateFile: locateSqlWasm });
  if (fs.existsSync(paths.dbPath)) {
    db = new SQL.Database(fs.readFileSync(paths.dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      from_message_id INTEGER,
      to_message_id INTEGER,
      token_saved_estimate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 1,
      source_message_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT,
      source_name TEXT,
      analysis TEXT,
      sensitive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = getOne("SELECT key FROM settings WHERE key = ?", [key]);
    if (!existing) {
      db.run("INSERT INTO settings (key, value_json) VALUES (?, ?)", [key, JSON.stringify(value)]);
    }
  }

  persistDb();
}

function loadSettings() {
  const rows = getAll("SELECT key, value_json FROM settings");
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value_json);
    } catch {
      settings[row.key] = row.value_json;
    }
  }
  settings.modelRoutes = {
    ...DEFAULT_SETTINGS.modelRoutes,
    ...(settings.modelRoutes || {}),
    chat: { ...DEFAULT_SETTINGS.modelRoutes.chat, ...(settings.modelRoutes?.chat || {}) },
    vision: { ...DEFAULT_SETTINGS.modelRoutes.vision, ...(settings.modelRoutes?.vision || {}) },
    stt: { ...DEFAULT_SETTINGS.modelRoutes.stt, ...(settings.modelRoutes?.stt || {}) },
    tts: { ...DEFAULT_SETTINGS.modelRoutes.tts, ...(settings.modelRoutes?.tts || {}) },
  };
  return settings;
}

function saveSettings(partial) {
  const clean = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) clean[key] = value;
  }
  for (const [key, value] of Object.entries(clean)) {
    db.run(
      "INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      [key, JSON.stringify(value)]
    );
  }
  persistDb();
  return loadSettings();
}

function redactSettingsForManifest(settings) {
  const clone = JSON.parse(JSON.stringify(settings));
  if (clone.apiKey) clone.apiKey = "[stored locally]";
  for (const route of Object.values(clone.modelRoutes || {})) {
    if (route?.apiKey) route.apiKey = "[stored locally]";
  }
  return clone;
}

function createMemoryBackup() {
  persistDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportedPath = path.join(paths.exportDir, `fairy-memory-${stamp}`);
  ensureDir(exportedPath);

  const screenshotTarget = path.join(exportedPath, "screenshots");
  ensureDir(screenshotTarget);
  if (fs.existsSync(paths.dbPath)) {
    fs.copyFileSync(paths.dbPath, path.join(exportedPath, "fairy.sqlite"));
  }
  if (fs.existsSync(paths.secretsPath)) {
    fs.copyFileSync(paths.secretsPath, path.join(exportedPath, "secrets.json"));
  }
  if (fs.existsSync(paths.screenshotDir)) {
    fs.cpSync(paths.screenshotDir, screenshotTarget, { recursive: true, force: true });
  }

  const manifest = {
    app: "fairy",
    schemaVersion: 1,
    createdAt: nowIso(),
    sourceMemoryRoot: paths.root,
    files: {
      database: "fairy.sqlite",
      secrets: fs.existsSync(paths.secretsPath) ? "secrets.json" : null,
      screenshots: "screenshots/",
    },
    counts: {
      messages: Number(getOne("SELECT COUNT(*) AS count FROM messages").count),
      summaries: Number(getOne("SELECT COUNT(*) AS count FROM summaries").count),
      memories: Number(getOne("SELECT COUNT(*) AS count FROM memories").count),
      screenshots: Number(getOne("SELECT COUNT(*) AS count FROM screenshots").count),
    },
    settingsPreview: redactSettingsForManifest(loadSettings()),
    restoreHint:
      "Close fairy, copy fairy.sqlite, secrets.json, and screenshots into the target FAIRY_HOME/fairy-memory folder, then reopen fairy.",
  };

  fs.writeFileSync(path.join(exportedPath, "fairy-backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(
    path.join(exportedPath, "RESTORE.txt"),
    [
      "fairy memory backup",
      "",
      "This backup may contain local secrets such as API keys. Keep it private.",
      "",
      "Restore:",
      "1. Close fairy on the target computer.",
      "2. Copy fairy.sqlite into the target fairy-memory folder.",
      "3. Copy secrets.json if present.",
      "4. Copy the screenshots folder if you want visual memory too.",
      "5. Reopen fairy.",
      "",
      `Created at: ${manifest.createdAt}`,
      `Source: ${paths.root}`,
    ].join("\n"),
    "utf8"
  );

  return { exportedPath, manifestPath: path.join(exportedPath, "fairy-backup-manifest.json") };
}

function saveMessage(role, content, metadata) {
  const createdAt = nowIso();
  db.run(
    "INSERT INTO messages (role, content, token_estimate, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)",
    [role, content, estimateTokens(content), metadata ? JSON.stringify(metadata) : null, createdAt]
  );
  persistDb();
  const id = Number(getOne("SELECT last_insert_rowid() AS id").id);
  return { id, role, content, createdAt, metadata };
}

function getRoute(capability) {
  const settings = loadSettings();
  const route = settings.modelRoutes?.[capability] || {};
  const secrets = loadLocalSecrets();
  const provider = route.provider || "openai-compatible";
  return {
    baseUrl: route.baseUrl || settings.apiBaseUrl,
    apiKey:
      route.apiKey ||
      secrets.routes?.[capability]?.apiKey ||
      secrets.providers?.[provider]?.apiKey ||
      (isLocalModelProvider(provider) ? "" : settings.apiKey),
    model:
      route.model ||
      (capability === "vision" ? settings.visionModel : capability === "stt" ? settings.sttModel : settings.chatModel),
    endpoint: route.endpoint || "",
    provider,
    enabled: route.enabled !== false,
  };
}

function getAuthHeaders(route, apiKey, json = true) {
  const headers = json ? { "Content-Type": "application/json" } : {};
  if (!apiKey) return headers;

  if (route.provider === "mimo") {
    return { ...headers, "api-key": apiKey };
  }

  return { ...headers, Authorization: `Bearer ${apiKey}` };
}

function getMimoChatEndpoint(route, fallbackBaseUrl = MIMO_BASE_URL) {
  const base = (route.baseUrl || fallbackBaseUrl || MIMO_BASE_URL).replace(/\/$/, "");
  return route.endpoint || `${base}${MIMO_CHAT_COMPLETIONS_PATH}`;
}

function isLocalModelProvider(provider) {
  return provider === "local-openai" || provider === "ollama";
}

function buildMimoChatRequestBody({ model, messages, maxTokens, temperature, stream = false }) {
  return {
    model,
    messages: messages.map(sanitizeMessageForModel),
    max_completion_tokens: maxTokens,
    temperature,
    stream,
    thinking: { type: "disabled" },
  };
}

function getMimoPresetVoice(settings) {
  const voice = String(settings.ttsVoiceId || "").trim();
  return MIMO_PRESET_VOICES.has(voice) ? voice : MIMO_DEFAULT_PRESET_VOICE;
}

function getMimoTtsInstruction(model, voiceId, settings) {
  if (model.includes("voiceclone")) {
    return "Use the cloned voice sample as the timbre. Speak like a natural close companion on a phone call: gentle, clear, emotionally present, and a little faster than formal narration.";
  }
  if (model.includes("voicedesign")) {
    return (
      settings.ttsVoiceName ||
      "Young Mandarin Chinese female voice, warm, clear, close conversational phone-call style, natural rhythm, stable timbre, gentle but not overly dramatic."
    );
  }
  return `${MIMO_STABLE_PRESET_VOICE_INSTRUCTION} The selected voice id is "${voiceId}".`;
}

function getMessageText(content) {
  if (typeof content === "string") return redactSecretsForModel(content);
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => redactSecretsForModel(part.text || ""))
    .filter(Boolean)
    .join("\n");
}

function getMessageImages(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === "image_url" && part.image_url?.url)
    .map((part) => String(part.image_url.url))
    .map((url) => (url.startsWith("data:") ? url.slice(url.indexOf(",") + 1) : ""))
    .filter(Boolean);
}

function toOllamaMessages(messages) {
  return messages.map((message) => {
    const next = {
      role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
      content: getMessageText(message.content),
    };
    const images = getMessageImages(message.content);
    if (images.length) next.images = images;
    return next;
  });
}

function stripReasoningTrace(content) {
  return String(content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.\s*/i, "")
    .trim();
}

async function callOllamaChat(messages, options) {
  const route = options.route;
  const base = (route.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const endpoint = route.endpoint || `${base}/api/chat`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, route.apiKey),
      body: JSON.stringify({
        model: options.model,
        messages: toOllamaMessages(messages),
        stream: false,
        think: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
    },
    {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      label: "ollama API",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  return stripReasoningTrace(json.message?.content || json.response || "");
}

function sendChatStreamEvent(webContents, requestId, event) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send("chat:stream", { requestId, ...event });
}

async function readStreamText(response, onText) {
  if (!response.body?.getReader) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) onText(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) onText(tail);
}

function readSseJsonBuffer(buffer, onJson) {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      onJson(JSON.parse(data));
    } catch (error) {
      console.warn("Ignored malformed SSE JSON chunk:", error);
    }
  }
  return rest;
}

function getChatDeltaContent(json) {
  return json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
}

function getAudioDeltaBase64(json) {
  return json.choices?.[0]?.delta?.audio?.data || "";
}

async function callOllamaChatStream(messages, options) {
  const route = options.route;
  const base = (route.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const endpoint = route.endpoint || `${base}/api/chat`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, route.apiKey),
      body: JSON.stringify({
        model: options.model,
        messages: toOllamaMessages(messages),
        stream: true,
        think: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
    },
    {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      label: "ollama API",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API failed (${response.status}): ${text}`);
  }

  let buffer = "";
  let fullText = "";
  await readStreamText(response, (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const json = JSON.parse(trimmed);
      const delta = stripReasoningTrace(json.message?.content || json.response || "");
      if (delta) {
        fullText += delta;
        options.onDelta?.(delta);
      }
    }
  });

  return stripReasoningTrace(fullText);
}

function getAudioMimeType(filePath) {
  const extension = path.extname(filePath || "").toLowerCase();
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".mpeg") return "audio/mpeg";
  return "";
}

function normalizeMimoAudioMimeType(mimeType, fallback = "audio/wav") {
  const normalized = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "audio/wav" || normalized === "audio/mpeg" || normalized === "audio/mp3") return normalized;
  return fallback;
}

function readVoiceSampleDataUrl(filePath) {
  if (!filePath) {
    throw new Error("Voice clone sample is not configured.");
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
  const mimeType = getAudioMimeType(resolvedPath);
  if (!mimeType) {
    throw new Error("MiMo voice clone only supports wav or mp3 samples. Convert the sample first.");
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Voice clone sample was not found: ${resolvedPath}`);
  }

  const base64 = fs.readFileSync(resolvedPath).toString("base64");
  if (base64.length > 10 * 1024 * 1024) {
    throw new Error("Voice clone sample is too large after Base64 encoding. Keep it under 10 MB.");
  }

  return `data:${mimeType};base64,${base64}`;
}

function getRecentMessages(limit = 32) {
  return getAll("SELECT * FROM messages ORDER BY id DESC LIMIT ?", [limit])
    .reverse()
    .map(normalizeMessage);
}

function getLatestSummary() {
  const row = getOne("SELECT * FROM summaries WHERE scope = ? ORDER BY id DESC LIMIT 1", ["rolling"]);
  return row ? row.content : "";
}

function buildChatContext(userContent) {
  const settings = loadSettings();
  const summary = getLatestSummary();
  const recentLimit = clampNumber(settings.recentContextMessages, 8, 40, 14);
  const recent = getRecentMessages(recentLimit).filter((message) => message.role !== "observation");
  const messages = [
    {
      role: "system",
      content: `${settings.personality}\n\n${FAST_REPLY_INSTRUCTION}`,
    },
  ];

  if (summary) {
    messages.push({
      role: "system",
      content: `Long-term rolling memory summary. Preserve continuity, but treat raw recent messages as more precise:\n${summary}`,
    });
  }

  for (const message of recent) {
    if (message.role === "user" || message.role === "assistant" || message.role === "system") {
      messages.push({ role: message.role, content: message.content });
    }
  }

  messages.push({ role: "user", content: userContent });
  return messages;
}

async function callChatCompletions(messages, options = {}) {
  const settings = loadSettings();
  const route = getRoute(options.capability || "chat");
  const apiKey = route.apiKey;
  const baseUrl = route.baseUrl || settings.apiBaseUrl;
  const model = options.model || route.model || settings.chatModel;
  const maxTokens = clampNumber(options.maxTokens ?? settings.chatMaxTokens, 80, 2000, 280);
  const temperature = options.temperature ?? 0.7;

  if (!apiKey && !isLocalModelProvider(route.provider)) {
    throw new Error("API key is not configured yet. Open settings and add an OpenAI-compatible API key.");
  }

  if (route.provider === "ollama") {
    return callOllamaChat(messages, {
      route,
      model,
      maxTokens,
      temperature,
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS[options.capability || "chat"],
      signal: options.signal,
    });
  }

  const base = baseUrl.replace(/\/$/, "");
  const endpoint = route.provider === "mimo" ? getMimoChatEndpoint(route, baseUrl) : route.endpoint || `${base}/chat/completions`;
  const requestBody =
    route.provider === "mimo"
      ? buildMimoChatRequestBody({ model, messages, maxTokens, temperature, stream: false })
      : {
          model,
          messages: messages.map(sanitizeMessageForModel),
          temperature,
          max_tokens: maxTokens,
        };

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, apiKey),
      body: JSON.stringify(requestBody),
    },
    {
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS[options.capability || "chat"],
      signal: options.signal,
      label: `${options.capability || "chat"} API`,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat API failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function callChatCompletionsStream(messages, options = {}) {
  const settings = loadSettings();
  const route = getRoute(options.capability || "chat");
  const apiKey = route.apiKey;
  const baseUrl = route.baseUrl || settings.apiBaseUrl;
  const model = options.model || route.model || settings.chatModel;
  const maxTokens = clampNumber(options.maxTokens ?? settings.chatMaxTokens, 80, 2000, 280);
  const temperature = options.temperature ?? 0.7;

  if (!options.onDelta) {
    return callChatCompletions(messages, options);
  }

  if (!apiKey && !isLocalModelProvider(route.provider)) {
    throw new Error("API key is not configured yet. Open settings and add an OpenAI-compatible API key.");
  }

  if (route.provider === "ollama") {
    return callOllamaChatStream(messages, {
      route,
      model,
      maxTokens,
      temperature,
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS[options.capability || "chat"],
      signal: options.signal,
      onDelta: options.onDelta,
    });
  }

  const base = baseUrl.replace(/\/$/, "");
  const endpoint = route.provider === "mimo" ? getMimoChatEndpoint(route, baseUrl) : route.endpoint || `${base}/chat/completions`;
  const requestBody =
    route.provider === "mimo"
      ? buildMimoChatRequestBody({ model, messages, maxTokens, temperature, stream: true })
      : {
          model,
          messages: messages.map(sanitizeMessageForModel),
          temperature,
          max_tokens: maxTokens,
          stream: true,
        };

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, apiKey),
      body: JSON.stringify(requestBody),
    },
    {
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS[options.capability || "chat"],
      signal: options.signal,
      label: `${options.capability || "chat"} API`,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    if ([400, 404, 422].includes(response.status) && /stream/i.test(text)) {
      return callChatCompletions(messages, { ...options, onDelta: undefined });
    }
    throw new Error(`Chat API failed (${response.status}): ${text}`);
  }

  let buffer = "";
  let fullText = "";
  await readStreamText(response, (chunk) => {
    buffer += chunk;
    buffer = readSseJsonBuffer(buffer, (json) => {
      const delta = getChatDeltaContent(json);
      if (delta) {
        fullText += delta;
        options.onDelta(delta);
      }
    });
  });

  return fullText.trim();
}

async function compressMemoryIfNeeded() {
  const settings = loadSettings();
  const latestSummaryRow = getOne("SELECT to_message_id FROM summaries WHERE scope = ? ORDER BY id DESC LIMIT 1", ["rolling"]);
  const lastSummarizedId = Number(latestSummaryRow?.to_message_id || 0);
  const candidates = getAll(
    "SELECT * FROM messages WHERE id > ? ORDER BY id ASC",
    [lastSummarizedId]
  );
  const totalTokens = candidates.reduce((sum, row) => sum + Number(row.token_estimate || 0), 0);

  if (totalTokens < settings.contextTokenBudget) return;
  if (candidates.length < 20) return;

  const keepRecent = 12;
  const toSummarize = candidates.slice(0, Math.max(0, candidates.length - keepRecent));
  if (!toSummarize.length) return;

  const previousSummary = getLatestSummary();
  const transcript = toSummarize
    .map((row) => `${row.id} ${row.role}: ${row.content}`)
    .join("\n\n");

  const summary = await callChatCompletions(
    [
      {
        role: "system",
        content:
          "Update a long-term memory summary for fairy. Keep durable facts, emotional context, user preferences, projects, relationship dynamics, open loops, and instructions. Do not discard important details. Be concise enough to save tokens. Return only the updated summary.",
      },
      {
        role: "user",
        content: `Previous summary:\n${previousSummary || "(none)"}\n\nNew transcript to merge:\n${transcript}`,
      },
    ],
    { capability: "chat", model: settings.chatModel, maxTokens: 900, temperature: 0.25 }
  );

  const fromId = Number(toSummarize[0].id);
  const toId = Number(toSummarize[toSummarize.length - 1].id);
  db.run(
    "INSERT INTO summaries (scope, content, from_message_id, to_message_id, token_saved_estimate, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["rolling", summary, fromId, toId, Math.max(0, totalTokens - estimateTokens(summary)), nowIso()]
  );
  persistDb();
}

function isSensitiveSourceName(sourceName) {
  const lower = (sourceName || "").toLowerCase();
  const settings = loadSettings();
  const keywords = Array.isArray(settings.screenSensitiveKeywords)
    ? settings.screenSensitiveKeywords
    : SENSITIVE_KEYWORDS;
  return [...keywords, ...PRIVATE_WINDOW_KEYWORDS]
    .map((keyword) => String(keyword || "").trim().toLowerCase())
    .filter(Boolean)
    .some((keyword) => lower.includes(keyword));
}

function getDesktopThumbnailSize() {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const width = Math.round(primaryDisplay.size.width * scaleFactor);
  const height = Math.round(primaryDisplay.size.height * scaleFactor);
  return { width, height };
}

function selectDesktopSource(sources) {
  const screens = sources.filter((item) => item.id?.startsWith("screen:"));
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  return (
    screens.find((item) => String(item.display_id) === String(primaryDisplay.id)) ||
    screens.find((item) => /desktop|screen|\u5c4f\u5e55|\u684c\u9762/i.test(item.name || "")) ||
    screens[0] ||
    null
  );
}

function getVisionImagePayload(nativeImage) {
  const size = nativeImage.getSize();
  const maxDimension = 960;
  const largest = Math.max(size.width, size.height);
  const scale = largest > maxDimension ? maxDimension / largest : 1;
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const image = scale < 1 ? nativeImage.resize({ width, height, quality: "good" }) : nativeImage;
  return {
    dataUrl: `data:image/jpeg;base64,${image.toJPEG(78).toString("base64")}`,
    width,
    height,
  };
}

async function captureScreen(options = {}) {
  const settings = loadSettings();
  if (!settings.screenshotEnabled && !options.force) {
    return { saved: false, sensitive: false, reason: "Screenshot observation is disabled." };
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: getDesktopThumbnailSize(),
    fetchWindowIcons: false,
  });

  const source = selectDesktopSource(sources);
  if (!source) return { saved: false, sensitive: false, reason: "No desktop screen source found. Capture skipped." };

  const fileName = `screen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const filePath = path.join(paths.screenshotDir, fileName);

  if (settings.screenshotSaveImages) {
    fs.writeFileSync(filePath, source.thumbnail.toPNG());
  }

  let analysis = "Captured locally. Vision upload is disabled, so fairy stored the screenshot without external analysis.";
  let message = "";

  const visionRoute = getRoute("vision");
  const canUseVisionRoute = settings.visionUploadEnabled && visionRoute.enabled && (visionRoute.apiKey || isLocalModelProvider(visionRoute.provider));
  if (canUseVisionRoute) {
    const visionImage = getVisionImagePayload(source.thumbnail);
    const visionPrompt =
      "You are fairy's desktop vision layer. Inspect the full desktop screenshot and return only compact JSON with keys: analysis, visibleText, shouldSpeak, message. analysis must be a concrete Chinese description of the active app/window, visible UI, important positions, and what the user appears to be doing. visibleText should list important visible words if any. message should be a short natural Chinese response fairy could say now. If sensitive-looking content is visible, mention that sensitive content may be on screen without copying exact secrets, keys, card numbers, passwords, or identity numbers. Never answer that you cannot see the screen.";
    const raw = await callChatCompletions(
      [
        {
          role: "user",
          content: [
            { type: "text", text: `${visionPrompt}\nWindow title: ${source.name}\nVision image size: ${visionImage.width}x${visionImage.height}` },
            { type: "image_url", image_url: { url: visionImage.dataUrl } },
          ],
        },
      ],
      {
        capability: "vision",
        model: visionRoute.model,
        maxTokens: 500,
        temperature: 0.2,
        signal: options.signal,
        timeoutMs: REQUEST_TIMEOUT_MS.vision,
      }
    );

    try {
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
      analysis = [
        parsed.analysis || "",
        parsed.visibleText ? `Visible text: ${parsed.visibleText}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (!analysis) analysis = raw || "Vision route returned no screen analysis.";
      message = parsed.shouldSpeak ? parsed.message || "" : "";
    } catch {
      analysis = raw || "Vision route returned no screen analysis.";
    }
  }

  db.run(
    "INSERT INTO screenshots (file_path, source_name, analysis, sensitive, created_at) VALUES (?, ?, ?, ?, ?)",
    [settings.screenshotSaveImages ? filePath : null, source.name, analysis, 0, nowIso()]
  );
  persistDb();

  if (message && options.saveAssistantMessage) {
    saveMessage("assistant", message, { source: "screen-observation", analysis });
  } else {
    saveMessage("observation", analysis, { source: "screen-observation", filePath });
  }

  return {
    saved: true,
    sensitive: false,
    analysis,
    message,
    filePath: settings.screenshotSaveImages ? filePath : undefined,
  };
}

async function transcribeAudio(audio, mimeType, options = {}) {
  const settings = loadSettings();
  const route = getRoute("stt");
  const apiKey = route.apiKey || settings.apiKey;

  if (!apiKey) {
    throw new Error("Speech API key is not configured yet.");
  }

  const base = (route.baseUrl || settings.apiBaseUrl).replace(/\/$/, "");
  const endpoint =
    route.endpoint ||
    settings.sttEndpoint ||
    (route.provider === "mimo" ? getMimoChatEndpoint(route, base) : `${base}/audio/transcriptions`);
  const buffer = Buffer.from(audio);

  if (route.provider === "mimo") {
    const mimoMimeType = normalizeMimoAudioMimeType(mimeType, "audio/wav");
    const audioBase64 = buffer.toString("base64");
    if (audioBase64.length > 10 * 1024 * 1024) {
      throw new Error("MiMo ASR audio is too large after Base64 encoding. Keep it under 10 MB.");
    }
    const response = await fetchWithRateLimitRetry(
      endpoint,
      {
        method: "POST",
        headers: getAuthHeaders(route, apiKey),
        body: JSON.stringify({
          model: route.model || MIMO_MODELS.asr,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    data: `data:${mimoMimeType};base64,${audioBase64}`,
                  },
                },
              ],
            },
          ],
          asr_options: {
            language: "zh",
          },
        }),
      },
      { timeoutMs: REQUEST_TIMEOUT_MS.stt, signal: options.signal, label: "Speech recognition" }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MiMo speech recognition failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    return { text: json.choices?.[0]?.message?.content?.trim() || "" };
  }

  const blob = new Blob([buffer], { type: mimeType || "audio/webm" });
  const form = new FormData();
  form.append("file", blob, "fairy-voice.webm");
  form.append("model", route.model || settings.sttModel);

  const response = await fetchWithRateLimitRetry(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, apiKey, false),
      body: form,
    },
    { timeoutMs: REQUEST_TIMEOUT_MS.stt, signal: options.signal, label: "Speech recognition" }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Speech transcription failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  return { text: json.text || "" };
}

async function synthesizeSpeech(text, options = {}) {
  const settings = loadSettings();
  const route = getRoute("tts");
  const base = (route.baseUrl || settings.apiBaseUrl).replace(/\/$/, "");
  const endpoint = route.endpoint || settings.ttsEndpoint || (route.provider === "mimo" ? getMimoChatEndpoint(route, base) : "");
  const apiKey = route.apiKey || settings.apiKey;

  if (settings.ttsProvider !== "custom" && route.provider !== "mimo") {
    throw new Error("Custom TTS endpoint is not configured. Browser speech synthesis will be used instead.");
  }

  if (!endpoint) {
    throw new Error("TTS endpoint is not configured.");
  }

  if (route.provider === "mimo") {
    if (!apiKey) {
      throw new Error("MiMo API key is not configured yet.");
    }

    const hasVoiceSample = Boolean(settings.ttsVoiceSamplePath);
    const model = hasVoiceSample ? MIMO_MODELS.ttsVoiceClone : route.model || MIMO_MODELS.tts;
    const voiceId = getMimoPresetVoice(settings);
    let audio = { format: "wav" };
    if (model.includes("voiceclone") || hasVoiceSample) {
      audio = {
        ...audio,
        voice: readVoiceSampleDataUrl(settings.ttsVoiceSamplePath),
      };
    } else if (model.includes("voicedesign")) {
      audio = {
        ...audio,
        optimize_text_preview: true,
      };
    } else {
      audio = {
        ...audio,
        voice: voiceId,
      };
    }

    const voiceInstruction = getMimoTtsInstruction(model, voiceId, settings);

    const response = await fetchWithRateLimitRetry(
      endpoint,
      {
        method: "POST",
        headers: getAuthHeaders(route, apiKey),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: voiceInstruction,
            },
            {
              role: "assistant",
              content: text,
            },
          ],
          audio,
          stream: false,
        }),
      },
      { timeoutMs: REQUEST_TIMEOUT_MS.tts, signal: options.signal, label: "Speech synthesis" }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MiMo TTS failed (${response.status}): ${detail}`);
    }

    const json = await response.json();
    const audioBase64 = json.choices?.[0]?.message?.audio?.data;
    if (!audioBase64) {
      throw new Error("MiMo TTS response did not include audio data.");
    }

    return { audioBase64, mimeType: "audio/wav" };
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, apiKey),
      body: JSON.stringify({
        text,
        input: text,
        model: route.model || undefined,
        voiceId: settings.ttsVoiceId,
        voice_id: settings.ttsVoiceId,
        voice: settings.ttsVoiceId,
      }),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS.tts, signal: options.signal, label: "Speech synthesis" }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS provider failed (${response.status}): ${detail}`);
  }

  const mimeType = response.headers.get("content-type") || "audio/mpeg";
  const arrayBuffer = await response.arrayBuffer();
  return {
    audioBase64: Buffer.from(arrayBuffer).toString("base64"),
    mimeType,
  };
}

function sendSpeechStreamEvent(webContents, requestId, event) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send("speech:stream", { requestId, ...event });
}

function canStreamMimoTts(settings, route, model) {
  return (
    route.provider === "mimo" &&
    model === MIMO_MODELS.tts &&
    !settings.ttsVoiceSamplePath &&
    !model.includes("voiceclone") &&
    !model.includes("voicedesign")
  );
}

async function synthesizeSpeechStream(text, options = {}) {
  const settings = loadSettings();
  const route = getRoute("tts");
  const base = (route.baseUrl || settings.apiBaseUrl).replace(/\/$/, "");
  const endpoint = route.endpoint || settings.ttsEndpoint || (route.provider === "mimo" ? getMimoChatEndpoint(route, base) : "");
  const apiKey = route.apiKey || settings.apiKey;
  const hasVoiceSample = Boolean(settings.ttsVoiceSamplePath);
  const model = hasVoiceSample ? MIMO_MODELS.ttsVoiceClone : route.model || MIMO_MODELS.tts;
  const voiceId = getMimoPresetVoice(settings);

  if (!canStreamMimoTts(settings, route, model)) {
    return { streamed: false, ...(await synthesizeSpeech(text, options)) };
  }

  if (!apiKey) {
    throw new Error("MiMo API key is not configured yet.");
  }

  const response = await fetchWithRateLimitRetry(
    endpoint,
    {
      method: "POST",
      headers: getAuthHeaders(route, apiKey),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: getMimoTtsInstruction(model, voiceId, settings),
          },
          {
            role: "assistant",
            content: text,
          },
        ],
        audio: {
          format: "pcm16",
          voice: voiceId,
        },
        stream: true,
      }),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS.tts, signal: options.signal, label: "Speech synthesis" }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`MiMo streaming TTS failed (${response.status}): ${detail}`);
  }

  let buffer = "";
  let chunkCount = 0;
  await readStreamText(response, (chunk) => {
    buffer += chunk;
    buffer = readSseJsonBuffer(buffer, (json) => {
      const audioBase64 = getAudioDeltaBase64(json);
      if (audioBase64) {
        chunkCount += 1;
        options.onAudio?.({
          audioBase64,
          mimeType: "audio/pcm",
          sampleRate: MIMO_AUDIO_STREAM_SAMPLE_RATE,
        });
      }
    });
  });

  return {
    streamed: true,
    mimeType: "audio/pcm",
    sampleRate: MIMO_AUDIO_STREAM_SAMPLE_RATE,
    chunks: chunkCount,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === "media") {
      const mediaTypes = details?.mediaTypes || [];
      callback(mediaTypes.length === 0 || mediaTypes.includes("audio"));
      return;
    }
    callback(false);
  });

  if (typeof mainWindow.webContents.session.setDevicePermissionHandler === "function") {
    mainWindow.webContents.session.setDevicePermissionHandler((details) => {
      return details.deviceType === "audioInput";
    });
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev && !loadDist) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  await initDatabase();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("messages:list", () => {
  return getAll("SELECT * FROM messages ORDER BY id ASC LIMIT 500").map(normalizeMessage);
});

ipcMain.handle("messages:save", (_event, payload) => {
  return saveMessage(payload.role, payload.content, payload.metadata);
});

ipcMain.handle("settings:get", () => loadSettings());

ipcMain.handle("settings:save", (_event, partial) => saveSettings(partial));

ipcMain.handle("memory:stats", () => {
  const messages = Number(getOne("SELECT COUNT(*) AS count FROM messages").count);
  const summaries = Number(getOne("SELECT COUNT(*) AS count FROM summaries").count);
  const screenshots = Number(getOne("SELECT COUNT(*) AS count FROM screenshots").count);
  return {
    dbPath: paths.dbPath,
    screenshotDir: paths.screenshotDir,
    messages,
    summaries,
    screenshots,
  };
});

ipcMain.handle("memory:export", async () => {
  const result = createMemoryBackup();
  await shell.openPath(result.exportedPath);
  return result;
});

ipcMain.handle("request:cancel", (_event, payload) => {
  const requestId = typeof payload === "string" ? payload : payload?.requestId;
  if (requestId) {
    const controller = activeRequestControllers.get(requestId);
    if (!controller) return { canceled: 0 };
    controller.abort();
    activeRequestControllers.delete(requestId);
    return { canceled: 1 };
  }

  let canceled = 0;
  for (const controller of activeRequestControllers.values()) {
    controller.abort();
    canceled += 1;
  }
  activeRequestControllers.clear();
  return { canceled };
});

ipcMain.handle("chat:send", async (_event, payload) => {
  const content = typeof payload === "string" ? payload : payload?.content || "";
  const context = typeof payload === "object" ? payload?.context || "" : "";
  const requestId = typeof payload === "object" ? payload?.requestId || "" : "";
  const controller = new AbortController();
  const unregister = registerRequestController(requestId, controller);
  try {
    saveMessage("user", content, { source: "chat" });
    const modelContent = context ? `${content}\n\n${context}` : content;
    const answer = await callChatCompletions(buildChatContext(modelContent), {
      signal: controller.signal,
      timeoutMs: REQUEST_TIMEOUT_MS.chat,
    });
    const message = saveMessage("assistant", answer, { source: "chat" });
    compressMemoryIfNeeded().catch((error) => {
      console.error("Memory compression failed:", error);
    });
    return message;
  } finally {
    unregister();
  }
});

ipcMain.handle("chat:stream", async (event, payload) => {
  const content = typeof payload === "string" ? payload : payload?.content || "";
  const context = typeof payload === "object" ? payload?.context || "" : "";
  const requestId = typeof payload === "object" ? payload?.requestId || "" : "";
  const controller = new AbortController();
  const unregister = registerRequestController(requestId, controller);
  try {
    const userMessage = saveMessage("user", content, { source: "chat" });
    sendChatStreamEvent(event.sender, requestId, { type: "user", message: userMessage });
    const modelContent = context ? `${content}\n\n${context}` : content;
    const answer = await callChatCompletionsStream(buildChatContext(modelContent), {
      signal: controller.signal,
      timeoutMs: REQUEST_TIMEOUT_MS.chat,
      onDelta: (delta) => {
        sendChatStreamEvent(event.sender, requestId, { type: "delta", delta });
      },
    });
    const message = saveMessage("assistant", answer, { source: "chat", streamed: true });
    sendChatStreamEvent(event.sender, requestId, { type: "done", message });
    compressMemoryIfNeeded().catch((error) => {
      console.error("Memory compression failed:", error);
    });
    return message;
  } catch (error) {
    sendChatStreamEvent(event.sender, requestId, {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    unregister();
  }
});

ipcMain.handle("speech:transcribe", (_event, payload) => {
  return transcribeAudio(payload.audio, payload.mimeType);
});

ipcMain.handle("speech:synthesize", async (_event, payload = {}) => {
  const requestId = payload?.requestId || "";
  const controller = new AbortController();
  const unregister = registerRequestController(requestId, controller);
  try {
    return await synthesizeSpeech(payload.text, { signal: controller.signal });
  } finally {
    unregister();
  }
});

ipcMain.handle("speech:synthesizeStream", async (event, payload = {}) => {
  const requestId = payload?.requestId || "";
  const controller = new AbortController();
  const unregister = registerRequestController(requestId, controller);
  try {
    const result = await synthesizeSpeechStream(payload.text, {
      signal: controller.signal,
      onAudio: (audio) => {
        sendSpeechStreamEvent(event.sender, requestId, { type: "audio", ...audio });
      },
    });
    sendSpeechStreamEvent(event.sender, requestId, { type: "done", result });
    return result;
  } catch (error) {
    sendSpeechStreamEvent(event.sender, requestId, {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    unregister();
  }
});

ipcMain.handle("screen:observe", async (_event, payload = {}) => {
  const requestId = payload?.requestId || "";
  const controller = new AbortController();
  const unregister = registerRequestController(requestId, controller);
  try {
    const result = await captureScreen({
      force: true,
      saveAssistantMessage: false,
      signal: controller.signal,
    });
    lastScreenObservationAt = Date.now();
    return result;
  } finally {
    unregister();
  }
});

ipcMain.handle("window:alwaysOnTop", (_event, enabled) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(Boolean(enabled));
});

ipcMain.handle("window:minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle("window:close", () => {
  if (mainWindow) mainWindow.close();
});
