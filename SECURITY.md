# Security

fairy is an early local-first companion prototype. Treat it as experimental.

## Sensitive Data

The app can store:

- conversation history
- summaries and memories
- screenshots
- voice samples
- API keys

By default these live under `fairy-memory/`. Do not publish that folder.

## Reporting Issues

If you find a security or privacy issue, please open a private advisory if the repository supports it. Otherwise, contact the maintainer without posting secrets or screenshots publicly.

## Provider Risk

When external model routes are enabled, selected text, audio, or screenshots may be sent to the configured provider. Users should review provider policies and keep vision upload disabled unless they intend to use it.
