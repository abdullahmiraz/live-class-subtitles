#!/usr/bin/env bash
# Start the local RU->EN subtitle server (speech recognition runs on this PC).
# First run creates the Python environment and downloads the models (~350 MB).
set -euo pipefail
cd "$(dirname "$0")/server"

if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8765 '; then
  echo "The subtitle server is already running (port 8765) — nothing to do."
  echo "To stop it: pkill -f 'python server.py'"
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
