# Real-time Russian → English translation of Chrome tab audio: research report

Researched 2026-10-24 by four parallel agents. Pricing and free limits change often, so check them before relying on them. Items marked *(unverified)* came from third-party sources only.

## Your machine (checked)
- CPU: Xeon E5-2670 v3, 24 threads · RAM: 16 GB
- GPU: AMD RX 580. **No CUDA**, and ROCm doesn't support it, but Vulkan works. Tools that need NVIDIA (SeamlessM4T overlay, Canary, pcgarat) are out.
- Audio: PipeWire 1.0.5, `pw-record` available · Chrome 152 · Docker, Python, ffmpeg available

## Why your current extension feels weak
The speech-translator-ext README doesn't name its speech-to-text (STT) engine or its capture method. The better engines are behind Patreon/Boosty. It almost certainly relies on generic browser speech recognition plus machine translation, sentence by sentence. It can't be tuned for Russian, and you can't swap the model.

## How the competitors do it
Almost every serious tool follows the same three-step pattern:

```
tab audio (chrome.tabCapture → offscreen document → AudioWorklet, 16 kHz PCM)
   → STT (cloud streaming: Soniox/Deepgram, OR local Whisper)
   → translation (DeepL/LLM/Chrome Translator)
   → subtitle overlay (shadow-DOM box in the page)
```

| Tool | Engine | Free? | Russian → English | Linux | Verdict |
|---|---|---|---|---|---|
| Chrome Live Caption + Live Translate | on-device captions, Google translation | free | **Russian is not on the translate-from list** | yes | not usable for you |
| Edge real-time video translation | Microsoft | — | — | — | **retired** (Edge 152–155, Aug 2026) |
| SubSync (clipsule.app) | Soniox stt-rt-v4 | 30 min/day | Soniox supports Russian; extension doesn't list it *(unverified)* | Chrome | best quick test; cap too low for full classes |
| Live Caption Translate (CWS) | Deepgram / in-browser Whisper / local Whisper server + OpenAI or **Ollama** | free with local engines | Whisper handles Russian | Chrome | the closest free off-the-shelf option |
| Live Translate (CWS) | Google AI Studio key (Gemini) | free key | *(unverified)* | Chrome | sends audio to Google; tiny user base |
| Talo/Palabra, Wordly, Maestra | proprietary | trials only | — | — | paid ($33+/mo) |
| LiveSub | local model | free | **no** (English/Japanese only) | no | — |
| Immersive Translate, Language Reactor, Trancy | translate existing subtitles | freemium | — | — | don't handle raw audio |

Paid tools charge for the cloud STT step (Soniox ≈ $0.10–0.18/h, Deepgram ≈ $0.29–0.46/h). The extension code itself is simple.

## Desktop overlay apps on Linux
| Tool | Russian → English | Fits your PC? |
|---|---|---|
| jt55401/translation-overlay (SeamlessM4T, PipeWire monitor, PyQt overlay) | yes | ❌ needs NVIDIA |
| EduardoMilani8/live-caption-overlay (faster-whisper + Argos + Qt overlay, per-app capture) | likely | ✅ CPU; closest ready-made |
| gitlon/Local-Live-Captions (Nemotron/Whisper + NLLB, Wayland overlay) | unconfirmed | ✅ experimental, 1 commit |
| Speech Note (Flatpak) | yes | ✅ but no overlay, mic input only (route the monitor as input) |
| Buzz | Whisper translate → English | ✅ no overlay |
| LiveCaptions (abb128) | English only | ❌ |
| LiveCaptions-Translator, Windows Live Captions | — | ❌ Windows only |

## The building blocks, and the free options for each

**Speech-to-text (Russian):**
- **GigaAM-v3** (Sber): the best open Russian ASR (word error rate ≈ 3–8%), runs on CPU, includes punctuation. ← best local choice for you
- **T-one** (T-Bank): true streaming, 300 ms chunks, runs in real time on a single CPU thread. Trained on phone calls, so test it on lecture audio first.
- **faster-whisper / whisper.cpp** (Vulkan backend works on the RX 580): large-v3-turbo is good but weaker than GigaAM on Russian.
- Cloud, free: **Groq whisper-large-v3-turbo** (≈ 8 audio-h/day free, chunked) *(unverified)*. **Deepgram Nova-3 `ru`** streaming on the $200 signup credit (≈ 400 h) *(unverified)*. Azure has 5 h/month free.
- Chrome `SpeechRecognition.start(audioTrack)` (would take tab audio and is free): **contradictory reports and no on-device Russian pack confirmed.** It's worth a 20-line test, but don't build on it.

**Translation:**
- **Chrome Translator API** (on-device, Chrome 138+, ru↔en supported, no quota): free and private, quality is basic.
- **Opus-MT ru-en / Argos**: local, fast on CPU, unlimited.
- An LLM for better quality: local Ollama (qwen2.5 7B is slow-ish on CPU) or the Groq/Gemini free tiers.
- Azure Translator: 2M chars/month free (≈ 33 class-hours). A lecture is ≈ 55–70k Russian chars/hour.

## Recommendation

### Step 0: free test today, no code (15 min)
1. Install **SubSync** and run it on one class (30 free min/day) to see what "good" looks like.
2. Install **Live Caption Translate**, pick in-browser Whisper, and translate with Ollama or skip translation, then compare.

### Step 1: build your own, $0 forever, fully local (recommended)
```
┌──────── Chrome extension (MV3) ────────┐        ┌──── local server (Python, Docker) ────┐
│ popup click → tabCapture.getMediaStreamId│  WS   │ Silero VAD                             │
│ offscreen doc: getUserMedia(tab)         │──PCM─▶│ STT: GigaAM-v3 (or T-one streaming)    │
│   ├─ → AudioContext.destination (audible)│       │ MT : Opus-MT ru-en (or Ollama/Groq LLM)│
│   └─ → AudioWorklet 16 kHz Int16         │◀─text─│ returns {ru_partial, ru_final, en}     │
│ content script: draggable shadow-DOM     │       └────────────────────────────────────────┘
│ subtitle box (RU small / EN large)       │                 ▲
└──────────────────────────────────────────┘                 │ same server
                                                pw-record on a PipeWire monitor source
                                                → desktop overlay (Zoom/Telegram apps)
```
- One backend serves both Chrome tabs and any desktop app, through `pw-record` on a monitor source.
- Expected latency: ≈ 1–3 s, running on CPU. No quotas, and the lecture audio never leaves your PC.
- Optional switches: Groq/Deepgram as the STT engine, the Chrome Translator API as the zero-setup translator, an LLM "polish" pass on final sentences, and transcript export (SRT/Markdown) for study notes.
- Code to reuse: `petercunha/live-captions-translate` (tabCapture + offscreen + WebGPU Whisper + Translator + overlay) and `hyderoo/airsubs` (MIT; capture, overlay, SRT export). Check licenses before copying.
- Main risks: Russian quality on noisy classroom audio (measure word error rate on a recording first), and WebGPU on the RX 580 under Linux. That second risk is why the plan runs the models server-side, not in the browser.

### Routing system audio on Linux (for the desktop path)
```
pactl load-module module-null-sink sink_name=captions sink_properties=device.description=Captions
pactl load-module module-loopback source=captions.monitor sink=@DEFAULT_SINK@
# pavucontrol → Playback → move the app to "Captions"; capture from captions.monitor
```
(`pactl` comes from `pulseaudio-utils`, which isn't installed yet. You can use `pw-loopback` instead.)

## Key sources
- Chrome tab capture docs: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Chrome Translator API: https://developer.chrome.com/docs/ai/translator-api
- Chrome Live Caption languages: https://support.google.com/chrome/answer/10538231
- GigaAM: https://github.com/salute-developers/GigaAM · T-one: https://github.com/voicekit-team/T-one
- Deepgram Nova-3 Russian: https://developers.deepgram.com/changelog/2026/8/17
- petercunha/live-captions-translate: https://github.com/petercunha/live-captions-translate
- hyderoo/airsubs: https://github.com/hyderoo/airsubs
- SubSync: https://chromewebstore.google.com/detail/magapeelmfmifldanpjoeamcphohlchg
- Live Caption Translate: https://chromewebstore.google.com/detail/cphjjnabbjlphjhbbikgillmgnheolkj
