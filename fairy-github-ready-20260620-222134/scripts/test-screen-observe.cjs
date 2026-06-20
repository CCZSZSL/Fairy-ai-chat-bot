const { app, desktopCapturer, screen: electronScreen } = require("electron");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const workspaceRoot = path.resolve(__dirname, "..");
const memoryRoot = process.env.FAIRY_HOME || path.join(workspaceRoot, "fairy-memory");
const dbPath = path.join(memoryRoot, "fairy.sqlite");
const secretsPath = path.join(memoryRoot, "secrets.json");
const screenshotDir = path.join(memoryRoot, "screenshots");
const resultDir = path.join(memoryRoot, "screen-tests");

const fallbackSensitiveKeywords = [
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
  "隐私",
  "密码",
  "支付",
  "付款",
  "银行",
  "钱包",
  "密钥",
  "私钥",
  "助记词",
  "身份证",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function normalizeSettings(rows) {
  const settings = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value_json);
    } catch {
      settings[row.key] = row.value_json;
    }
  }
  return settings;
}

async function loadSettings() {
  if (!fs.existsSync(dbPath)) return {};
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(workspaceRoot, "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const stmt = db.prepare("SELECT key, value_json FROM settings");
  const rows = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return normalizeSettings(rows);
}

function getRoute(settings, capability) {
  const route = settings.modelRoutes?.[capability] || {};
  const secrets = parseJsonFile(secretsPath);
  return {
    provider: route.provider || "openai-compatible",
    baseUrl: route.baseUrl || settings.apiBaseUrl || "https://api.openai.com/v1",
    model: route.model || settings.visionModel || settings.chatModel,
    endpoint: route.endpoint || "",
    apiKey:
      route.apiKey ||
      secrets.routes?.[capability]?.apiKey ||
      secrets.providers?.[route.provider]?.apiKey ||
      settings.apiKey ||
      "",
    enabled: route.enabled !== false,
  };
}

function getAuthHeaders(route) {
  if (route.provider === "mimo") {
    return { "Content-Type": "application/json", "api-key": route.apiKey };
  }
  return { "Content-Type": "application/json", Authorization: `Bearer ${route.apiKey}` };
}

function isSensitiveSourceName(sourceName, settings) {
  const lower = String(sourceName || "").toLowerCase();
  const keywords = Array.isArray(settings.screenSensitiveKeywords)
    ? settings.screenSensitiveKeywords
    : fallbackSensitiveKeywords;
  return keywords
    .map((keyword) => String(keyword || "").trim().toLowerCase())
    .filter(Boolean)
    .some((keyword) => lower.includes(keyword));
}

function isUnsafeForTest(sourceName, settings) {
  const lower = String(sourceName || "").toLowerCase();
  const privateAppHints = ["codex", "微信", "weixin", "discord", "kook", "fairy"];
  return isSensitiveSourceName(sourceName, settings) || privateAppHints.some((hint) => lower.includes(hint.toLowerCase()));
}

function selectSafeSource(sources, settings, targetHint) {
  const windows = sources.filter((source) => source.name && source.id.startsWith("window:"));
  const safeWindows = windows.filter((source) => !isUnsafeForTest(source.name, settings));
  if (targetHint) {
    const target = safeWindows.find((source) => source.name.toLowerCase().includes(targetHint.toLowerCase()));
    if (target) return target;
  }
  return (
    safeWindows.find((source) => source.name.toLowerCase().includes("new tab")) ||
    safeWindows.find((source) => source.name.includes("设置")) ||
    safeWindows[0] ||
    null
  );
}

function getDesktopThumbnailSize() {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  return {
    width: Math.round(primaryDisplay.size.width * scaleFactor),
    height: Math.round(primaryDisplay.size.height * scaleFactor),
  };
}

function selectDesktopSource(sources, targetHint) {
  const screens = sources.filter((source) => source.id?.startsWith("screen:"));
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  if (targetHint) {
    const target = screens.find((source) => source.name.toLowerCase().includes(targetHint.toLowerCase()));
    if (target) return target;
  }
  return (
    screens.find((source) => String(source.display_id) === String(primaryDisplay.id)) ||
    screens.find((source) => /desktop|screen|\u5c4f\u5e55|\u684c\u9762/i.test(source.name || "")) ||
    screens[0] ||
    null
  );
}

async function analyzeImage(route, imageBase64, sourceName) {
  const endpoint = route.endpoint || `${route.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt =
    "You are testing fairy's desktop screen recognition. Return only compact JSON with keys: analysis, visibleText, shouldSpeak, message. Briefly identify what is visible on the full desktop screenshot and give a short natural Chinese message fairy could say. If sensitive-looking content is visible, mention that sensitive content may be on screen without copying exact secrets, keys, card numbers, passwords, or identity numbers.";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: getAuthHeaders(route),
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${prompt}\nWindow title: ${sourceName}` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 500,
      thinking: { type: "disabled" },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Vision request failed (${response.status}): ${body.slice(0, 800)}`);
  }
  return body.trim();
}

async function main() {
  ensureDir(screenshotDir);
  ensureDir(resultDir);
  const targetHintIndex = process.argv.findIndex((arg) => arg === "--target");
  const targetHint = targetHintIndex >= 0 ? process.argv[targetHintIndex + 1] : "";
  const settings = await loadSettings();
  const route = getRoute(settings, "vision");

  if (!route.enabled) throw new Error("Vision route is disabled.");
  if (!route.apiKey) throw new Error("Vision route API key is not configured.");

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: getDesktopThumbnailSize(),
    fetchWindowIcons: false,
  });

  const source = selectDesktopSource(sources, targetHint);
  if (!source) {
    throw new Error(`No desktop screen found. Available: ${sources.map((item) => item.name).join(" | ")}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(screenshotDir, `screen-test-${stamp}.png`);
  fs.writeFileSync(screenshotPath, source.thumbnail.toPNG());

  const raw = await analyzeImage(route, source.thumbnail.toPNG().toString("base64"), source.name);
  const resultPath = path.join(resultDir, `screen-test-${stamp}.json`);
  const result = {
    ok: true,
    sourceName: source.name,
    screenshotPath,
    resultPath,
    provider: route.provider,
    model: route.model,
    raw,
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => app.quit());
