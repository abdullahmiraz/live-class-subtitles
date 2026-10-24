# Chrome Web Store listing (copy-paste source)

Upload: `./package.sh` → `dist/ru-en-live-subtitles-<version>.zip` →
[Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Add new item** (first time) or the item → **Package → Upload new package**.

## Store listing tab

**Name** (from manifest): RU→EN Live Subtitles

**Summary** (manifest `description`, max 132 chars):
> Live Russian→English subtitles for any tab. Speech recognition runs on your own PC.

**Category:** Education · **Language:** English

**Description:**
```
Live English subtitles for Russian audio in any Chrome tab: online classes, lectures, Zoom/Meet in the browser, YouTube, podcasts.

Free. No account. No API keys. Your audio never leaves your computer.

HOW IT WORKS
A small free companion server runs on your PC and turns the Russian speech into text (GigaAM-v3, one of the most accurate open Russian models). The text is translated by free Yandex or Google translation. The extension shows it as you listen.

• Two views: a resizable panel with history, or YouTube-style subtitles over the video (also in fullscreen)
• Live text while the teacher speaks, then the accurate sentence a moment later
• Record a class: transcript (Markdown, SRT, TXT, JSON) and/or audio (MP3 or WebM)
• Sentences spoken in English are written down as they were said, not "translated"
• Auto-start offer on your class sites, keyboard shortcut Alt+Shift+Y
• Microphone mode for in-person classes

LEARN RUSSIAN WHILE YOU LISTEN
• Color-matched words: each Russian word and its English translation share a color
• Hover any Russian word: dictionary form, grammar (case, tense, aspect…) and meaning
• Save words, mark the ones you know, export your vocabulary to Anki
• Russian-first mode: the English stays blurred until you hover

SETUP (once, Linux)
After installing, a setup page shows a one-line command that installs the companion server. It starts by itself at login and uses ~40 MB of memory while idle.

Requires: Linux desktop with Chrome 116+. Source, help and issues: https://github.com/abdullahmiraz/ru-en-live-subtitles
Made by Abdullah Miraz: https://www.miraz.dev/about
```

**Graphics** (in `store/`):
- Store icon 128×128: `extension/icons/128.png`
- Screenshots 1280×800: `store/screenshot-*.png`
- Small promo tile 440×280: `store/promo-small.png`

**Homepage URL:** https://github.com/abdullahmiraz/ru-en-live-subtitles
**Support URL:** https://github.com/abdullahmiraz/ru-en-live-subtitles/issues

## Privacy tab

**Single purpose:**
> Show live English subtitles (translation) for Russian speech playing in a browser tab.

**Permission justifications:**
| Permission | Justification |
|---|---|
| tabCapture | Captures the audio of the tab the user starts subtitles on (only after clicking the icon or pressing the shortcut) so the speech can be recognized and translated. |
| offscreen | Hosts the audio capture, recognition stream and optional recording in an offscreen document, because MV3 service workers can't use audio APIs. |
| activeTab | Shows the subtitle overlay on the tab where the user started subtitles, without access to any other site. |
| scripting | Injects the subtitle overlay script into that tab on demand, instead of running on every website. |
| storage | Saves the user's settings, vocabulary list, known words and remembered sites. |
| downloads | Saves recordings and transcripts the user explicitly asked for to the Downloads folder. |
| Optional host permissions (`*://*/*`) | Asked for one site at a time, only when the user turns on auto-start for that site, so the extension can notice when it plays sound and offer to start subtitles. |

**Remote code:** No. All code is in the package. (The extension talks to a local companion server over `ws://127.0.0.1`; it sends audio and receives text, never code.)

**Data usage:**
- Tick **Website content**: the audio of the tab, processed to show subtitles.
  - Before ticking it, re-read the current form wording. Data processed only on-device or in your own local server is often not "collected". If the form says so, tick nothing.
- Certify all three:
  - not sold to third parties
  - not used for purposes unrelated to the single purpose
  - not used for creditworthiness or lending

**Privacy policy URL:** https://github.com/abdullahmiraz/ru-en-live-subtitles/blob/main/PRIVACY.md

## Distribution tab
- Visibility: **Public**, or **Unlisted** for a first soft launch (only people with the link can install it).
- Regions: all.

## Notes for reviewers (Test instructions field)
```
The extension needs its free companion server on the same computer (it does the speech recognition locally).
Install on Linux: curl -fsSL https://raw.githubusercontent.com/abdullahmiraz/ru-en-live-subtitles/main/install.sh | bash
Then open a tab with Russian speech (e.g. any Russian YouTube lecture), click the extension icon → Start.
Without the server the popup shows "Local server: not running · set it up".
```
