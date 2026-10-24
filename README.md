# RU → EN Live Subtitles (free, permanent)

[![CI](https://github.com/abdullahmiraz/ru-en-live-subtitles/actions/workflows/ci.yml/badge.svg)](https://github.com/abdullahmiraz/ru-en-live-subtitles/actions/workflows/ci.yml)

Live English subtitles for any Chrome tab playing Russian speech (online classes, YouTube, Meet, Zoom web…). No accounts, no API keys, no paid services.

- **Speech recognition**: runs on your PC (GigaAM-v3 by Sber, the most accurate open Russian model). Light: it processes speech about 25× faster than real time on 4 CPU threads, and uses no CPU when nobody is speaking.
- **Translation**: online only, through the free Google / Yandex web endpoints (no account, no key, no CPU). They're ranked by measured accuracy: **Google → Yandex (LLM) → Yandex (classic)**. If one fails, the next takes over automatically.
- **English sentences**: if the speaker switches to English, that sentence is written down as said (Whisper-tiny) instead of being mistranslated. You can hide those sentences with a popup switch. Russian sentences with a few English words are always kept.
- **Save transcripts (EN + RU)**: only if you choose it. Pick **Off** (default), **Manual** (Start/Stop saving button), or **Auto** (every session), in Markdown, SRT subtitles, plain text or JSON. Files go to `Downloads/ru-en-subtitles/`.
- **Learning mode**: each Russian word and its English translation get the **same color**, and hovering a word highlights its pair. It uses Yandex's word alignment, so you learn as you read instead of only translating.
- **Comfortable subtitle box**: newest sentence at the bottom (like Meet/Teams captions), with the latest one highlighted and older ones fading. A separate **LIVE** line shows the sentence being spoken. You can scroll back through history, and a "↓ new" button appears if you scrolled up. The box is resizable (min 320 px), has compact/expanded modes, A−/A+ text size and adjustable background opacity, and ✕ shrinks it to a "CC" pill. Motion is gentle and respects "reduce motion".

## Use it

Requirements: Linux (tested on Ubuntu with PipeWire), Google Chrome 138+, Python 3.10+, `curl`. [`uv`](https://github.com/astral-sh/uv) is used if installed.

1. Get the code and start the server (first run downloads ~350 MB of models; keep the terminal open):
   ```bash
   git clone https://github.com/abdullahmiraz/ru-en-live-subtitles.git
   cd ru-en-live-subtitles
   ./start.sh
   ```
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick the `extension/` folder (once; after code updates click the reload ↻ icon).
3. On the class tab: click the extension icon → **Start on this tab** (or press **Alt+Shift+Y**). Drag the subtitle box anywhere; it follows fullscreen video.
4. Popup settings: translator (Best available = Google → Yandex), font size, background opacity, show/hide Russian, hide sentences spoken in English, **learning mode**, and **save transcript** (Off / Manual / Auto + format).
5. In the box: drag the header to move it, drag the corner to resize, use A−/A+ for text size and ▾ for compact mode. Size and position are remembered per website.

Stop: click **Stop**, press Alt+Shift+Y again, or close the tab. Stop the server with Ctrl+C.

### Optional: start the server automatically at login
```bash
./install-autostart.sh          # ./install-autostart.sh remove   to undo
```
It uses 0% CPU when idle (about 390 MB RAM) and only works while a tab is being captured.

## Layout
```
ru-en-live-subtitles/
├── start.sh                    start the server (sets itself up on first run)
├── install-autostart.sh        optional autostart (systemd user service)
├── AGENTS.md                   guide for AI coding agents: constraints, protocol, gotchas (CLAUDE.md points here)
├── extension/                  Chrome MV3 extension: tabCapture → offscreen doc (keeps tab audible,
│                               16 kHz PCM) → WebSocket → subtitle overlay (content.js); transcript.js = file formats
├── server/
│   ├── server.py               voice detection + recognition + translation, WebSocket on 127.0.0.1:8765
│   ├── engine.py               local speech recognition (Silero VAD, GigaAM-v3, streaming Zipformer, Whisper-tiny for English)
│   ├── translate.py            online translators, ranked by accuracy
│   ├── download_models.sh      fetches the 4 models (~350 MB)
│   ├── models/                 GigaAM-v3 (222 MB), Whisper-tiny for English (99 MB), live-text model (29 MB), voice detector (0.6 MB)
│   ├── transcripts/            debug logs, only with ./start.sh --save-transcripts
│   ├── tests/                  pytest (no models / network needed), run in CI
│   └── dev/                    bench.py (benchmarks), test_client.py — not needed for normal use
└── docs/research.md            the initial research on competitors and free options
```

## Benchmark results (2026-10-24, this PC: Xeon E5-2670 v3, no GPU used)

Data: Google FLEURS Russian test set, 775 recordings, 413 female + 362 male speakers, with human English reference translations.

### Speech recognition (GigaAM-v3, all 775 recordings)
| Condition | WER (word errors) | CER | Male / Female WER | Speed (RTF) |
|---|---|---|---|---|
| Clean | **4.6%** | 1.5% | 4.8 / 4.4 | 0.040 (25× faster than real time) |
| Room echo + background noise (10 dB) | 12.2% | 5.4% | 13.1 / 11.5 | 0.038 |
| Phone-quality audio (300–3400 Hz) | 5.3% | 1.7% | 5.7 / 4.8 | 0.042 |
| Very quiet (5% volume) | 5.0% | 1.6% | 5.5 / 4.5 | 0.043 |

### Translation (150 sentences, from correct Russian text; higher is better)
| Engine | chrF | BLEU | Speed | Runs on |
|---|---|---|---|---|
| **Google** (default) | **65.7** | **41.2** | 1.1 s | online, free |
| Yandex (LLM) | 63.4 | 34.9 | 1.3 s | online, free |
| Yandex (classic) | 62.6 | 37.8 | 1.3 s | online, free (5/150 failed) |
| OPUS-MT tc-big | 62.9 | 36.3 | 0.35 s | local, 235 MB (removed) |
| Argos | 62.7 | 36.7 | 0.18 s | local, 100 MB (removed) |
| NLLB 1.3B / MADLAD 3B | not finished (stopped to free CPU) | | | local, heavy (removed) |

### End-to-end
- 173 s clip with 12 different speakers, streamed into the server in real time: all 17 segments recognized and translated correctly (after fixing a threading bug).
- Through Chrome (real tab capture + overlay) the chain works; the last Chrome run was done while heavy benchmarks were using the CPU, so its scores are not representative.

## How we got here (development log, 2026-10-24)

1. **Research.** Four parallel agents looked at competitor extensions, free desktop overlay apps for Linux, free speech-to-text/translation APIs, and Chrome extension architecture (full report: [docs/research.md](docs/research.md)). Findings:
   - Chrome's Live Translate can't translate *from* Russian, and Edge's video translation was retired.
   - The good extensions (SubSync, Talo…) are paid cloud speech-to-text wrapped around a simple extension.
   - The best desktop apps need an NVIDIA GPU (this PC has an AMD RX 580).
2. **Decision: no paid trials, something permanent.** Speech recognition runs locally on the CPU. The choice was GigaAM-v3 via sherpa-onnx, which needs no PyTorch and gets ~25× real-time speed on CPU.
3. **First prototype.** The server stack was Silero VAD + GigaAM-v3 + a streaming Zipformer for instant partial text + Argos offline translation. The first test missed a quiet clip and dropped the first word of live text. Fixes: a lower VAD threshold (0.3), automatic gain, and a 0.6 s pre-roll.
4. **Translation engines explored.** Tried Google's free `gtx` endpoint and found three working Yandex endpoints. The Yandex Browser one gives LLM-quality output but only accepts `format=html` (`format=text` returns 413). Also compared four local models: Argos, OPUS-MT tc-big, NLLB 1.3B, and MADLAD 3B.
5. **Benchmarks on many voices.** Ran Google FLEURS (775 recordings: 413 female, 362 male) under clean, noisy+echo, phone-quality and very quiet conditions, and scored translations against human English references. Google came out on top, so the default became Google → Yandex → offline.
6. **"Light on the PC".** Online translation for finished sentences. Partial text uses the tiny local model, so we don't spam the online endpoints. Heavy local models are not used by default.
7. **Chrome extension.** MV3 extension built from tabCapture, an offscreen document that keeps the tab audible, a 16 kHz AudioWorklet, a WebSocket, and a draggable shadow-DOM overlay that survives fullscreen.
8. **Automated end-to-end test.** A separate Chrome profile, the extension loaded via the DevTools Protocol (Chrome 137+ ignores `--load-extension`), the real keyboard shortcut sent with xdotool, and the overlay read back. This caught two real bugs:
   - Chrome reserves **Alt+Shift+T** (focus toolbar), so the shortcut silently never registered. Changed to **Alt+Shift+Y**.
   - Running sherpa-onnx recognizers on different threads at once produced `<unk><unk>…` garbage. All speech recognition now runs on one dedicated thread. After the fix, 17/17 segments were correct.
9. **Packaging.** Added `start.sh` (sets itself up on first run), `download_models.sh`, an optional systemd user service, and this README.
10. **Cleanup: accuracy-ranked and light.** Translation is now online only, ranked by benchmark accuracy (Google → Yandex LLM → Yandex classic). Every local translation model was removed, and the live text is translated online at most every 1.5 s, in the background. Unused speech models, benchmark data and test transcripts went to the Trash (recoverable). The server folder dropped from 5.5 GB to about 350 MB (models 251 MB, Python environment 100 MB, down from 309 MB). Smoke test passed: 0% CPU when idle.

11. **English sentences.** English speech was being mistranslated (GigaAM writes it in garbled Latin letters, e.g. "This Reserches the potencial the overtiran conventional Hyprofeces"). We tried a Whisper language detector, then switched to a zero-cost text check: mostly Latin letters means an English sentence. Only those sentences go to Whisper-tiny (~0.6 s each), which writes down what was said. A popup switch can hide them, and mixed Russian sentences are always kept. The text check passed 9/9 on real and mixed examples.

## Roadmap
Next stage (tracked as [GitHub issues](https://github.com/abdullahmiraz/ru-en-live-subtitles/issues?q=label%3Anext-stage)):
- ~~Save translations (both languages) to a file~~ ✅ done (v1.1)
- Learning-mode ideas: vocabulary list, Anki export, stress marks, Russian-first recall mode…
- Auto-start on websites you list, and remember sites you've used it on.
- Optionally record the class audio alongside the transcript.

## Credits & licenses
Code: MIT (see [LICENSE](LICENSE)). Models are downloaded at setup, not stored in this repo:
[GigaAM-v3](https://github.com/salute-developers/GigaAM) (Sber, MIT),
[Whisper](https://github.com/openai/whisper) tiny (OpenAI, MIT),
[Silero VAD](https://github.com/snakers4/silero-vad) (MIT),
streaming Zipformer RU (Alpha Cephei / Vosk, Apache-2.0), all run via
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
Benchmarks use [Google FLEURS](https://huggingface.co/datasets/google/fleurs) (CC-BY-4.0).

## Notes / limits
- The Google/Yandex endpoints are the free, unauthenticated ones their own browser features use. This project is not affiliated with Google or Yandex; use them for personal, moderate use. There is no account quota or token limit, but they are unofficial: heavy use from one IP can get temporarily rate-limited, and they could change. A failing engine is skipped for 60 s and the next one is used. **Translation needs internet.**
- Speech recognition is the one local part. It has to be: no free, permanent online service converts Russian speech to text. It is light, though (see benchmarks).
- Re-run benchmarks: `cd server && uv pip install --python .venv/bin/python -r dev/requirements-dev.txt && .venv/bin/python dev/bench.py asr --cond clean noisy` (needs the FLEURS data, see dev/bench.py).
