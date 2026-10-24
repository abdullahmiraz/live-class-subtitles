#!/usr/bin/env bash
# Start the subtitle server automatically at login (systemd --user service).
# Usage: ./install-autostart.sh          install + start
#        ./install-autostart.sh remove   uninstall
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT="$HOME/.config/systemd/user/ru-en-subtitles.service"

if [ "${1:-}" = "remove" ]; then
  systemctl --user disable --now ru-en-subtitles 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "Autostart removed."
  exit 0
fi

mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=RU->EN live subtitle server (local speech recognition)

[Service]
ExecStart=$DIR/start.sh
Restart=on-failure
RestartSec=3
Nice=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now ru-en-subtitles
echo "Installed. Logs: journalctl --user -u ru-en-subtitles -f"
