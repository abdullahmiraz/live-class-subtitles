#!/usr/bin/env bash
# Downloads only the models the server needs (skips ones already present).
set -euo pipefail
mkdir -p "$(dirname "$0")/models" && cd "$(dirname "$0")/models"
B=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models

for m in sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16 \
         sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16; do
  if [ ! -d "$m" ]; then
    echo "Downloading $m ..."
    curl -fL --progress-bar "$B/$m.tar.bz2" | tar xj
  fi
done
[ -f silero_vad.onnx ] || curl -fsSLO "$B/silero_vad.onnx"
# Whisper-tiny (int8 only): writes down sentences spoken in English
if [ ! -f sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx ]; then
  echo "Downloading sherpa-onnx-whisper-tiny ..."
  curl -fL --progress-bar "$B/sherpa-onnx-whisper-tiny.tar.bz2" | tar xj --wildcards \
    '*/tiny-encoder.int8.onnx' '*/tiny-decoder.int8.onnx' '*/tiny-tokens.txt'
fi
