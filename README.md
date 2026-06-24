# fairy

fairy is a local-first AI companion prototype for Windows. The current MVP is built with React, Vite, and an Electron bridge layer.

## Current MVP

- Floating companion window UI with a 2D animated fairy avatar.
- Local-first memory schema through SQLite in the Electron bridge.
- Full raw messages are stored; rolling summaries are added when context grows.
- Capability-based model routes:
  - `chat` for normal conversation.
  - `vision` for strong multimodal screen understanding.
  - `stt` for external speech recognition.
  - `tts` for MiMo preset speech synthesis, voice clone, or a custom voice endpoint.
- Built-in route presets:
  - DeepSeek: `https://api.deepseek.com`, `deepseek-v4-flash`, `deepseek-v4-pro`.
  - MiMo: `https://api.xiaomimimo.com/v1`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2.5-asr`, `mimo-v2.5-tts`.
  - Ollama local models: `qwen3.5:4b`, `qwen3.5:9b`, `qwen3.6:27b`, `qwen3.6:35b`.
  - Local OpenAI-compatible servers such as LM Studio, llama.cpp server, SGLang, vLLM.
- Continuous call mode in the UI: microphone audio is segmented by silence, transcribed, sent to chat, and spoken back.
- Optional screen observation switch, default off.
- Screenshot storage and analysis are local by default. Vision upload must be explicitly enabled.
- Sensitive source names are skipped before saving or analyzing screenshots.
- Raw conversation memory stays local. Before context is sent to an external model, common API keys, tokens, passwords, and private-key blocks are redacted in the outbound request.

## Local Paths

This project keeps local data and caches outside the application bundle where possible:

- pnpm store: `<project-root>\.pnpm-store`
- pnpm cache: `<project-root>\.pnpm-cache`
- Electron cache script target: `<project-root>\.electron-cache`
- temp download directory: `<project-root>\.tmp`
- fairy memory: `<project-root>\fairy-memory`
- recommended Ollama model storage on Windows: `E:\ollama-models`

You can override the memory root with:

```powershell
$env:FAIRY_HOME='E:\fairy-memory'
```

Secrets are read from:

```text
<project-root>\fairy-memory\secrets.json
```

Set the MiMo key without putting it into command history:

```powershell
.\scripts\set-mimo-key.ps1
```

## Run

Install dependencies, then run the web preview:

```powershell
pnpm install
pnpm dev:web
```

The web preview runs at:

```text
http://127.0.0.1:5173/
```

You can also open a desktop-like Chrome app window without installing Electron:

```powershell
pnpm shell:web
```

This uses the existing system Chrome or Edge and stores its profile under:

```text
<project-root>\.chrome-fairy-profile
```

Desktop mode uses Electron:

```powershell
pnpm electron:install
pnpm dev
```

Electron's binary download may need a stable connection or a configured mirror.

## Privacy Defaults

- Screen observation is off by default.
- Vision upload is off by default.
- Screenshot images are saved only under `fairy-memory/screenshots`.
- Sensitive window keywords are editable in settings.
- Local memory export copies the SQLite database and screenshot folder into `fairy-memory/exports`.
- Text sent to external model routes is redacted for common secret patterns; local raw memory is not altered.

## Provider Notes

- DeepSeek uses the OpenAI-compatible chat completions shape with `Authorization: Bearer <key>`.
- MiMo uses the OpenAI-compatible `https://api.xiaomimimo.com/v1/chat/completions` endpoint and authenticates with `api-key: <key>`.
- MiMo chat/vision requests use `max_completion_tokens` and `thinking: { "type": "disabled" }` for fast companion replies.
- MiMo ASR uses `mimo-v2.5-asr`, `input_audio.data` data URLs, and `asr_options.language: "zh"` for Chinese call mode.
- MiMo TTS uses `mimo-v2.5-tts` with preset `audio.voice: "茉莉"` by default.
- MiMo low-latency TTS uses `stream: true` with `audio.format: "pcm16"` and plays returned 24 kHz PCM16 chunks through Web Audio.
- MiMo voice design and voice clone routes remain available, but they fall back to non-streaming synthesis because the current low-latency stream is for preset `mimo-v2.5-tts`.
- Local OpenAI-compatible routes do not require an API key. Use a base URL like `http://127.0.0.1:1234/v1`.
- Ollama routes do not require an API key. Use `http://127.0.0.1:11434` and model names such as `qwen3.5:4b`, `qwen3.5:9b`, or `qwen3.6:27b`.

## Local Model Setup

### Ollama + Qwen

Install Ollama, put model files outside the C drive, then start the Ollama server yourself in a separate terminal:

```powershell
mkdir E:\ollama-models
setx OLLAMA_MODELS "E:\ollama-models"
ollama serve
```

Recommended first local companion model:

```powershell
ollama pull qwen3.5:9b
```

Other options:

```powershell
ollama pull qwen3.5:4b
ollama pull qwen3.5:9b
ollama pull qwen3.6:27b
ollama pull qwen3.6:35b
```

In fairy settings:

```text
chat
Provider: Ollama
Base URL: http://127.0.0.1:11434
Model: qwen3.5:9b
Endpoint: leave empty
API key: leave empty
Enabled: on
```

fairy only calls the local Ollama HTTP API. It does not start or manage the Ollama process. Before using an Ollama route, make sure `ollama serve` is already running at:

```text
http://127.0.0.1:11434
```

For local screen understanding, apply the same Ollama preset to `vision` and enable:

```text
Screen
Use vision on request: on
```

Notes:

- Qwen3.6 is newer and stronger, but much heavier.
- Qwen3.5 4B/9B is a better first local test for normal machines.
- Local vision quality depends on the selected model and available hardware.
- A practical hybrid setup is local Ollama `qwen3.5:9b` for chat/vision plus MiMo `mimo-v2.5-tts` for cloud speech synthesis.

### Intel Arc / Vulkan GPU Mode

For Intel Arc integrated GPUs on Windows, set these variables in the terminal where you manually start Ollama:

```powershell
$env:OLLAMA_VULKAN = "1"
$env:OLLAMA_LLM_LIBRARY = "vulkan"
$env:OLLAMA_IGPU_ENABLE = "1"
$env:GGML_VK_VISIBLE_DEVICES = "0"
$env:OLLAMA_FLASH_ATTENTION = "0"
ollama serve
```

You can verify GPU placement with:

```powershell
ollama ps
```

Expected result for the current recommended local model:

```text
qwen3.5:9b    PROCESSOR    100% GPU
```

### LM Studio / llama.cpp / vLLM / SGLang

Start a local OpenAI-compatible server, then configure:

```text
chat
Provider: Local OpenAI
Base URL: http://127.0.0.1:1234/v1
Model: local-model
Endpoint: leave empty
API key: leave empty
Enabled: on
```

If your server exposes a nonstandard path, put the full URL in `Endpoint`.

## Verify

```powershell
pnpm typecheck
pnpm build
```
