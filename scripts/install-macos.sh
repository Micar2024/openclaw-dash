#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.openclaw.dashboard"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
HOST_VALUE="${DASHBOARD_HOST:-127.0.0.1}"
PORT_VALUE="${DASHBOARD_PORT:-3000}"

cd "${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Please install Node.js 18 or newer first." >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${ROOT_DIR}/logs"
npm install
npm run build:assets

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ROOT_DIR}/scripts/start-dashboard.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DASHBOARD_HOST</key>
    <string>${HOST_VALUE}</string>
    <key>DASHBOARD_PORT</key>
    <string>${PORT_VALUE}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/logs/dashboard.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/logs/dashboard.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "OpenClaw Dash installed and started."
echo "URL: http://${HOST_VALUE}:${PORT_VALUE}"
echo "Token path for remote login: ${HOME}/.openclaw/dash-token"

if [[ "${HOST_VALUE}" != "127.0.0.1" && "${HOST_VALUE}" != "localhost" && "${HOST_VALUE}" != "::1" ]]; then
  echo "Security note: DASHBOARD_HOST=${HOST_VALUE} exposes the dashboard beyond this Mac. Use only on trusted LANs." >&2
fi
