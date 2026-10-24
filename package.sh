#!/usr/bin/env bash
# Build the Chrome Web Store upload: dist/ru-en-live-subtitles-<version>.zip (extension only, no tests).
set -euo pipefail
cd "$(dirname "$0")"
VER=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
OUT="dist/ru-en-live-subtitles-$VER.zip"
node --check extension/*.js
node --test extension/tests/*.test.mjs >/dev/null
mkdir -p dist
[ -e "$OUT" ] && mv "$OUT" "$OUT.old"   # keep a previous build of the same version instead of deleting it
(cd extension && zip -q -r -X "../$OUT" . -x 'tests/*' '*.md' '.*')
echo "$OUT ($(du -h "$OUT" | cut -f1)):"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
