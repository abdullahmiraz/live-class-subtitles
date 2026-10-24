# AGENTS.md: guide for AI coding agents (and humans)

Live Russian → English subtitles for any Chrome tab. A Chrome MV3 extension captures tab audio and streams it to a **local Python server**. The server transcribes the Russian on the CPU and translates it through free online endpoints.

## Hard constraints (the owner's requirements, do not violate)
- **License is PolyForm Strict 1.0.0** (personal, non-commercial use; no redistribution or derivatives without permission). Don't change it, and don't add dependencies whose licenses conflict (GPL code can't be merged in; LGPL can only be bundled unmodified as a separate file, like vendor/lame.min.js).
- **Free forever.** No paid APIs, trials, API keys or accounts.
- **Light on the PC.** No heavy local models. Speech recognition is the *only* local ML, because no free online Russian speech-to-text exists. Never add local translation models (they were benchmarked and removed).
- **Translation is online only.** Default order is the owner's choice: `yandex-nmt` (Yandex classic) → `google` → `yandex` (LLM). Google scores highest on FLEURS, but the owner prefers Yandex classic in real classes. Keep their order. Learning mode uses Yandex classic's word alignment.
- **Never commit** models, `.venv`, transcripts, recordings, or anything with secrets. All are in `.gitignore`.
- Target platform: Linux desktop (PipeWire), Google Chrome 138+. The owner's PC is an Intel Xeon with an AMD GPU, no CUDA.

## Layout
```
start.sh                     one-command start (creates venv + downloads models on first run)
install-autostart.sh         optional systemd --user service
extension/                   Chrome MV3 extension (no build step, plain JS)
  manifest.json              permissions: tabCapture, offscreen, storage, activeTab, downloads, scripting; shortcut Alt+Shift+Y
  background.js              service worker: capture state, offscreen doc lifecycle, relays subtitles to the tab
  offscreen.js / .html       getUserMedia(tab) → plays audio back (tab is muted by capture) → 16 kHz AudioWorklet → WebSocket
  pcm-worklet.js             mono Int16 100 ms chunks
  content.js                 two display modes: "subtitles" = English-only YouTube-style caption over the largest
                             <video> (owner wants translation only there); "panel" = shadow-DOM box: history (newest at bottom, scrollback, "↓ new"), LIVE line,
                             resize grip, compact mode, A−/A+, bg opacity, "CC" pill, learning-mode word colors
  sites.js                   pure site memory + auto-start rules (exact host or *.wildcard); tested by extension/tests
  transcript.js              pure transcript formatters (md/srt/txt/json) + data: URL; tested by extension/tests
  webm-duration.js           inserts the Duration Chrome's MediaRecorder leaves out of WebM; tested by extension/tests
  popup.html / popup.js      start/stop + settings in two tabs. Basic = everyday look (display, fontSize, bgOpacity, showRu).
                             Advanced = fieldsets Translation / Learning / Record this class / Sites. New features go into the
                             matching fieldset, not Basic (see issue comments in #4 and #5 for placement). Settings (chrome.storage.sync): engine, fontSize, bgOpacity, showRu, hideEn,
                             learn, display (panel|subtitles), saveMode (off|manual|auto), saveFormat (md|srt|txt|json),
                             saveTranscript, saveAudio, audioFormat (mp3|webm)
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
- `{"type":"partial","ru":"…","en":"…","align":[…]}`: live text while the speaker talks (rough; align only in learning mode)
- `{"type":"done"}`: reply to the client's text frame `"flush"` once the sentence in progress and all queued finals were sent. The extension flushes before saving, so the last sentence isn't lost.
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
- **Copy `vad.front.samples` BEFORE `vad.pop()`.** pop() frees the segment in C++. Reading it afterwards returns random memory, so GigaAM outputs `<unk><unk>…`, Whisper outputs "!!!!!!", and sentences go missing, intermittently (about 1 in 3 sessions). This was the real cause of those glitches for a long time. Check: replaying the same audio must give byte-identical segment hashes every run.
- All sherpa-onnx objects (VAD, live model, GigaAM, Whisper) are created and used only on the single-thread `asr_pool`. `Session._process()` does gain + VAD + live recognition for one chunk in one hop and returns events.
- **Alt+Shift+T is reserved by Chrome** (focus toolbar), so an extension command with it silently never registers. We use Alt+Shift+Y.
- **Yandex browser endpoint** (`browser.translate.yandex.net`, LLM quality) only works with GET and `format=html`. `format=text` returns 413. Escape/unescape HTML.
- **Google `gtx` endpoint** is free with no key. Keep request volume browser-like: final sentences only, plus live text at most every 1.5 s (`PARTIAL_TRANSLATE_EVERY`).
- Chrome 137+ ignores `--load-extension`. For automated e2e tests, launch Chrome with `--enable-unsafe-extension-debugging --remote-debugging-port=…` and call CDP `Extensions.loadUnpacked`. Use xdotool (Chrome with `--ozone-platform=x11`) to press the real shortcut, since tabCapture needs a user gesture.
- tabCapture mutes the tab. offscreen.js plays it back through a second AudioContext; recognition uses a separate 16 kHz AudioContext.
- GigaAM writes English speech in Latin letters. `looks_english()` (>50% Latin letters) routes those sentences to Whisper-tiny, while mixed RU sentences with English terms stay Russian.
- **Saving lives in the extension**, not the server. background.js buffers finals in `chrome.storage.session` (`rec`), serialized through a promise chain, and downloads via `chrome.downloads` with a `data:` URL (MV3 service workers have no `URL.createObjectURL`). Stop (button, shortcut, tab close) always flushes the file.
- **Yandex word alignment**: `options=4` returns `align: ["s:l-s:l,…"]` (char offsets, first entry = whole sentence). We use the classic tr-mobile POST endpoint (plain text, so offsets map 1:1). The browser/LLM endpoint's offsets refer to html-escaped text.
- **Audio recording** runs in the offscreen document. MP3 (default): a 24 kHz AudioContext → pcm-worklet → lamejs; Chrome on Linux can't encode AAC/MP3 itself, and `recStarting` guards the async setup against a double start, which doubled the audio. WebM: MediaRecorder on the full-quality tab stream, Opus 32 kb/s, 10 s chunks. The background asks for a blob: URL (`rec-stop`), downloads it and waits for completion before closing the offscreen doc, so `stop()` calls `finishSaving()` first. Chrome's WebM has no Duration, so `webm-duration.js` patches it in. The real (possibly "(1)"-renamed) filename comes from `chrome.downloads.search`.
- **Chrome never allows tab capture without a user gesture.** `getMediaStreamId` fails with "Extension has not been invoked for the current page" unless the icon/popup or the command shortcut was used on that tab (verified headless). Auto-start therefore shows a one-key prompt (`autostart-prompt`) when a listed site becomes audible (`tabs.onUpdated` → `audible`). Don't try to "fix" this into silent auto-capture; it's impossible by design.
- The extension has no "tabs" permission, so it can't read URLs in the service worker (the content script reports `location.hostname` in its ping reply). The popup can read `tab.url` because opening it grants activeTab.
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
