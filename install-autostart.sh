#!/usr/bin/env bash
# Start the subtitle server automatically at login (systemd --user service).
# Usage: ./install-autostart.sh          install + start
#        ./install-autostart.sh remove   uninstall
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT="$HOME/.config/systemd/user/live-class-subtitles.service"

if [ "${1:-}" = "remove" ]; then
  systemctl --user disable --now live-class-subtitles 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "Autostart removed."
  exit 0
fi

# installed before the rename? remove the old unit so two servers don't fight over the port
if [ -f "$HOME/.config/systemd/user/ru-en-subtitles.service" ]; then
  systemctl --user disable --now ru-en-subtitles 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/ru-en-subtitles.service"
fi

mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=Live Class Subtitles server (local speech recognition)

[Service]
ExecStart=$DIR/start.sh
Restart=on-failure
RestartSec=3
Nice=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now live-class-subtitles
echo "Installed. Logs: journalctl --user -u live-class-subtitles -f"
