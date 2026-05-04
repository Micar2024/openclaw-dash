#!/bin/zsh
set -e

export PATH="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$HOME/openclaw-dash"
exec node server.js
