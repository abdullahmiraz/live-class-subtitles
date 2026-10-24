#!/usr/bin/env bash
# Start the local Live Class Subtitles server (speech recognition runs on this PC).
# First run creates the Python environment and downloads the models (~350 MB).
set -euo pipefail
cd "$(dirname "$0")/server"

# portable (Linux + macOS): can we open a TCP connection to the port?
port_busy() { (exec 3<>/dev/tcp/127.0.0.1/8765) 2>/dev/null; }

# ./start.sh restart  -> stop the running server (e.g. after an update) and start the new code
if [ "${1:-}" = "restart" ] || [ "${1:-}" = "stop" ]; then
  # autostart installed? let launchd/systemd do it, so it doesn't fight a second copy
  AGENT="gui/$(id -u)/dev.miraz.live-class-subtitles"
  if [ "$(uname)" = "Darwin" ] && launchctl print "$AGENT" >/dev/null 2>&1; then
    if [ "$1" = "restart" ]; then launchctl kickstart -k "$AGENT"; else launchctl bootout "$AGENT"; fi
    echo "Autostart agent: $1 done (logs: ~/Library/Logs/live-class-subtitles.log)"
    exit 0
  fi
  if systemctl --user is-active --quiet live-class-subtitles 2>/dev/null; then
    systemctl --user "$1" live-class-subtitles && echo "Autostart service: $1 done (logs: journalctl --user -u live-class-subtitles -f)"
    exit 0
  fi
  pkill -f '^\.venv/bin/python server\.py' || true
  for _ in $(seq 1 50); do port_busy || break; sleep 0.1; done
  [ "$1" = "stop" ] && { echo "Stopped."; exit 0; }
  shift
fi

if port_busy && [ "${1:-}" != "setup" ]; then
  echo "The subtitle server is already running (port 8765) — nothing to do."
  echo "After an update use: ./start.sh restart"
  exit 0
fi

if [ ! -x .venv/bin/python ]; then
  echo "Creating Python environment..."
  if command -v uv >/dev/null; then uv venv -q .venv --python 3.12; else python3 -m venv .venv; fi
fi
# (re)install dependencies when requirements.txt changed (e.g. after an update added a package)
REQ_HASH="$( (sha256sum requirements.txt 2>/dev/null || shasum -a 256 requirements.txt) | cut -d' ' -f1)"
if [ "$(cat .venv/.requirements.sha256 2>/dev/null)" != "$REQ_HASH" ]; then
  echo "Installing Python packages..."
  if command -v uv >/dev/null; then uv pip install -q --python .venv/bin/python -r requirements.txt
  else .venv/bin/pip install -q -r requirements.txt; fi
  echo "$REQ_HASH" > .venv/.requirements.sha256
fi

.venv/bin/python download_models.py
# ./start.sh setup -> only prepare (environment + models), don't start; used by install.sh
[ "${1:-}" = "setup" ] && { echo "Setup done."; exit 0; }
exec .venv/bin/python server.py "$@"
