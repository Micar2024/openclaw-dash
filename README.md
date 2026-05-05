# OpenClaw Dash — 社区诊断工具箱

A lightweight local diagnostic toolkit for the OpenClaw community. Open the dashboard, export a privacy-masked report, paste it in Discord or your support group, and others can see the facts immediately.

![OpenClaw Dash overview](docs/images/dashboard-overview.svg)

## 使用场景

- **「我的 OpenClaw 出问题了，帮我看一下」** — 打开看板，一键导出脱敏诊断报告或求助包，贴到社区求助，不用描述版本/配置/报错
- **升级前先体检** — 运行更新预检，确认磁盘空间、CLI 兼容性、通道在线状态，防止升级翻车
- **日常健康巡检** — 看一眼健康评分，确认 Gateway 运行时长、飞书/Telegram 是否在线、有没有积压错误
- **自检配置** — 只读查看通道启用状态、allowlist、blockStreaming 等配置健康度

## Features

- Local version and upstream version monitoring with GitHub, npm, and dashboard cache fallback.
- Gateway start, restart, stop, and update workflow with step-by-step progress.
- Dynamic channel diagnostics using OpenClaw CLI probes, logs, and direct API checks where supported.
- Compatibility self-check for the OpenClaw CLI commands the dashboard depends on.
- Update preflight checks for version diff, disk space, CLI compatibility, Gateway state, and channel probes.
- Channel stats, recent errors, operation audit log, and fault timeline.
- Dynamic channel grid for Feishu, Telegram, Email, and future OpenClaw channels discovered from config/probe output.
- WebSocket realtime push for Gateway and channel state, with polling as a fallback.
- Memory and disk monitoring for macOS.
- Read-only configuration health view for channel enablement, allowlist counts, and `blockStreaming`.
- Log noise muting for known harmless lines such as `bot open_id resolved: unknown`.
- High-resolution long screenshot export with automatic masking for common private identifiers.
- First-run wizard for OpenClaw CLI, Gateway, log paths, config readability, token, LaunchAgent, and access mode.
- Health score and daily summary across Gateway, channels, version, disk, and recent errors.
- Partial Markdown report export for diagnostics, version, channel, resource, and redacted error summaries.
- Support bundle export (`.tar.gz`) with report, environment, metrics, diagnostics, compatibility, config health, and redacted errors.

![Realtime monitoring flow](docs/images/realtime-flow.svg)

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
- Semistandard linting runs in CI.
- Endpoint smoke tests run against a mocked local OpenClaw CLI fixture.

Known engineering work still planned:

- Make OpenClaw binary path discovery configurable across more install locations.
- Keep Linux/Windows support out of scope until OpenClaw Gateway operations are validated there.

Tested locally with OpenClaw `2026.5.3` on macOS. The dashboard includes `/api/compatibility` to check whether the installed OpenClaw CLI exposes the commands and JSON fields it depends on.

## Quick Start

**一行命令安装（macOS）：**

```bash
curl -fsSL https://raw.githubusercontent.com/Micar2024/openclaw-dash/main/install.sh | bash
```

完成后打开 `http://127.0.0.1:3000`。首次运行向导会引导你完成设置。

安装脚本会检测 Node.js，下载或更新源码，安装依赖，构建本地前端资源，并写入 macOS LaunchAgent。它不会覆盖已有本地改动；如果 `~/openclaw-dash` 不是 git 仓库，会先备份再安装。

**手动安装：**

```bash
git clone https://github.com/Micar2024/openclaw-dash.git
cd openclaw-dash
npm install
npm start
```

然后打开 `http://127.0.0.1:3000`。

**装为 macOS 登录项（手动安装后）：**

```bash
bash scripts/install-macos.sh
```

自动安装依赖、编译前端资源、写入 LaunchAgent 并启动服务。

（一行命令安装已包含此步骤，无需单独执行。）

**遇到问题了？** 打开看板 → 点击「导出报告」或「导出求助包」→ 把脱敏结果贴到社区。报告和求助包已自动脱敏，包含版本、Gateway 状态、通道健康、系统资源、近期错误和诊断建议。

## 诊断原则

OpenClaw Dash 的主线不是替代 OpenClaw，也不是做重型监控平台，而是生成一份社区能读懂的标准诊断报告。

数据源按稳定性分层：

- **第一层：本机事实** — Gateway 进程、日志文件、磁盘、内存、macOS、Node.js。这些不依赖 Gateway 是否正常。
- **第二层：OpenClaw 基础 CLI** — `openclaw --version`、`openclaw doctor` 等用于补充版本和兼容性。
- **第三层：OpenClaw JSON/探针能力** — 通道 probe、模型运行态等增强信息。失败时不会阻止报告生成。

因此即使 Gateway 已经挂掉，Dashboard 也应该能导出半份有用报告：进程不在、最后日志时间、近期错误、系统状态、只读配置健康和版本线索。Markdown 报告采用分段容错策略，单个数据源失败不会阻止整份报告生成。

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

The recommended path is the installer:

```bash
./scripts/install-macos.sh
```

Manual LaunchAgent setup is also possible. Adjust paths if your project lives somewhere else.

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

## 常见问题排查

### Gateway 无法启动

1. 终端跑 `openclaw --version`，确认 CLI 可用
2. 检查端口 18789 是否被占用：`lsof -i :18789`
3. 检查 `~/.openclaw/openclaw.json` 是否有语法错误：`openclaw doctor`
4. 从看板导出诊断报告去 [OpenClaw Discord](https://discord.com/invite/clawd) 求助

### 飞书/Telegram 离线

1. 等 5 分钟（Gateway 重连有缓冲区）
2. 确认网络正常：`curl -I https://open.feishu.cn`
3. 重启 Gateway（看板控制区点「重启」按钮）
4. 如果飞书一直离线，检查应用后台 appSecret 是否过期
5. 导出诊断报告，看「近期错误」面板是否有飞书/Telegram 相关报错

### 健康评分持续偏低

- 确认所有通道在线
- 检查近期错误面板是否有积压异常
- 运行一次自检（看板「健康诊断」面板的「运行探测」按钮）
- 截图导出（已自动脱敏）去社区求助

### 更新后看板异常

- 看板自身的启动日志在 `~/openclaw-dash/logs/dashboard.err.log`
- 确认 Node.js 版本 ≥18：`node -v`
- 重新安装：`curl -fsSL https://raw.githubusercontent.com/Micar2024/openclaw-dash/main/install.sh | bash` 会自动更新

## Safety Notes

- The dashboard is designed for local use and binds to `127.0.0.1` by default.
- Setting `DASHBOARD_HOST=0.0.0.0` enables LAN access. Only do this on a trusted network, and keep `~/.openclaw/dash-token` private.
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

Screenshot and Markdown report export mask these patterns in the exported copy:

- Feishu/OpenClaw IDs beginning with `ou_` or `cli_`.
- Long numeric identifiers.
- IPv4 addresses.
- `PID: <number>` values.
- Local `/Users/...` filesystem paths.
- Common token/secret strings, email addresses, and Telegram-style bot tokens.

## Development

```bash
npm test
npm run lint
npm run build:assets
npm run check
npm start
```

The server is organized as a route aggregator plus focused support modules under `src/server/`:

- `config.js` for paths, ports, and runtime constants.
- `runtime.js` for filesystem and system-command helpers.
- `processes.js` for process/memory display helpers.
- `realtime.js` for WebSocket state streaming.
- `auth-service.js` for token/session auth, local login, API guard middleware, and audit entries.
- `gateway-service.js` for Gateway process detection, control commands, and watchdog alerts.
- `channel-service.js` for channel health inference, message stats, real verification, and channel watchdog alerts.
- `version-service.js` for local/upstream version checks and version source health.
- `diagnostics-service.js` for model detection, OpenClaw probes, compatibility checks, Feishu direct diagnostics, and config health.
- `metrics-service.js` for Gateway, channel, disk, memory, process, model, and version metrics aggregation.
- `update-service.js` for update job persistence, preflight checks, update steps, doctor, restart, and post-update diagnostics.
- `reports.js` for Markdown report rendering.
- `timeline.js` for fault timeline aggregation.
- `routes/auth.js` for authentication endpoints.
- `routes/gateway.js` for Gateway status and control endpoints.
- `routes/channels.js` for channel status and real probe endpoints.
- `routes/metrics.js` for dashboard metrics.
- `routes/updates.js` for update and preflight endpoints.
- `routes/diagnostics.js` for diagnostics, model, compatibility, and config health endpoints.
- `routes/logs.js` for audit, timeline, errors, and log mute rules.
- `routes/product.js` for setup and health summary endpoints.
- `routes/reports.js` for export endpoints.
- `routes/version.js` for local/upstream version and version source endpoints.

## Releases

The package version starts at `v1.0.0`. Pushing a `v*` tag runs the release workflow, executes lint/tests, and publishes a source archive on GitHub Releases:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## License

MIT
