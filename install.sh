#!/usr/bin/env bash
# OpenClaw Dash — one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Micar2024/openclaw-dash/main/install.sh | bash
set -euo pipefail

DASH_DIR="${HOME}/openclaw-dash"
REPO="https://github.com/Micar2024/openclaw-dash"
BRANCH="${DASH_BRANCH:-main}"
TMP_DIR=""

cleanup() {
  if [ -n "${TMP_DIR}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

echo "==> OpenClaw Dash installer"
echo "    Target directory: ${DASH_DIR}"
echo ""

# Check dependencies
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js was not found. Please install Node.js 18+ first (https://nodejs.org recommended)" >&2
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js version is too old: $(node -v), requires 18+" >&2
  exit 1
fi
echo "✓ Node.js $(node -v)"

# Check OpenClaw CLI
OPENCLAW_BIN="${HOME}/.npm-global/bin/openclaw"
if [ ! -x "$OPENCLAW_BIN" ]; then
  OPENCLAW_BIN=$(command -v openclaw || true)
fi
if [ -z "$OPENCLAW_BIN" ]; then
  echo "! openclaw command was not found; please confirm OpenClaw is installed"
  echo "  Some dashboard features (Gateway control and channel diagnostics) may be unavailable"
else
  echo "✓ openclaw: $OPENCLAW_BIN"
fi

# Download/update source
if command -v git >/dev/null 2>&1; then
  if [ -d "$DASH_DIR" ]; then
    if [ ! -d "${DASH_DIR}/.git" ]; then
      BACKUP_DIR="${DASH_DIR}.backup.$(date +%Y%m%d%H%M%S)"
      echo "==> Existing non-git directory detected; backing it up to ${BACKUP_DIR}"
      mv "$DASH_DIR" "$BACKUP_DIR"
      echo "==> Cloning repository with git..."
      git clone --depth 1 --branch "$BRANCH" "$REPO" "$DASH_DIR"
    else
      echo "==> Existing install detected; updating safely..."
      cd "$DASH_DIR"
      if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "✗ ${DASH_DIR} has uncommitted changes; the installer will not overwrite them." >&2
        echo "  Please commit/back up local changes, or install into a different directory." >&2
        exit 1
      fi
      git fetch --depth 1 origin "$BRANCH"
      if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git checkout "$BRANCH"
      else
        git checkout -b "$BRANCH" "origin/$BRANCH"
      fi
      git merge --ff-only "origin/$BRANCH"
    fi
  else
    echo "==> Cloning repository with git..."
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$DASH_DIR"
  fi
else
  echo "==> git is unavailable; downloading tarball with curl..."
  if [ -d "$DASH_DIR" ]; then
    BACKUP_DIR="${DASH_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    echo "==> Existing directory detected; backing it up to ${BACKUP_DIR}"
    mv "$DASH_DIR" "$BACKUP_DIR"
  fi
  TMP_DIR="$(mktemp -d)"
  TARBALL_URL="$REPO/archive/refs/heads/$BRANCH.tar.gz"
  curl -fsSL "$TARBALL_URL" | tar xz -C "$TMP_DIR"
  mv "$TMP_DIR/openclaw-dash-$BRANCH" "$DASH_DIR"
fi

cd "$DASH_DIR"

# Install dependencies and local frontend assets. devDependencies are kept because the Tailwind build needs them.
echo "==> Installing dependencies and building local assets..."
npm install
npm run build:assets

# Set up LaunchAgent (macOS auto-start)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> Setting up macOS auto-start..."
  chmod +x scripts/install-macos.sh
  OPENCLAW_DASH_SKIP_NPM_INSTALL=1 bash scripts/install-macos.sh
else
  echo "==> Non-macOS system detected; skipping auto-start setup."
  echo "    Manual start: cd ${DASH_DIR} && npm start"
fi

echo ""
echo "✅ Installation complete!"
echo "   URL: http://127.0.0.1:3000"
if [ -f "${HOME}/.openclaw/dash-token" ]; then
  echo "   Remote login token path: ${HOME}/.openclaw/dash-token"
fi
echo ""
echo "   Need help? Open the dashboard, export a redacted diagnostic report, and paste it into the community."
