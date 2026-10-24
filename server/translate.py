"""Russian -> English (or another major language) through free online endpoints (no account, no key, no local CPU).

Default order for English is the owner's choice (Yandex classic reads best to them in real classes); FLEURS chrF
benchmark for reference: google 65.7, yandex (LLM) 63.4, yandex-nmt (classic) 62.6. For other target languages
Google goes first: in a 2026-10-24 spot check Yandex LLM invented text for Japanese and garbled Hindi/Bengali,
and Yandex classic dropped half a Portuguese sentence.
  yandex-nmt  classic Yandex neural MT (mobile app endpoint)   <- default first
  google      Google Translate "gtx" endpoint
  yandex      Yandex Browser endpoint (LLM-based)

translate_chain() tries them in RANKED order; an engine that errors is skipped for COOLDOWN seconds.
"""
import html
import json
import time
import urllib.parse
import urllib.request
import uuid

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
RANKED = ["yandex-nmt", "google", "yandex"]  # target English
RANKED_OTHER = ["google", "yandex-nmt", "yandex"]  # any other target language
# Target languages offered in the popup (all checked against all three engines). Code = ISO 639-1, as Yandex uses.
TARGETS = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese",
    "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian", "cs": "Czech", "ro": "Romanian", "hu": "Hungarian",
    "el": "Greek", "bg": "Bulgarian", "sr": "Serbian", "sv": "Swedish", "fi": "Finnish", "tr": "Turkish",
    "az": "Azerbaijani", "kk": "Kazakh", "uz": "Uzbek", "ky": "Kyrgyz", "tg": "Tajik", "hy": "Armenian",
    "ka": "Georgian", "he": "Hebrew", "ar": "Arabic", "fa": "Persian", "hi": "Hindi", "bn": "Bengali",
    "ur": "Urdu", "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese", "th": "Thai", "zh": "Chinese",
    "ja": "Japanese", "ko": "Korean",
}
# Yandex returns word alignment (learning-mode colors) for these targets (checked 2026-10-24); others: plain text.
ALIGNED = {"en", "es", "fr", "de", "it", "pt", "pl", "uk", "cs", "bg", "sr", "tr", "az", "kk", "uz", "ky", "tg", "hy", "he"}
GOOGLE_CODE = {"zh": "zh-CN", "he": "iw"}


def target(code):
    """A safe target code from user input (unknown -> English)."""
    return code if code in TARGETS else "en"
COOLDOWN = 20.0  # one slow reply shouldn't bench the preferred engine for long
_sid = uuid.uuid4().hex
_down_until = {}


def _request(url, data=None, timeout=4.0):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def google(text, tl="en", sl="ru"):
    q = urllib.parse.urlencode({"client": "gtx", "sl": GOOGLE_CODE.get(sl, sl), "tl": GOOGLE_CODE.get(tl, tl), "dt": "t", "q": text})
    d = _request(f"https://translate.googleapis.com/translate_a/single?{q}")
    return "".join(p[0] for p in d[0] if p and p[0]).strip()


def yandex(text, tl="en", sl="ru"):
    # this endpoint only accepts format=html (format=text returns 413)
    q = urllib.parse.urlencode({
        "translateMode": "context", "context_title": "lecture", "id": f"{_sid}-0-0", "srv": "yabrowser",
        "lang": f"{sl}-{tl}", "format": "html", "text": html.escape(text, quote=False),
    })
    d = _request(f"https://browser.translate.yandex.net/api/v1/tr.json/translate?{q}")
    if d.get("code") != 200:
        raise RuntimeError(d)
    return html.unescape(" ".join(d["text"])).strip()


def yandex_nmt(text, tl="en", sl="ru"):
    d = _request(f"https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-mobile&lang={sl}-{tl}&id={_sid}-00-0", {"text": text})
    if d.get("code") != 200:
        raise RuntimeError(d)
    return " ".join(d["text"]).strip()


def yandex_aligned(text, tl="en"):
    """Yandex classic translation plus word alignment (options=4), for learning mode.
    Returns (translation, [[ru_start, ru_len, tr_start, tr_len], ...]) as character offsets.
    European targets get word pairs; for e.g. Chinese/Japanese/Arabic/Hindi Yandex returns none (plain text then)."""
    url = f"https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-mobile&lang=ru-{tl}&id={_sid}-00-0&options=4"
    d = _request(url, {"text": text})  # plain-text POST: offsets map 1:1 onto `text`
    if d.get("code") != 200:
        raise RuntimeError(d)
    en = " ".join(d["text"]).strip()
    pairs = []
    for chunk in (d.get("align") or [""])[0].split(","):
        try:
            src, dst = chunk.split("-")
            (rs, rl), (es, el) = (map(int, src.split(":")), map(int, dst.split(":")))
            pairs.append([rs, rl, es, el])
        except ValueError:
            continue
    return en, pairs


ENGINES = {"google": google, "yandex": yandex, "yandex-nmt": yandex_nmt}


def translate_chain(first, text, tl="en", sl="ru"):
    """Translate with `first` (or 'auto'), then the rest in accuracy order. Returns (translation, engine)."""
    if not text.strip():
        return "", "none"
    if sl == tl:
        return text, "none"
    ranked = RANKED if tl == "en" else RANKED_OTHER
    order = ranked if first not in ENGINES else [first] + [e for e in ranked if e != first]
    now = time.monotonic()
    for name in order:
        if _down_until.get(name, 0) > now:
            continue
        try:
            out = ENGINES[name](text, tl, sl)
            if out:
                return out, name
        except Exception as e:
            _down_until[name] = now + COOLDOWN
            print(f"[translate] {name} failed ({e}); skipping it for {COOLDOWN:.0f}s", flush=True)
    return "", "none"


if __name__ == "__main__":
    import sys
    text = " ".join(sys.argv[1:]) or "Сегодня мы рассмотрим интеграл Римана и его основные свойства."
    for n, f in ENGINES.items():
        t = time.time()
        try:
            out = f(text)
            print(f"{n:11} {time.time() - t:5.2f}s  {out}")
        except Exception as e:
            print(f"{n:11} ERROR {e}")
