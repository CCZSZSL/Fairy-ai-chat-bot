# fairy

fairy is a local-first Windows desktop AI companion prototype built with Electron, React, Vite, and SQLite.

It is designed around a simple idea: keep the companion's memory on the user's machine, while allowing model routes to be plugged into external APIs or replaced with local models later.

## Features

- Floating desktop companion window.
- Animated 2D fairy avatar.
- Local SQLite memory for messages, summaries, memories, and screen observations.
- OpenAI-compatible model routes for chat, vision, speech-to-text, and text-to-speech.
- Provider presets for MiMo and DeepSeek.
- Continuous call mode with microphone silence detection.
- On-demand desktop vision triggered by text or voice prompts such as `你看看我在干什么？`.
- Optional local screenshot saving.
- Optional external vision upload.
- Local memory backup with restore hints.
- Basic outbound redaction for common API key, token, password, and private-key patterns.

## Privacy Defaults

- Conversation memory is stored locally in `fairy-memory`.
- API keys are not committed. Use `fairy-memory/secrets.json` or the settings UI.
- Screen vision is request-based, not periodic.
- Vision upload must be enabled before screenshots are sent to an external model.
- Screenshots and voice samples should be treated as private data.

Before publishing your own fork, make sure these are not committed:

- `fairy-memory/`
- `node_modules/`
- `dist/`
- `.tmp/`
- `.electron-cache/`
- voice samples
- screenshots
- API keys

## Requirements

- Windows 10 or newer.
- Node.js 20 or newer.
- pnpm 9 or newer.

## Install

```powershell
pnpm install
pnpm build
```

If Electron's binary download is unstable, you can run:

```powershell
pnpm electron:install
```

## Run

Development mode:

```powershell
pnpm dev
```

Production-style local launch after `pnpm build`:

```powershell
.\open-fairy.cmd
```

Web preview:

```powershell
pnpm dev:web
```

## API Setup

Open fairy settings, then configure `Model Routes`.

Recommended MiMo setup:

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

For the first run, use system speech output:

```text
Voice
Output: Browser voice

tts route
Enabled: off
```

Optional MiMo text-to-speech:

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

You can also place provider keys in `fairy-memory/secrets.json`. Start from:

```text
fairy-memory.example/secrets.example.json
```

## Memory Backup

The settings panel includes `Backup memory`. It exports a private backup folder containing the local SQLite database, screenshots, local secrets if present, and a restore manifest.

Keep backups private.

## Scripts

- `pnpm dev`: run Vite and Electron together.
- `pnpm dev:web`: run the web preview.
- `pnpm dev:server`: run the local web preview bridge.
- `pnpm build`: type-check and build the renderer.
- `pnpm start`: run Electron.
- `pnpm electron:install`: download/extract Electron with local cache paths.

## Project Structure

```text
electron/              Electron main process, preload bridge, local memory
src/                   React renderer app
server/                Local web preview server
scripts/               Helper scripts
fairy-memory.example/  Example secret config
```

## License

MIT
