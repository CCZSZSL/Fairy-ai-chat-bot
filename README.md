# fairy

fairy is a local-first Windows desktop AI companion prototype.

It is built with Electron, React, Vite, and SQLite. The goal is to create a small always-available companion that can talk with you, remember long-running context locally, and optionally understand your current desktop screen when you explicitly ask it to look.

> Status: early prototype. It works as a local desktop MVP, but packaging, privacy controls, provider adapters, and long-term memory retrieval still need more hardening.

## Why fairy exists

Most chatbots feel like remote tools. fairy explores a different shape:

- a desktop companion that stays close to your workflow
- local memory as the default source of continuity
- external APIs as optional model routes, not the only possible backend
- voice-first interaction that feels closer to a phone call
- screen understanding only when the user asks for it

The long-term direction is a "code-life companion": an assistant that can gradually learn your projects, preferences, emotional context, and recurring work patterns while keeping raw memory on your own device.

## Features

- Floating desktop window for Windows.
- Frameless always-on-top companion UI.
- Animated 2D fairy avatar.
- Local SQLite memory for:
  - raw messages
  - rolling summaries
  - long-term memory records
  - screenshot observations
- Multi-route model interface:
  - `chat`
  - `vision`
  - `stt`
  - `tts`
- OpenAI-compatible API shape for common providers.
- Built-in presets for MiMo and DeepSeek.
- Continuous call mode:
  - microphone input
  - voice activity detection
  - external speech recognition
  - text response
  - spoken reply
- On-demand desktop vision triggered by natural text or voice prompts.
- Optional local screenshot saving.
- Optional external vision upload.
- Request timeout and cancel support.
- Local memory backup with restore notes.
- Outbound redaction for common API key, token, password, and private-key patterns.

## What fairy is not yet

- Not a polished production app.
- Not a finished installer.
- Not a privacy-audited security product.
- Not a local model runtime yet.
- Not a full agent framework.
- Not cross-platform yet.

The current target is Windows first. Linux and macOS support can be added later.

## Tech Stack

- Electron for the desktop shell.
- React for the renderer UI.
- Vite for development and build.
- sql.js for local SQLite-style memory.
- lucide-react for icons.
- PowerShell helper scripts for Windows launch workflows.

## Project Structure

```text
electron/
  main.cjs              Electron main process, local memory, provider calls
  preload.cjs           Safe renderer bridge
  preload.d.ts          TypeScript bridge types

src/
  App.tsx               Main React app
  mockBridge.ts         Browser/web-preview bridge fallback
  styles.css            App styles
  components/
    FairyAvatar.tsx
    SettingsPanel.tsx

server/
  fairy-local-server.cjs

scripts/
  open-fairy.ps1
  start-fairy-web-shell.ps1
  set-mimo-key.ps1
  install-electron.cjs
  test-screen-observe.cjs

fairy-memory.example/
  secrets.example.json
```

## Privacy Model

fairy is designed to be local-first.

By default, user memory is stored under:

```text
fairy-memory/
```

That folder may contain:

- conversation history
- summaries
- screenshots
- screen analysis
- voice samples
- API keys
- backups

Do not publish `fairy-memory/`.

The repository `.gitignore` is configured to exclude local memory, generated builds, dependency folders, caches, screenshots, audio files, and databases.

## External Model Calls

fairy can call external APIs if you configure them.

External routes are separated by capability:

```text
chat    normal conversation
vision  desktop screenshot understanding
stt     speech-to-text
tts     text-to-speech
```

Before text is sent to a model route, fairy applies basic redaction for common secret patterns. This is a helpful guardrail, not a complete data-loss-prevention system.

When `Use vision on request` is enabled, screenshots may be sent to your configured vision provider after you ask fairy to look at the screen.

## Requirements

- Windows 10 or newer.
- Node.js 20 or newer.
- pnpm 9 or newer.

Recommended:

- A stable network connection for Electron and model provider downloads.
- A provider API key for chat.
- A multimodal provider key if you want screen understanding.

## Install

```powershell
pnpm install
pnpm build
```

If Electron fails to download through the default install flow, try:

```powershell
pnpm electron:install
```

## Run

Development mode:

```powershell
pnpm dev
```

Production-style local launch after build:

```powershell
.\open-fairy.cmd
```

Web preview:

```powershell
pnpm dev:web
```

Optional browser-shell preview:

```powershell
pnpm shell:web
```

## First Setup

1. Install dependencies.
2. Build the app.
3. Launch fairy.
4. Open settings.
5. Configure model routes.
6. Start with browser/system voice output.
7. Enable vision only if you want screenshots to be analyzed by an external provider.

## API Setup

Open fairy settings and configure `Model Routes`.

### MiMo Example

```text
chat
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-pro
Endpoint: leave empty
API key: your MiMo API key
Enabled: on

vision
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5
Endpoint: leave empty
API key: your MiMo API key
Enabled: on

stt
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-asr
Endpoint: leave empty
API key: your MiMo API key
Enabled: on
```

For the first run, keep voice output simple:

```text
Voice
Output: Browser voice

tts route
Enabled: off
```

Optional MiMo-generated speech:

```text
tts
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-tts
Endpoint: leave empty
API key: your MiMo API key
Enabled: on
```

For desktop recognition:

```text
Screen
Use vision on request: on
```

Then fairy can respond to prompts like:

```text
你看看我在干什么？
屏幕右上角这个怎么办？
帮我看一下这个窗口
```

### DeepSeek Example

DeepSeek can be used for chat routes:

```text
chat
Provider: DeepSeek
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
Endpoint: leave empty
API key: your DeepSeek API key
Enabled: on
```

Use a separate multimodal provider for `vision` if the selected chat provider does not support images.

## Local Secrets File

You can keep API keys outside the settings UI by creating:

```text
fairy-memory/secrets.json
```

Start from:

```text
fairy-memory.example/secrets.example.json
```

Example shape:

```json
{
  "providers": {
    "mimo": {
      "apiKey": "paste-mimo-api-key-here"
    },
    "deepseek": {
      "apiKey": "paste-deepseek-api-key-here"
    }
  }
}
```

There is also a helper script:

```powershell
.\scripts\set-mimo-key.ps1
```

## Screen Understanding

fairy does not continuously upload your screen.

The current behavior is request-based. If a user asks something that sounds like a screen question, fairy captures the desktop, optionally saves the screenshot locally, optionally sends it to the vision route, and then uses the returned analysis as context for the chat response.

Example trigger phrases:

```text
你看看我在干什么？
看我在干啥呢？
屏幕右上角这个怎么办？
这东西怎么处理？
```

If `Use vision on request` is off, fairy stores or reports local-only observation behavior and does not use external vision.

## Voice Mode

Call mode listens through the microphone and segments speech using silence detection.

Flow:

```text
microphone -> speech segment -> STT route -> chat route -> spoken reply
```

The current prototype focuses on responsiveness rather than perfect transcription. Speech recognition quality depends heavily on the selected STT provider and microphone environment.

## Memory

fairy stores raw conversation locally. When context grows, it creates rolling summaries to reduce token use while preserving continuity.

Current memory layers:

- raw messages
- rolling summaries
- memory table for durable facts
- screenshot observation table

Future work should improve retrieval, memory editing, user-controlled forgetting, and migration tooling.

## Backup and Restore

The settings panel includes `Backup memory`.

Backup output may include:

- `fairy.sqlite`
- `secrets.json`
- `screenshots/`
- `fairy-backup-manifest.json`
- `RESTORE.txt`

Backups can contain private data. Keep them private.

## Development Commands

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

Other scripts:

```powershell
pnpm dev:web
pnpm dev:server
pnpm shell:web
pnpm electron:install
pnpm start
```

## Troubleshooting

### Electron did not download

Run:

```powershell
pnpm electron:install
```

If the network is unstable, configure an Electron mirror or retry later.

### The app says the API key is missing

Open settings and fill the relevant model route API key, or create `fairy-memory/secrets.json`.

### Screen questions still answer like text-only chat

Check:

- `vision` route is enabled.
- `Use vision on request` is enabled.
- The selected model supports image input.
- The prompt actually asks fairy to look at the screen.

### Speech recognition is inaccurate

Try:

- using a better microphone
- lowering background noise
- switching STT provider
- setting the STT model route explicitly

### The response is slow

Possible causes:

- full desktop screenshot upload
- slow multimodal model
- slow STT or TTS provider
- network latency

fairy has timeout and cancel support, but provider speed still matters.

## Roadmap

- Windows installer.
- Provider adapter abstraction.
- Better local model support.
- Smarter memory retrieval.
- Memory editor and forgetting controls.
- More robust privacy controls for screen capture.
- Optional region-based screen capture.
- Better interruption and streaming voice UX.
- 3D avatar mode.
- Cross-platform support.

## Contributing

Contributions are welcome. See `CONTRIBUTING.md`.

Please do not commit private memory, screenshots, voice samples, API keys, generated builds, dependency folders, or caches.

## Security

See `SECURITY.md`.

This is an experimental prototype. Review provider behavior and your local data before using it with sensitive work.

## License

MIT
