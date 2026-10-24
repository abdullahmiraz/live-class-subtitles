#!/usr/bin/env bash
# Live Class Subtitles companion app: one-line installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.sh | bash
# Needs only curl (built into macOS and most Linux). Installs uv (which brings its own Python), downloads the
# app and the speech models (~350 MB, once) into ~/.local/share/live-class-subtitles (override: LCS_HOME=…)
# and starts it at every login. Run it again to update.
# Uninstall: curl -fsSL …/install.sh | bash -s uninstall
set -euo pipefail
REPO=abdullahmiraz/live-class-subtitles
DIR="${LCS_HOME:-$HOME/.local/share/live-class-subtitles}"

if [ "${1:-}" = "uninstall" ]; then
  [ -x "$DIR/install-autostart.sh" ] && "$DIR/install-autostart.sh" remove || true
  pkill -f "$DIR/server/.venv/bin/python" 2>/dev/null || true
  if command -v gio >/dev/null; then gio trash "$DIR"; else mv "$DIR" "${TMPDIR:-/tmp}/live-class-subtitles.removed.$$"; fi
  echo "Uninstalled (the app folder was moved to the Trash)."
  exit 0
fi

command -v curl >/dev/null || { echo "Please install curl first (e.g. sudo apt install curl)." >&2; exit 1; }
command -v tar >/dev/null || { echo "Please install tar first." >&2; exit 1; }

# uv: a single-file Python manager (https://docs.astral.sh/uv); it fetches Python 3.12 by itself
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null; then
  echo "Installing uv (Python manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
fi

echo "Downloading Live Class Subtitles into $DIR ..."
mkdir -p "$DIR"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar xz -C "$DIR" --strip-components=1

cd "$DIR/server"
[ -x .venv/bin/python ] || uv venv -q --python 3.12 .venv
echo "Installing Python packages..."
uv pip install -q --python .venv/bin/python -r requirements.txt
( sha256sum requirements.txt 2>/dev/null || shasum -a 256 requirements.txt ) | cut -d' ' -f1 > .venv/.requirements.sha256
.venv/bin/python download_models.py

if [ -n "${LCS_NO_AUTOSTART:-}" ]; then
  echo "✓ Installed (no autostart). Start it with: $DIR/start.sh"
elif [ "$(uname)" = "Darwin" ] || { command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; }; then
  "$DIR/start.sh" stop >/dev/null 2>&1 || true
  "$DIR/install-autostart.sh"
  echo
  echo "✓ Live Class Subtitles companion is running and starts by itself at login."
else
  echo
  echo "✓ Installed. Start it with: $DIR/start.sh"
fi
echo "  In the extension: popup → Advanced → Speech recognition → Companion app (best)."
