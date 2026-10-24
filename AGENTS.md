# AGENTS.md: guide for AI coding agents (and humans)

Live Russian → English subtitles for any Chrome tab. A Chrome MV3 extension captures tab audio and streams it to a **local Python server**. The server transcribes the Russian on the CPU and translates it through free online endpoints.

## Hard constraints (the owner's requirements, do not violate)
- **Free forever.** No paid APIs, trials, API keys or accounts.
- **Light on the PC.** No heavy local models. Speech recognition is the *only* local ML, because no free online Russian speech-to-text exists. Never add local translation models (they were benchmarked and removed).
- **Translation is online only**, ranked by measured accuracy: `google` → `yandex` (LLM) → `yandex-nmt`.
- **Never commit** models, `.venv`, transcripts, recordings, or anything with secrets. All are in `.gitignore`.
- Target platform: Linux desktop (PipeWire), Google Chrome 138+. The owner's PC is an Intel Xeon with an AMD GPU, no CUDA.

## Layout
```
start.sh                     one-command start (creates venv + downloads models on first run)
install-autostart.sh         optional systemd --user service
extension/                   Chrome MV3 extension (no build step, plain JS)
  manifest.json              permissions: tabCapture, offscreen, storage, activeTab; shortcut Alt+Shift+Y
  background.js              service worker: capture state, offscreen doc lifecycle, relays subtitles to the tab
  offscreen.js / .html       getUserMedia(tab) → plays audio back (tab is muted by capture) → 16 kHz AudioWorklet → WebSocket
  pcm-worklet.js             mono Int16 100 ms chunks
  content.js                 shadow-DOM overlay: history (newest at bottom, scrollback, "↓ new"), LIVE line,
                             resize grip, compact mode, A−/A+, bg opacity, "CC" pill, learning-mode word colors
  transcript.js              pure transcript formatters (md/srt/txt/json) + data: URL; tested by extension/tests
  popup.html / popup.js      start/stop + settings (chrome.storage.sync): engine, fontSize, bgOpacity, showRu, hideEn,
                             learn, saveMode (off|manual|auto), saveFormat (md|srt|txt|json)
server/
  server.py                  WebSocket ws://127.0.0.1:8765/<label>?engine=<auto|google|yandex|yandex-nmt>&hide_en=<0|1>&learn=<0|1>
                             (writes nothing to disk unless started with --save-transcripts)
  engine.py                  Silero VAD, GigaAM-v3 (final RU text), streaming Zipformer (live partial text),
                             looks_english() text check, Whisper-tiny (only for sentences spoken in English)
  translate.py               online translators + translate_chain() fallback with 60 s cooldown
  download_models.sh         fetches the 4 models (~350 MB) into server/models/
  tests/                     pytest, no models or network needed
  dev/bench.py               FLEURS benchmarks (ASR WER, translation chrF/BLEU)
  dev/test_client.py         streams a 16 kHz wav to the server like the extension does
docs/research.md             initial market/tech research
```

## Protocol (server → client JSON)
- `{"type":"ready"}`
- `{"type":"partial","ru":"…","en":"…"}`: live text while the speaker talks (rough)
- `{"type":"final","ru":"…","en":"…","lang":"ru|en","start":s,"end":s,"engine":"google|yandex|yandex-nmt|whisper","align":[[ruStart,ruLen,enStart,enLen],…]}`
  (`start`/`end` = seconds of audio since the socket opened; offscreen.js converts them to epoch ms. `align` is only filled in learning mode.)
Client → server: binary frames of 16 kHz mono Int16 PCM.

## Commands
```bash
./start.sh                                   # run the server (port 8765)
cd server && .venv/bin/python -m pytest -q tests   # unit tests (install pytest first: uv pip install --python .venv/bin/python pytest)
uv run --no-project --with websockets --with soundfile --with numpy python server/dev/test_client.py some16k.wav
node --check extension/*.js                  # syntax check the extension
node --test extension/tests/*.test.mjs       # transcript formatter tests
```
Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.

## Gotchas learned the hard way
- **sherpa-onnx recognizers must not run concurrently on different threads.** It produces `<unk><unk>…` garbage. All ASR goes through the single-thread `asr_pool` in server.py.
- **Alt+Shift+T is reserved by Chrome** (focus toolbar), so an extension command with it silently never registers. We use Alt+Shift+Y.
- **Yandex browser endpoint** (`browser.translate.yandex.net`, LLM quality) only works with GET and `format=html`. `format=text` returns 413. Escape/unescape HTML.
- **Google `gtx` endpoint** is free with no key. Keep request volume browser-like: final sentences only, plus live text at most every 1.5 s (`PARTIAL_TRANSLATE_EVERY`).
- Chrome 137+ ignores `--load-extension`. For automated e2e tests, launch Chrome with `--enable-unsafe-extension-debugging --remote-debugging-port=…` and call CDP `Extensions.loadUnpacked`. Use xdotool (Chrome with `--ozone-platform=x11`) to press the real shortcut, since tabCapture needs a user gesture.
- tabCapture mutes the tab. offscreen.js plays it back through a second AudioContext; recognition uses a separate 16 kHz AudioContext.
- GigaAM writes English speech in Latin letters. `looks_english()` (>50% Latin letters) routes those sentences to Whisper-tiny, while mixed RU sentences with English terms stay Russian.
- **Saving lives in the extension**, not the server. background.js buffers finals in `chrome.storage.session` (`rec`), serialized through a promise chain, and downloads via `chrome.downloads` with a `data:` URL (MV3 service workers have no `URL.createObjectURL`). Stop (button, shortcut, tab close) always flushes the file.
- **Yandex word alignment**: the browser endpoint with `options=4` returns `align: ["s:l-s:l,…"]` (char offsets, first entry = whole sentence). Offsets refer to the html-escaped text, so they're only used when escaping changes nothing.
- **Reloading the extension orphans its content scripts**: their box stays on the page, frozen, and Chrome doesn't inject the new content.js into already-open tabs. background.js `ensureContent()` pings the tab and injects content.js via `chrome.scripting` when missing. content.js removes leftover boxes on load and runs a watchdog that removes its own box once `chrome.runtime.id` is gone.
- Overlay status comes from `chrome.storage.session.conn` (sent with overlay-show). Any arriving subtitle also marks it live.
- Flexbox: the scrollable history needs `min-height: 0`, or the box grows past its set height.
- MV3 service workers sleep after ~30 s idle. In CDP tests, drive storage and messages from an extension page (e.g. open popup.html as a tab), not the SW target.
- `pkill -f "<pattern>"` can match your own shell command line. Anchor patterns, e.g. `pkill -f '^\.venv/bin/python server\.py$'`.

## Benchmarks (keep README tables in sync if you re-run)
GigaAM-v3 on FLEURS-ru (775 recordings): WER 4.6% clean, 12.2% noisy+echo, 5.3% phone, 5.0% quiet; RTF 0.04.
Translation chrF: Google 65.7, Yandex LLM 63.4, Yandex classic 62.6.

## Working conventions
- Small focused commits, imperative messages. Update README/AGENTS.md when behavior changes.
- Before pushing: `node --check extension/*.js`, `node --test extension/tests/*.test.mjs`, `python -m pytest -q server/tests`, and a 20 s smoke run with `dev/test_client.py` if server code changed.
- Roadmap and open work live in GitHub issues (labels: `next-stage`, `bug`, `enhancement`).
