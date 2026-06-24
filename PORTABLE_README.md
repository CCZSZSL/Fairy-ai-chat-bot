# fairy MiMo portable build

This package is the Windows portable build of fairy optimized for Xiaomi MiMo models.

## Start

Double-click:

```text
open-fairy.cmd
```

No Node.js or pnpm install is required for normal use because the Electron runtime and required dependencies are included in this package.

## MiMo API settings

Open `Set` in fairy and use the MiMo presets, or fill routes manually:

```text
Chat
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-pro
Endpoint: leave empty
API key: your MiMo API key
Enabled: on

Vision
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5
Endpoint: leave empty
API key: your MiMo API key
Enabled: on

Speech recognition
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-asr
Endpoint: leave empty
API key: your MiMo API key
Enabled: on

Speech synthesis
Provider: MiMo
Base URL: https://api.xiaomimimo.com/v1
Model: mimo-v2.5-tts
Voice: 茉莉
Endpoint: leave empty
API key: your MiMo API key
Enabled: on
```

The MiMo TTS route uses low-latency streaming with `audio.format: "pcm16"` and the preset voice `茉莉`.

## Local memory

fairy creates local data here after first launch:

```text
fairy-memory
```

That folder may contain:

```text
fairy.sqlite
secrets.json
screenshots
exports
```

Keep `fairy-memory` private. Do not upload it to GitHub.

To move your memory to another drive, close fairy and set:

```powershell
$env:FAIRY_HOME='E:\fairy-memory'
```

Then start fairy again.

## Privacy defaults

- Screen observation is off by default.
- Vision upload must be explicitly enabled.
- Sensitive-looking screen content is skipped or redacted before model upload.
- API keys are stored locally under `fairy-memory\secrets.json`.

