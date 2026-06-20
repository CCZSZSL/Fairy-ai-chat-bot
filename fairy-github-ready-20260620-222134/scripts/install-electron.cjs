const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const electronCache = path.join(root, ".electron-cache");
const tempDir = path.join(root, ".tmp");
const version = require(path.join(root, "node_modules", "electron", "package.json")).version;
const checksums = require(path.join(root, "node_modules", "electron", "checksums.json"));
const zipName = `electron-v${version}-win32-x64.zip`;
const zipPath = path.join(electronCache, zipName);
const distPath = path.join(root, "node_modules", "electron", "dist");

process.env.electron_config_cache = electronCache;
process.env.ELECTRON_CACHE = electronCache;
process.env.ELECTRON_BUILDER_CACHE = path.join(root, ".electron-builder-cache");
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
process.env.TEMP = tempDir;
process.env.TMP = tempDir;

fs.mkdirSync(electronCache, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

if (process.platform === "win32" && process.arch === "x64" && !fs.existsSync(path.join(distPath, "electron.exe"))) {
  const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`;
  const bits = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$ErrorActionPreference='Stop'",
        `Import-Module BitsTransfer`,
        `if (Test-Path -LiteralPath '${zipPath.replaceAll("'", "''")}') { Remove-Item -LiteralPath '${zipPath.replaceAll("'", "''")}' -Force }`,
        `Start-BitsTransfer -Source '${url}' -Destination '${zipPath.replaceAll("'", "''")}' -DisplayName 'fairy-electron-download'`,
        `$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath '${zipPath.replaceAll("'", "''")}').Hash.ToLowerInvariant()`,
        `Write-Host $hash`,
      ].join("; "),
    ],
    { cwd: root, env: process.env, stdio: "inherit" }
  );

  if (bits.status === 0 && fs.existsSync(zipPath)) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    const expected = checksums[zipName];
    if (expected && hash !== expected) {
      console.error(`Checksum mismatch for ${zipName}: expected ${expected}, got ${hash}`);
      process.exit(1);
    }

    const extract = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        [
          "$ErrorActionPreference='Stop'",
          `if (Test-Path -LiteralPath '${distPath.replaceAll("'", "''")}') { Remove-Item -LiteralPath '${distPath.replaceAll("'", "''")}' -Recurse -Force }`,
          `New-Item -ItemType Directory -Force -Path '${distPath.replaceAll("'", "''")}' | Out-Null`,
          `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${distPath.replaceAll("'", "''")}' -Force`,
          `Set-Content -LiteralPath '${path.join(root, "node_modules", "electron", "path.txt").replaceAll("'", "''")}' -Value 'electron.exe' -NoNewline -Encoding ASCII`,
        ].join("; "),
      ],
      { cwd: root, env: process.env, stdio: "inherit" }
    );

    process.exit(extract.status || 0);
  }
}

const result = spawnSync(process.execPath, [path.join(root, "node_modules", "electron", "install.js")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status || 0);
