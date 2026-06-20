const http = require("http");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const workspaceRoot = path.resolve(__dirname, "..");
const port = Number(process.env.FAIRY_SERVER_PORT || 5174);

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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

let db;
let paths;

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

function locateSqlWasm(file) {
  return path.join(workspaceRoot, "node_modules", "sql.js", "dist", file);
}

function persistDb() {
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
      content: message.content.map((part) => (part?.type === "text" ? { ...part, text: redactSecretsForModel(part.text) } : part)),
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

function loadLocalSecrets() {
  const envProviders = {
    deepseek: { apiKey: process.env.FAIRY_DEEPSEEK_API_KEY || "" },
    mimo: { apiKey: process.env.FAIRY_MIMO_API_KEY || "" },
  };

  let fileSecrets = {};
  try {
    if (fs.existsSync(paths.secretsPath)) {
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
  for (const [key, value] of Object.entries(partial || {})) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) continue;
    db.run(
      "INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      [key, JSON.stringify(value)]
    );
  }
  persistDb();
  return loadSettings();
}

function getRoute(capability) {
  const settings = loadSettings();
  const route = settings.modelRoutes?.[capability] || {};
  const secrets = loadLocalSecrets();
  return {
    baseUrl: route.baseUrl || settings.apiBaseUrl,
    apiKey:
      route.apiKey ||
      secrets.routes?.[capability]?.apiKey ||
      secrets.providers?.[route.provider]?.apiKey ||
      settings.apiKey,
    model:
      route.model ||
      (capability === "vision" ? settings.visionModel : capability === "stt" ? settings.sttModel : settings.chatModel),
    endpoint: route.endpoint || "",
    provider: route.provider || "openai-compatible",
    enabled: route.enabled !== false,
  };
}

function getAuthHeaders(route, apiKey, json = true) {
  const headers = json ? { "Content-Type": "application/json" } : {};
  if (!apiKey) return headers;
  if (route.provider === "mimo") return { ...headers, "api-key": apiKey };
  return { ...headers, Authorization: `Bearer ${apiKey}` };
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

function getRecentMessages(limit = 32) {
  return getAll("SELECT * FROM messages ORDER BY id DESC LIMIT ?", [limit]).reverse().map(normalizeMessage);
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
  const messages = [{ role: "system", content: `${settings.personality}\n\n${FAST_REPLY_INSTRUCTION}` }];
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
  const apiKey = route.apiKey || settings.apiKey;
  const baseUrl = route.baseUrl || settings.apiBaseUrl;
  const model = options.model || route.model || settings.chatModel;
  const maxTokens = clampNumber(options.maxTokens ?? settings.chatMaxTokens, 80, 2000, 280);
  const temperature = options.temperature ?? 0.7;

  if (!apiKey) {
    throw new Error("API key is not configured yet. Add a local secret or route API key in settings.");
  }

  const endpoint = route.endpoint || `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestBody = {
    model,
    messages: messages.map(sanitizeMessageForModel),
    temperature,
  };

  if (route.provider === "mimo") {
    requestBody.max_completion_tokens = maxTokens;
    requestBody.thinking = { type: "disabled" };
  } else {
    requestBody.max_tokens = maxTokens;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getAuthHeaders(route, apiKey),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat API failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function initDatabase() {
  paths = getPaths();
  ensureDir(paths.root);
  ensureDir(paths.screenshotDir);
  ensureDir(paths.exportDir);

  const SQL = await initSqlJs({ locateFile: locateSqlWasm });
  db = fs.existsSync(paths.dbPath) ? new SQL.Database(fs.readFileSync(paths.dbPath)) : new SQL.Database();
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!body) resolve({});
      else {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

async function routeRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/messages") {
    sendJson(res, 200, getAll("SELECT * FROM messages ORDER BY id ASC LIMIT 500").map(normalizeMessage));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    const body = await readJson(req);
    sendJson(res, 200, saveMessage(body.role, body.content, body.metadata));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, loadSettings());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJson(req);
    sendJson(res, 200, saveSettings(body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/memory/stats") {
    sendJson(res, 200, {
      dbPath: paths.dbPath,
      screenshotDir: paths.screenshotDir,
      messages: Number(getOne("SELECT COUNT(*) AS count FROM messages").count),
      summaries: Number(getOne("SELECT COUNT(*) AS count FROM summaries").count),
      screenshots: Number(getOne("SELECT COUNT(*) AS count FROM screenshots").count),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    saveMessage("user", body.content, { source: "web-local-server" });
    const modelContent = body.context ? `${body.content}\n\n${body.context}` : body.content;
    const answer = await callChatCompletions(buildChatContext(modelContent));
    sendJson(res, 200, saveMessage("assistant", answer, { source: "web-local-server" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/memory/export") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportedPath = path.join(paths.exportDir, `fairy-memory-${stamp}`);
    ensureDir(exportedPath);
    fs.copyFileSync(paths.dbPath, path.join(exportedPath, "fairy.sqlite"));
    fs.cpSync(paths.screenshotDir, path.join(exportedPath, "screenshots"), { recursive: true });
    sendJson(res, 200, { exportedPath });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/screen/observe") {
    sendJson(res, 200, {
      saved: false,
      sensitive: false,
      reason: "Screen observation requires the Electron desktop bridge.",
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

initDatabase()
  .then(() => {
    const server = http.createServer((req, res) => {
      routeRequest(req, res).catch((error) => {
        console.error(error);
        sendJson(res, 500, { error: error.message || String(error) });
      });
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`fairy local server listening on http://127.0.0.1:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
