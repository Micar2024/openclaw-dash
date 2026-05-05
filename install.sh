#!/usr/bin/env bash
# OpenClaw Dash — 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/Micar2024/openclaw-dash/main/install.sh | bash
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

echo "==> OpenClaw Dash 安装向导"
echo "    目标目录: ${DASH_DIR}"
echo ""

# 检查依赖
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js。请先安装 Node.js 18+ (推荐 https://nodejs.org)" >&2
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js 版本过低: $(node -v)，需要 18+" >&2
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 检查 OpenClaw CLI
OPENCLAW_BIN="${HOME}/.npm-global/bin/openclaw"
if [ ! -x "$OPENCLAW_BIN" ]; then
  OPENCLAW_BIN=$(command -v openclaw || true)
fi
if [ -z "$OPENCLAW_BIN" ]; then
  echo "! 未检测到 openclaw 命令，请确认 OpenClaw 已安装"
  echo "  Dashboard 部分功能（Gateway 控制、通道诊断）可能不可用"
else
  echo "✓ openclaw: $OPENCLAW_BIN"
fi

# 下载/更新源码
if command -v git >/dev/null 2>&1; then
  if [ -d "$DASH_DIR" ]; then
    if [ ! -d "${DASH_DIR}/.git" ]; then
      BACKUP_DIR="${DASH_DIR}.backup.$(date +%Y%m%d%H%M%S)"
      echo "==> 检测到已有非 git 目录，先备份到 ${BACKUP_DIR}"
      mv "$DASH_DIR" "$BACKUP_DIR"
      echo "==> git 克隆仓库..."
      git clone --depth 1 --branch "$BRANCH" "$REPO" "$DASH_DIR"
    else
      echo "==> 检测到已有安装，安全更新..."
      cd "$DASH_DIR"
      if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "✗ ${DASH_DIR} 存在未提交改动，安装脚本不会覆盖它们。" >&2
        echo "  请先提交/备份本地改动，或换一个目录后再安装。" >&2
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
    echo "==> git 克隆仓库..."
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$DASH_DIR"
  fi
else
  echo "==> git 不可用，使用 curl 下载压缩包..."
  if [ -d "$DASH_DIR" ]; then
    BACKUP_DIR="${DASH_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    echo "==> 检测到已有目录，先备份到 ${BACKUP_DIR}"
    mv "$DASH_DIR" "$BACKUP_DIR"
  fi
  TMP_DIR="$(mktemp -d)"
  TARBALL_URL="$REPO/archive/refs/heads/$BRANCH.tar.gz"
  curl -fsSL "$TARBALL_URL" | tar xz -C "$TMP_DIR"
  mv "$TMP_DIR/openclaw-dash-$BRANCH" "$DASH_DIR"
fi

cd "$DASH_DIR"

# 安装依赖与本地前端资产。这里保留 devDependencies，因为 Tailwind 构建需要它。
echo "==> 安装依赖并构建本地资源..."
npm install
npm run build:assets

# 设置 LaunchAgent（macOS 自启动）
if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> 设置 macOS 自启动..."
  chmod +x scripts/install-macos.sh
  OPENCLAW_DASH_SKIP_NPM_INSTALL=1 bash scripts/install-macos.sh
else
  echo "==> 非 macOS 系统，跳过自启动安装。"
  echo "    手动启动: cd ${DASH_DIR} && npm start"
fi

echo ""
echo "✅ 安装完成！"
echo "   地址: http://127.0.0.1:3000"
if [ -f "${HOME}/.openclaw/dash-token" ]; then
  echo "   远程登录 Token 路径: ${HOME}/.openclaw/dash-token"
fi
echo ""
echo "   出问题了？打开看板导出脱敏诊断报告，然后贴到社区求助。"
