#!/usr/bin/env bash
# Start the local RU->EN subtitle server (speech recognition runs on this PC).
# First run creates the Python environment and downloads the models (~350 MB).
set -euo pipefail
cd "$(dirname "$0")/server"

port_busy() { ss -ltn 2>/dev/null | grep -q '127.0.0.1:8765 '; }

# ./start.sh restart  -> stop the running server (e.g. after an update) and start the new code
if [ "${1:-}" = "restart" ] || [ "${1:-}" = "stop" ]; then
  pkill -f '^\.venv/bin/python server\.py' || true
  for _ in $(seq 1 50); do port_busy || break; sleep 0.1; done
  [ "$1" = "stop" ] && { echo "Stopped."; exit 0; }
  shift
fi

if port_busy; then
  echo "The subtitle server is already running (port 8765) — nothing to do."
  echo "After an update use: ./start.sh restart"
  exit 0
fi

if [ ! -x .venv/bin/python ]; then
  echo "Creating Python environment..."
  if command -v uv >/dev/null; then
    uv venv -q .venv --python 3.12
    uv pip install -q --python .venv/bin/python -r requirements.txt
  else
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
  fi
fi

./download_models.sh
exec .venv/bin/python server.py "$@"
