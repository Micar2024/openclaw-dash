# OpenClaw Dash

A local macOS management dashboard for OpenClaw Gateway. It focuses on practical operations: version checks, gateway control, channel health, compatibility diagnostics, update preflight checks, logs, audit events, memory/disk metrics, and privacy-safe dashboard exports.

## Features

- Local version and upstream version monitoring with GitHub, npm, and dashboard cache fallback.
- Gateway start, restart, stop, and update workflow with step-by-step progress.
- Feishu, Telegram, and Gateway diagnostics using OpenClaw CLI probes and direct API checks.
- Compatibility self-check for the OpenClaw CLI commands the dashboard depends on.
- Update preflight checks for version diff, disk space, CLI compatibility, Gateway state, and channel probes.
- Channel stats, recent errors, operation audit log, and fault timeline.
- Memory and disk monitoring for macOS.
- Read-only configuration health view for channel enablement, allowlist counts, and `blockStreaming`.
- Log noise muting for known harmless lines such as `bot open_id resolved: unknown`.
- High-resolution long screenshot export with automatic masking for common private identifiers.

## Requirements

- macOS
- Node.js 18 or newer
- OpenClaw CLI installed and available at `~/.npm-global/bin/openclaw` or in PATH
- OpenClaw configured locally under `~/.openclaw`

## Project Status

This is a macOS-first local operations dashboard. It is suitable for personal OpenClaw Gateway management and is being hardened toward broader community use.

Current guardrails:

- CI smoke test on GitHub Actions.
- Server syntax check and frontend inline-script parse check.
- Security smoke check that blocks shell-string `exec()` usage.
- Command execution uses `execFile` or `spawn` with argument arrays where system tools are needed.
- Frontend runtime assets are served locally from `public/assets` and `public/vendor`.

Known engineering work still planned:

- Split the large `server.js` into focused modules.
- Add endpoint-level unit tests with mocked OpenClaw CLI responses.
- Make OpenClaw binary path discovery configurable across more install locations.
- Add a unified frontend API error banner/toast pattern.
- Evaluate WebSocket push for Gateway/channel events after the API surface stabilizes.
- Keep Linux/Windows support out of scope until OpenClaw Gateway operations are validated there.

Tested locally with OpenClaw `2026.5.3` on macOS. The dashboard includes `/api/compatibility` to check whether the installed OpenClaw CLI exposes the commands and JSON fields it depends on.

## Quick Start

```bash
git clone https://github.com/Micar2024/openclaw-dash.git
cd openclaw-dash
npm install
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

The dashboard binds to `127.0.0.1` by default. Local browser access can sign in without manually reading the token. Remote access requires the dashboard token.

## Configuration

Optional environment variables:

```bash
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=3000
OPENCLAW_GATEWAY_PORT=18789
DASHBOARD_TOKEN=your-token
OPENCLAW_DASH_FEISHU_APP_ID=your-feishu-app-id
OPENCLAW_DASH_FEISHU_APP_SECRET=your-feishu-app-secret
```

If `DASHBOARD_TOKEN` is not provided, the app creates a local fallback token at:

```text
~/.openclaw/dash-token
```

Runtime files are stored under `~/.openclaw`:

- `dash-audit.log`
- `dash-update-job.json`
- `dash-version-cache.json`
- `dash-log-muted-rules.json`

These files are intentionally not part of the repository.

Feishu direct diagnostics prefer `OPENCLAW_DASH_FEISHU_APP_ID` and `OPENCLAW_DASH_FEISHU_APP_SECRET` when present. If they are not set, the dashboard falls back to the local OpenClaw config and known credential-file shapes for compatibility, but it reports the credential source without exposing secret values. Supported credential fields are:

```json
{
  "appSecret": "string",
  "app_secret": "string",
  "lark": { "appSecret": "string", "app_secret": "string" },
  "feishu": { "appSecret": "string", "app_secret": "string" }
}
```

## macOS LaunchAgent

You can run the dashboard at login with a LaunchAgent. Adjust paths if your project lives somewhere else.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOUR_USER/openclaw-dash/scripts/start-dashboard.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_USER/openclaw-dash/logs/dashboard.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USER/openclaw-dash/logs/dashboard.err.log</string>
</dict>
</plist>
```

Install it:

```bash
mkdir -p ~/Library/LaunchAgents ~/openclaw-dash/logs
cp com.openclaw.dashboard.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.dashboard.plist
launchctl kickstart -k gui/$(id -u)/com.openclaw.dashboard
```

## Safety Notes

- The dashboard is designed for local use and binds to `127.0.0.1` by default.
- It does not edit OpenClaw configuration files.
- Control actions are limited to OpenClaw Gateway operations and update orchestration.
- Channel "real verification" sends a test message only after explicit confirmation.
- Screenshot export masks common private identifiers in the exported copy.

Authentication design:

- All `/api/*` routes require authentication except `/api/auth/*`.
- Local browser access from `127.0.0.1` can create an HttpOnly session cookie through `/api/auth/local-login`.
- Remote access requires a bearer token. If `DASHBOARD_TOKEN` is not set, a random token is generated at `~/.openclaw/dash-token` with file mode `0600`.
- Session cookies are HMAC-SHA256 signed with the dashboard token and checked with `crypto.timingSafeEqual`.
- Operations are appended to `~/.openclaw/dash-audit.log`.

Screenshot export masks these patterns in the exported copy:

- Feishu/OpenClaw IDs beginning with `ou_` or `cli_`.
- Long numeric identifiers.
- IPv4 addresses.
- `PID: <number>` values.
- Local `/Users/...` filesystem paths.

## Development

```bash
npm test
npm run build:assets
npm run check
npm start
```

## License

MIT
