#!/usr/bin/env bash
# Downloads only the models the server needs (skips ones already present).
set -euo pipefail
mkdir -p "$(dirname "$0")/models" && cd "$(dirname "$0")/models"
B=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models

# Every model is unpacked into a temp folder and renamed only when complete, so an interrupted
# download never leaves a half-extracted model that later runs would skip.
fetch() { # fetch <name> [tar wildcards…]
  local m="$1"; shift
  [ -d "$m" ] && return 0
  echo "Downloading $m ..."
  rm -rf "$m.part" && mkdir "$m.part"
  if curl -fL --progress-bar "$B/$m.tar.bz2" | tar xj -C "$m.part" --strip-components=1 --wildcards "$@"; then
    mv "$m.part" "$m"
  else
    rm -rf "$m.part"
    echo "Download of $m failed — check your internet connection and run ./start.sh again." >&2
    return 1
  fi
}
fetch sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16 '*'
fetch sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16 '*'
if [ ! -f silero_vad.onnx ]; then
  curl -fsSL -o silero_vad.onnx.part "$B/silero_vad.onnx" && mv silero_vad.onnx.part silero_vad.onnx
fi
# Whisper-tiny (int8 files only): writes down sentences spoken in English
fetch sherpa-onnx-whisper-tiny '*/tiny-encoder.int8.onnx' '*/tiny-decoder.int8.onnx' '*/tiny-tokens.txt'
