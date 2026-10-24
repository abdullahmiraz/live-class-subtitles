# Privacy policy: RU→EN Live Subtitles

_Last updated: 24 October 2026_

RU→EN Live Subtitles (the Chrome extension and its companion server) is built by Abdullah Miraz
([miraz.dev](https://www.miraz.dev/about)). It does not collect, sell or share any personal data. The developer
receives nothing: there are no accounts, analytics, ads or tracking.

## What happens to your data

| Data | Where it goes |
|---|---|
| **Tab or microphone audio** | Only to the companion server on **your own computer** (`127.0.0.1`). Never sent anywhere else. |
| **Recognized text** (the Russian sentences) | Sent by the companion to a free online translator to get the English: Yandex Translate (`translate.yandex.net`) and/or Google Translate (`translate.googleapis.com`), in the order you choose. Their own privacy policies apply. |
| **Words you look up** (word card) | The dictionary form of the word is sent to the same translator for its meaning. |
| **Settings** | `chrome.storage.sync` (synced by Chrome between your own devices if you use Chrome sync). |
| **Vocabulary, known words, remembered sites** | `chrome.storage.local`, on your computer only. |
| **Recordings and transcripts** | Only when you start a recording; saved as files in your Downloads folder. |
| **Read aloud** | Uses your browser's text-to-speech voices. Some voices are provided online by your browser's vendor. |

## Permissions and why they are needed
- **tabCapture**: hear the audio of the tab you start subtitles on (only after you click the icon or press the shortcut).
- **offscreen**: process that audio in the background.
- **activeTab / scripting**: show the subtitles on the page you started them on.
- **Optional site access**: asked for only when you turn on auto-start for a site, so the extension can notice that site playing sound.
- **storage**: keep your settings and vocabulary.
- **downloads**: save recordings and transcripts you asked for.

## Contact
Questions: open an issue at <https://github.com/abdullahmiraz/ru-en-live-subtitles/issues>.
