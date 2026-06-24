# Contributing

Thanks for considering a contribution to fairy.

## Development

```powershell
pnpm install
pnpm dev
```

Before opening a pull request:

```powershell
pnpm typecheck
pnpm build
```

## Privacy

Do not commit local memory, screenshots, voice samples, API keys, exports, caches, or generated dependency folders.

The safest rule: anything under `fairy-memory/` is private user data.

## Scope

Good first areas:

- Provider adapters for more models.
- Local model routes.
- Safer screen privacy controls.
- Memory search and restore tooling.
- Packaging for Windows.
