#!/usr/bin/env bash
# Start the Live Class Subtitles companion automatically at login.
#   Linux: systemd --user service · macOS: launchd agent  (Windows: install.ps1 adds a Startup shortcut)
# Usage: ./install-autostart.sh          install + start
#        ./install-autostart.sh remove   uninstall
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL=dev.miraz.live-class-subtitles

if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  if [ "${1:-}" = "remove" ]; then
    rm -f "$PLIST"
    echo "Autostart removed."
    exit 0
  fi
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$DIR/start.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/live-class-subtitles.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/live-class-subtitles.log</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed. Logs: ~/Library/Logs/live-class-subtitles.log"
  exit 0
fi

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
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Live Class Subtitles companion (local speech recognition)

[Service]
ExecStart=$DIR/start.sh
Restart=on-failure
RestartSec=3
Nice=5

[Install]
WantedBy=default.target
UNITEOF
systemctl --user daemon-reload
systemctl --user enable --now live-class-subtitles
echo "Installed. Logs: journalctl --user -u live-class-subtitles -f"
