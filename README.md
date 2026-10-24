# Live Class Subtitles (free, permanent)

[![CI](https://github.com/abdullahmiraz/live-class-subtitles/actions/workflows/ci.yml/badge.svg)](https://github.com/abdullahmiraz/live-class-subtitles/actions/workflows/ci.yml)

Live subtitles for any Chrome tab playing Russian speech (online classes, YouTube, Meet, Zoom web…), in **English or 37 other languages** (Spanish, German, Arabic, Hindi, Bengali, Chinese, Turkish, Kazakh…). No accounts, no API keys, no paid services.

> **License: personal, non-commercial use only** ([PolyForm Strict 1.0.0](LICENSE)). Redistribution, modified versions, and use in other products or services need written permission. See [License](#license).

- **Nothing to install**: speech recognition is built into Chrome (any OS), so you install the extension and start. Optional: Chrome's private on-device mode, or the free **companion app** (Windows/Mac/Linux) with GigaAM-v3 by Sber, the most accurate open Russian model. GigaAM is light: about 25× faster than real time on 4 CPU threads, and it uses no CPU when nobody is speaking.
- **Translation**: online only, through the free Yandex / Google web endpoints (no account, no key, no CPU). Default order: **Yandex classic → Google → Yandex LLM** (Yandex classic reads best in real classes; benchmark scores below). If one fails, the next takes over automatically.
- **Subtitle language**: popup → Basic → *Translate to* (38 languages). **Auto** uses Yandex classic first for English and Google first for other languages: in a spot check, Google was clearly better outside English. Word colors (learning) work for 19 languages, the ones where Yandex returns word matches: most European and Central Asian languages, plus Hebrew. Word-card meanings and read-aloud use the subtitle language too.
- **English sentences**: if the speaker switches to English, that sentence is written down as said instead of being mistranslated (the companion uses Whisper-tiny for it). You can hide those sentences with a popup switch. Russian sentences with a few English words are always kept.
- **Record a class**: keep the **transcript (EN + RU)**, the **audio**, or both, only if you choose it. Modes are **Off** (default), **Manual** (Start recording / Stop & save) and **Auto** (every session). Transcripts come as Markdown, SRT subtitles, plain text or JSON. Audio is the tab's sound as **MP3** (default, plays on any device, ~22 MB/hour) or Opus `.webm` (smallest, ~15 MB/hour). An `.srt` and the audio file from the same session play together in VLC/mpv. Files go to `Downloads/live-class-subtitles/`.
- **Learning mode**: each Russian word and its English translation get the **same color**, and hovering a word highlights its pair. It uses Yandex's word alignment, so you learn as you read instead of only translating.
- **Learning tools (Extra tab)**:
  - **Word card**: hover any Russian word to see its dictionary form, grammar and meaning, e.g. *дубе → дуб, noun · masculine · prepositional · "oak"*, with **★ Save** and **✓ I know it**.
  - **Color only new words**: words you marked known are no longer colored.
  - **Russian first**: the English stays blurred until you hover, or for 6 s.
  - **Read translation aloud**: free browser voices, with the class audio lowered while it speaks.
  - **Vocabulary**: export saved words **for Anki**. Saved transcripts end with a **"Words saved this class"** summary.
- **Microphone source** for in-person classes or apps outside Chrome. **Final sentences only**, **outline captions** in 4 colors, and a **Test** button that checks the server and each translator.
- **Two display modes**: **Subtitles**, which shows only the English translation over the video like YouTube CC (it follows the video, even inside embedded players; never more than 2 lines, with long sentences shown in readable pieces; fades in silence; can be dragged and double-click resets it), or the **Panel**, which keeps the full history in both languages.
- **Auto-start on your sites**: sites where you use subtitles are remembered (popup → Sites). Tick ★ auto-start (or add patterns like `*.zoom.us`), and when such a site starts playing sound a small prompt offers **one-key start** (Alt+Shift+Y). Chrome never lets an extension capture a tab without one click or key press, so this is as automatic as Chrome allows.
- **Comfortable panel**: newest sentence at the bottom (like Meet/Teams captions), with the latest one highlighted and older ones fading. A separate **LIVE** line shows the sentence being spoken. You can scroll back through history, and a "↓ new" button appears if you scrolled up. The box is resizable (min 320 px), has compact/expanded modes, A−/A+ text size and adjustable background opacity, and ✕ shrinks it to a "CC" pill. Motion is gentle and respects "reduce motion".

## Use it

**Just install the extension. Nothing else needed**, on Windows, Mac, Linux and ChromeOS (Chrome 135+):
1. Install it from the Chrome Web Store, or for the development version: `chrome://extensions` → **Developer mode** → **Load unpacked** → the `extension/` folder.
2. On the class tab: click the icon → **Start on this tab**, or press **Alt+Shift+Y**.

### Speech recognition engines (popup → Advanced)
| Engine | Install | Privacy | Quality |
|---|---|---|---|
| **Built into Chrome** (default) | nothing | Chrome sends the audio to Google's speech service | good; no punctuation |
| **On this computer** | nothing (Chrome downloads a Russian pack once) | audio stays on the PC | depends on Chrome's pack |
| **Companion app** | free app, once (below) | audio stays on the PC | best: GigaAM-v3 (WER 4.6% on FLEURS), punctuation, grammar in word cards |

Translation and word matching run inside the extension for all three engines.

### Optional: the companion app (Windows, Mac, Linux)
| System | How |
|---|---|
| **Windows 10/11** | Download [Install-Companion-Windows.cmd](https://github.com/abdullahmiraz/live-class-subtitles/releases/latest/download/Install-Companion-Windows.cmd) and double-click it. If SmartScreen warns, choose *More info → Run anyway*. No admin rights needed. Or in PowerShell: `irm https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.ps1 \| iex` |
| **macOS / Linux** | In Terminal: `curl -fsSL https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.sh \| bash` |

The installer needs nothing beforehand. It installs [uv](https://docs.astral.sh/uv), which brings its own Python, downloads the app and the speech models (~350 MB, once), and starts the app at every sign-in:
- **Linux:** a systemd user service.
- **macOS:** a launchd agent.
- **Windows:** a Startup shortcut.

Run the installer again to update. To uninstall:
- **macOS / Linux:** `curl -fsSL …/install.sh | bash -s uninstall`
- **Windows:** set `$env:LCS_UNINSTALL=1`, then run the PowerShell line.

The extension's welcome page shows the right instructions for your system.

When idle the app uses ~40 MB of RAM and 0% CPU. The speech models load when you press Start (~1.5 s) and are freed 5 minutes after the last tab stops (`--unload-after <seconds>`). While subtitles run it uses ~400 MB.

**Developers** can run it from a clone instead:
```bash
git clone https://github.com/abdullahmiraz/live-class-subtitles.git
cd live-class-subtitles && ./start.sh          # ./start.sh restart | stop · ./install-autostart.sh [remove]
```

### Popup
- **Basic** (day to day):
  - subtitle language, display mode, font size, background, caption style + color
  - show Russian, final sentences only, hide English sentences, color-match words
  - auto-start on this site, **Record this class**
- **Advanced:** speech engine, audio source (tab / microphone + one-time setup), translator, **Test**, site list.
- **Extra** (learning):
  - word card on hover, color only new words, Russian first, read aloud
  - vocabulary: Anki export, clear, known-words reset
  - Coming soon

Hover an ⓘ for a one-line explanation of any option.

In the box: drag the header to move it, drag the corner to resize, use A−/A+ for text size and ▾ for compact mode. Size and position are remembered per website. To stop: click **Stop**, press Alt+Shift+Y again, or close the tab.

## Layout
```
live-class-subtitles/
├── start.sh                    run the companion from a clone (sets itself up on first run)
├── install-autostart.sh        companion autostart: systemd (Linux) / launchd (macOS)
├── install.sh                  companion installer for macOS + Linux (curl | bash, no git/python needed)
├── install.ps1                 companion installer for Windows (store/Install-Companion-Windows.cmd = double-click)
├── package.sh                  builds the Chrome Web Store zip into dist/
├── PRIVACY.md                  privacy policy (also the store's privacy policy URL)
├── store/                      store listing text, screenshots, and the scripts that make them
├── AGENTS.md                   guide for AI coding agents: constraints, protocol, gotchas (CLAUDE.md points here)
├── extension/                  Chrome MV3 extension: tabCapture → offscreen doc (keeps tab audible,
│                               16 kHz PCM) → WebSocket → subtitle overlay (content.js); transcript.js = file formats
├── server/
│   ├── server.py               voice detection + recognition + translation, WebSocket on 127.0.0.1:8765
│   ├── engine.py               local speech recognition (Silero VAD, GigaAM-v3, streaming Zipformer, Whisper-tiny for English)
│   ├── translate.py            online translators (default order Yandex classic → Google → Yandex LLM)
│   ├── download_models.py      fetches the 4 models (~350 MB), any OS
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
| **Google** | **65.7** | **41.2** | 1.1 s | online, free |
| Yandex (LLM) | 63.4 | 34.9 | 1.3 s | online, free |
| Yandex (classic), default by preference | 62.6 | 37.8 | 1.3 s | online, free (5/150 failed) |
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
10. **Cleanup: accuracy-ranked and light.** Translation became online only, ranked by benchmark accuracy at the time (Google first); later the owner chose Yandex classic as the default (step 17). Every local translation model was removed, and the live text is translated online at most every 1.5 s, in the background. Unused speech models, benchmark data and test transcripts went to the Trash (recoverable). The server folder dropped from 5.5 GB to about 350 MB (models 251 MB, Python environment 100 MB, down from 309 MB). Smoke test passed: 0% CPU when idle.

11. **English sentences.** English speech was being mistranslated (GigaAM writes it in garbled Latin letters, e.g. "This Reserches the potencial the overtiran conventional Hyprofeces"). We tried a Whisper language detector, then switched to a zero-cost text check: mostly Latin letters means an English sentence. Only those sentences go to Whisper-tiny (~0.6 s each), which writes down what was said. A popup switch can hide them, and mixed Russian sentences are always kept. The text check passed 9/9 on real and mixed examples.
12. **GitHub + agent-friendly setup.** Public repo, AGENTS.md (constraints, protocol, gotchas), tests and CI, and issues for the next stage.
13. **Save transcripts (#1).** Off / Manual / Auto in Markdown, SRT, TXT or JSON, saved only when you choose it. The server's own log became opt-in.
14. **Panel redesign from caption-UX research** (Meet, Teams, Live Caption):
    - newest sentence at the bottom, with a separate LIVE line
    - scrollback and a "↓ new" button
    - resize, compact mode, background opacity
    - gentle motion and a "CC" pill
    The test runs caught several bugs: a flexbox overflow, frozen boxes after an extension reload (now re-injected on demand), and a history anchored to the top instead of the bottom.
15. **Learning mode.** Yandex word alignment colors each Russian word and its translation the same, including the live line.
16. **Record a class (#3).** Audio and/or transcript. Chrome on Linux can't record MP3/AAC, so MP3 is encoded with lamejs; a WebM option keeps files smallest, with the missing length patched into the file. An MP3 race that doubled the audio was found and fixed.
17. **Owner's choices.** Yandex classic is the default translator. Subtitle mode is translation-only, like YouTube CC. The license is PolyForm Strict (personal use only).
18. **Auto-start + remembered sites (#2).** A headless test confirmed Chrome blocks tab capture until the user invokes the extension ("Extension has not been invoked for the current page"). So listed sites get a one-key prompt when they start playing sound. The popup reads the site from the tab address, so it works on tabs opened before an extension reload. Subtitle mode was debugged with headless screenshots: 2-line limit, long sentences in pieces, live tail, status line, iframe players.

19. **Issues #4 and #5 done.**
    - Built: word card (pymorphy3, offline and fast, plus a cached meaning), known words by dictionary form, save words, Anki export, class word summary, Russian-first, read aloud with ducking, microphone source, final-only, outline captions, Test button.
    - Skipped as overkill: stress marks and difficulty tint (large data or models), per-sentence audio replay, side panel, second target language.
    - The popup now has three tabs: Basic, Advanced, Extra.

20. **Chrome Web Store prep (v1.6).**
    - **Measured:** the always-on server held ~500 MB of RAM all day. Models now load on Start and unload after 5 idle minutes, with `malloc_trim` so the memory really goes back to the system. Idle went from ~500 MB to ~40–75 MB. Whisper loads only when someone speaks English, and the MP3 encoder only when an MP3 recording starts.
    - **No access to websites by default:** the page script used to run on every site, which triggers Chrome's "read and change all your data on all websites" warning. Now it's injected only into the tab where you start subtitles. Auto-start asks for access to just that one site when you tick it, and gives it back when you untick it.
    - **Server only answers the extension:** web pages could otherwise open `ws://127.0.0.1:8765`, since browsers apply no CORS to WebSockets, so other origins are refused.
    - **Store and install:** one-line installer, a setup page on first install, new icons, a privacy policy, listing text, and screenshots generated by headless Chrome.

21. **Any major subtitle language + final bug sweep.**
    - 38 target languages were checked against all three translators. Speech stays Russian; any spoken language is planned in [#7](https://github.com/abdullahmiraz/live-class-subtitles/issues/7).
    - English speech is translated into the chosen language, with the original kept.
    - The popup got ⓘ explanations and a "Coming soon" list.
    - New headless end-to-end test: Chrome's fake microphone → offscreen → server → overlay → saved files (`extension/tests/e2e_headless.py`).
    - Fixed:
      - The Test button reported speech recognition as failed while the models were unloaded.
      - Word-card meanings didn't follow a language change.
      - Saved notices and errors were invisible in subtitle mode.
      - The word card and the auto-start prompt were hidden over fullscreen video.
      - The Anki export used a blob link that could die with the popup.
      - Setup hints said "run start.sh" to store users.
      - The ON badge was lost after a page reload.

22. **New name: Live Class Subtitles** (before the first store upload). "RU→EN" no longer fit once subtitles came in 38 languages. The store title is "Live Class Subtitles – Russian to 38 Languages". Files now go to `Downloads/live-class-subtitles/`. The repository is now `live-class-subtitles` (old links redirect), and so is the autostart service; `install-autostart.sh` removes the old one.

23. **v2.0: nothing to install.**
    - **The problem:** the setup page asked users to paste a terminal command (Linux only), which most people won't do.
    - **How other extensions do it:** a competitor extension that needs no install turned out to use Chrome's built-in Web Speech API on the captured tab track (`recognition.start(track)`, Chrome 135+). A headless spike confirmed it works for Russian in our offscreen document, both online and with Chrome's downloadable on-device pack.
    - **What changed:** this is now the default engine, and translation and word alignment moved into the extension (`translate.js`).
    - **The companion app is optional,** for best accuracy and full privacy. It has one-step installers for Windows (double-click), macOS and Linux (one line), plus a cross-platform model downloader. The welcome page shows the steps for your system.

## Roadmap
Next stage (tracked as [GitHub issues](https://github.com/abdullahmiraz/live-class-subtitles/issues?q=label%3Anext-stage)):
- ~~Save translations (both languages) to a file~~ ✅ done (v1.1)
- ~~Record the class audio~~ ✅ done (v1.2)
- ~~Learning tools (#4) and borrowed ideas (#5)~~ ✅ done (v1.5)
- ~~Auto-start on listed websites + remember used sites~~ ✅ done (v1.4, one-key start because Chrome requires a gesture)
- ~~Chrome Web Store package, lighter idle server, per-site access~~ ✅ done (v1.6)
- Lite version for low-RAM PCs ([#6](https://github.com/abdullahmiraz/live-class-subtitles/issues/6)) and a Pro version with more languages ([#7](https://github.com/abdullahmiraz/live-class-subtitles/issues/7)), both free

## License
Copyright © 2026 Abdullah Miraz. **Source-available, not open source.** Licensed under the [PolyForm Strict License 1.0.0](LICENSE):
- ✅ Personal, non-commercial use: study, hobby, your own classes. Use by schools and non-profits is also allowed by the license.
- ❌ No redistribution, no publishing modified versions, no building other products or services on it, no commercial use, unless you have written permission. [Open an issue](https://github.com/abdullahmiraz/live-class-subtitles/issues) or [message me on LinkedIn](https://www.linkedin.com/in/abdullahmiraz/) to ask.
- Breaking the terms ends your license (after a 32-day chance to fix it after written notice). After that, any further use is copyright infringement.

Versions published before 2026-10-24 19:30 were MIT-licensed. Those copies keep MIT; everything from this commit on is PolyForm Strict.

## Credits
Models are downloaded at setup, not stored in this repo:
[GigaAM-v3](https://github.com/salute-developers/GigaAM) (Sber, MIT),
[Whisper](https://github.com/openai/whisper) tiny (OpenAI, MIT),
[Silero VAD](https://github.com/snakers4/silero-vad) (MIT),
streaming Zipformer RU (Alpha Cephei / Vosk, Apache-2.0), all run via
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
Benchmarks use [Google FLEURS](https://huggingface.co/datasets/google/fleurs) (CC-BY-4.0).
MP3 encoding uses [lamejs](https://github.com/zhuker/lamejs) (LGPL-3.0, bundled unmodified in `extension/vendor/`).

## Contact
Bugs, ideas and questions: [GitHub issues](https://github.com/abdullahmiraz/live-class-subtitles/issues). Permission requests or anything private: [LinkedIn](https://www.linkedin.com/in/abdullahmiraz/). More about me: [miraz.dev](https://www.miraz.dev/about).

## Privacy
Audio only goes to the server on your own PC; only the recognized text goes to the translator. No accounts, analytics or tracking. Details: [PRIVACY.md](PRIVACY.md).

## Publishing to the Chrome Web Store (maintainer)
1. Bump `version` in `extension/manifest.json`. Run `./package.sh`. It runs the checks and writes `dist/live-class-subtitles-<version>.zip`.
2. If the UI changed, refresh the screenshots:
   - Start a current server: `./start.sh`, or on a spare port: `cd server && .venv/bin/python server.py --port 8799`.
   - Then run `uv run --no-project --with websockets --with pillow python store/screenshots.py store/subs.json ws://127.0.0.1:8799 && uv run --no-project --with pillow python store/compose.py`. Everything runs headless.
3. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), upload the zip. Fill in the listing and privacy tabs from [store/LISTING.md](store/LISTING.md).

## Notes / limits
- The Google/Yandex endpoints are the free, unauthenticated ones their own browser features use. This project is not affiliated with Google or Yandex; use them for personal, moderate use. There is no account quota or token limit, but they are unofficial: heavy use from one IP can get temporarily rate-limited, and they could change. A failing engine is skipped for 20 s and the next one is used. **Translation needs internet.**
- Speech recognition is the one local part. It has to be: no free, permanent online service converts Russian speech to text. It is light, though (see benchmarks).
- End-to-end check without a window: `uv run --no-project --with websockets python extension/tests/e2e_headless.py <16 kHz Russian .wav> ws://127.0.0.1:8765 es`. It runs microphone mode with Chrome's fake microphone, so tab capture itself still needs a manual test, since Chrome requires a click.
- Re-run benchmarks: `cd server && uv pip install --python .venv/bin/python -r dev/requirements-dev.txt && .venv/bin/python dev/bench.py asr --cond clean noisy` (needs the FLEURS data, see dev/bench.py).
