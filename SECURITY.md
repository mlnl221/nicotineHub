# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` (latest release) | ✅ |
| `stage` (development) | ✅ (report; may be fixed forward) |
| Older tags (`< latest`) | ❌ please upgrade |

## Reporting a vulnerability

**Do not open a public issue.** Report via [private security advisory](https://github.com/mlnl221/nicotineHub/security/advisories/new).

Include: affected version/commit, steps to reproduce, impact, and (optionally) a suggested fix. You should receive an initial response within 7 days. Please allow time for a fix + release before public disclosure.

## Notes specific to this project

- **Soulseek is unencrypted and sends passwords in plaintext.** The app deliberately never stores passwords (see `README.md` Security). Never include credentials, `BRIDGE_TOKEN` values, or share paths in bug reports, logs, or screenshots.
- If you run the bridge publicly exposed, set `BRIDGE_TOKEN` and `ALLOWED_ORIGINS` (see [`docs/architecture.md#env-full`](./docs/architecture.md#env-full)).
