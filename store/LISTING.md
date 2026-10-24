# Chrome Web Store listing (copy-paste source)

Upload: `./package.sh` → `dist/live-class-subtitles-<version>.zip` →
[Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Add new item** (first time) or the item → **Package → Upload new package**.

## Store listing tab

**Name** (from manifest, max 75 chars): Live Class Subtitles – Russian to 38 Languages

**Summary** (manifest `description`, max 132 chars):
> Live subtitles for Russian audio in any tab: English or 37 other languages. Nothing to install. Learn Russian as you listen.

**Category:** Education · **Language:** English

**Description:**
```
Live subtitles for Russian audio in any Chrome tab (online classes, lectures, Zoom/Meet in the browser, YouTube, podcasts) in English or 37 other languages: Spanish, German, French, Arabic, Hindi, Bengali, Urdu, Turkish, Chinese, Kazakh, Uzbek and more.

Free. No account. No API keys. Nothing else to install: works on Windows, Mac, Linux and ChromeOS.

HOW IT WORKS
Click the icon (or press Alt+Shift+Y) on the tab with your class. Chrome's built-in speech recognition turns the Russian into text and a free translator (Yandex or Google) translates it as you listen.

• Two views: a resizable panel with history, or YouTube-style subtitles over the video (also in fullscreen)
• Live text while the teacher speaks, then the finished sentence
• Record a class: transcript (Markdown, SRT, TXT, JSON) and/or audio (MP3 or WebM)
• Sentences spoken in English are kept as said (and translated if your subtitles aren't English)
• Auto-start offer on your class sites, microphone mode for in-person classes

LEARN RUSSIAN WHILE YOU LISTEN
• Color-matched words: each Russian word and its translation share a color
• Hover any Russian word for its meaning; save words, mark the ones you know, export to Anki
• Russian-first mode: the translation stays blurred until you hover

MORE PRIVACY OR MORE ACCURACY (optional)
• On this computer: Chrome downloads a Russian speech pack once, then the audio never leaves your PC.
• Companion app (free, Windows/Mac/Linux): GigaAM, one of the most accurate open Russian speech models, on your own PC, with punctuation and grammar in word cards. Windows: download and double-click; Mac/Linux: paste one line in Terminal.

Source, help and issues: https://github.com/abdullahmiraz/live-class-subtitles
Made by Abdullah Miraz: https://www.miraz.dev/about · LinkedIn: https://www.linkedin.com/in/abdullahmiraz/
```

**Graphics** (in `store/`):
- Store icon 128×128: `extension/icons/128.png`
- Screenshots 1280×800: `store/screenshot-*.png`
- Small promo tile 440×280: `store/promo-small.png`

**Homepage URL:** https://github.com/abdullahmiraz/live-class-subtitles
**Support URL:** https://github.com/abdullahmiraz/live-class-subtitles/issues

## Privacy tab

**Single purpose:**
> Show live subtitles (a translation into the user's language) for Russian speech playing in a browser tab.

**Permission justifications:**
| Permission | Justification |
|---|---|
| tabCapture | Captures the audio of the tab the user starts subtitles on (only after clicking the icon or pressing the shortcut) so the speech can be recognized and translated. |
| offscreen | Hosts the audio capture, Chrome's speech recognition and the optional recording in an offscreen document, because MV3 service workers can't use audio APIs. |
| Host permissions: translate.googleapis.com, translate.yandex.net, browser.translate.yandex.net | Sends the recognized sentences to these free translation services and receives the translation. No other sites. |
| activeTab | Shows the subtitle overlay on the tab where the user started subtitles, without access to any other site. |
| scripting | Injects the subtitle overlay script into that tab on demand, instead of running on every website. |
| storage | Saves the user's settings, vocabulary list, known words and remembered sites. |
| downloads | Saves recordings and transcripts the user explicitly asked for to the Downloads folder. |
| Optional host permissions (`*://*/*`) | Asked for one site at a time, only when the user turns on auto-start for that site, so the extension can notice when it plays sound and offer to start subtitles. |

**Remote code:** No. All code is in the package. It calls translation APIs (JSON text in and out) and, only if the user installed the optional companion app, a local server on `ws://127.0.0.1` (audio in, text out). Neither ever returns code.

**Data usage:**
- Tick **Website content**. That covers the tab audio, which Chrome's built-in speech recognition sends to Google's speech service by default, and the recognized text, which goes to the translator. The developer receives none of it.
- Certify all three:
  - not sold to third parties
  - not used for purposes unrelated to the single purpose
  - not used for creditworthiness or lending

**Privacy policy URL:** https://github.com/abdullahmiraz/live-class-subtitles/blob/main/PRIVACY.md

## Distribution tab
- Visibility: **Public**, or **Unlisted** for a first soft launch (only people with the link can install it).
- Regions: all.

## Notes for reviewers (Test instructions field)
```
No setup is needed: open a tab with Russian speech (e.g. any Russian YouTube lecture), click the extension icon → "Start on this tab". Subtitles appear within a few seconds (Chrome's built-in speech recognition, needs internet).
The optional companion app (popup → Advanced → Speech recognition → Companion app) is not required for any of the reviewed functionality.
```
