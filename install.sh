#!/usr/bin/env bash
# One-line installer for the Live Class Subtitles companion server (Linux):
#   curl -fsSL https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.sh | bash
# Installs into ~/.local/share/live-class-subtitles (override with RU_EN_HOME=…), downloads the speech
# models (~350 MB, once) and starts the server automatically at login (systemd --user).
# Run it again to update. Uninstall: ~/.local/share/live-class-subtitles/install-autostart.sh remove
set -euo pipefail
REPO=https://github.com/abdullahmiraz/live-class-subtitles.git
DIR="${RU_EN_HOME:-$HOME/.local/share/live-class-subtitles}"

need() { command -v "$1" >/dev/null || { echo "Please install $1 first (e.g. sudo apt install $2)." >&2; exit 1; }; }
need git git
need curl curl
command -v uv >/dev/null || need python3 "python3 python3-venv"

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR ..."
  git -C "$DIR" pull --ff-only -q
else
  echo "Installing into $DIR ..."
  mkdir -p "$(dirname "$DIR")"
  git clone -q --depth 1 "$REPO" "$DIR"
fi

"$DIR/start.sh" setup

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  if systemctl --user is-active --quiet live-class-subtitles; then
    systemctl --user restart live-class-subtitles
  else
    "$DIR/install-autostart.sh"
  fi
  echo
  echo "✓ The subtitle server is running and starts by itself at login."
else
  echo
  echo "✓ Installed. Start the server with: $DIR/start.sh"
fi
echo "  Open a tab with Russian audio, click the extension icon → Start (or press Alt+Shift+Y)."
