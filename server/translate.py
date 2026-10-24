"""ru->en translation through free online endpoints (no account, no key, no local CPU).

Ranked by measured accuracy on FLEURS (chrF vs human references):
  google      65.7  Google Translate "gtx" endpoint
  yandex      63.4  Yandex Browser endpoint (LLM-based)
  yandex-nmt  62.6  classic Yandex neural MT (mobile app endpoint)

translate_chain() tries them in that order; an engine that errors is skipped for COOLDOWN seconds.
"""
import html
import json
import time
import urllib.parse
import urllib.request
import uuid

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
RANKED = ["google", "yandex", "yandex-nmt"]
COOLDOWN = 60.0
_sid = uuid.uuid4().hex
_down_until = {}


def _request(url, data=None, timeout=4.0):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def google(text):
    q = urllib.parse.urlencode({"client": "gtx", "sl": "ru", "tl": "en", "dt": "t", "q": text})
    d = _request(f"https://translate.googleapis.com/translate_a/single?{q}")
    return "".join(p[0] for p in d[0] if p and p[0]).strip()


def yandex(text):
    # this endpoint only accepts format=html (format=text returns 413)
    q = urllib.parse.urlencode({
        "translateMode": "context", "context_title": "lecture", "id": f"{_sid}-0-0", "srv": "yabrowser",
        "lang": "ru-en", "format": "html", "text": html.escape(text, quote=False),
    })
    d = _request(f"https://browser.translate.yandex.net/api/v1/tr.json/translate?{q}")
    if d.get("code") != 200:
        raise RuntimeError(d)
    return html.unescape(" ".join(d["text"])).strip()


def yandex_nmt(text):
    d = _request(f"https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-mobile&lang=ru-en&id={_sid}-00-0", {"text": text})
    if d.get("code") != 200:
        raise RuntimeError(d)
    return " ".join(d["text"]).strip()


ENGINES = {"google": google, "yandex": yandex, "yandex-nmt": yandex_nmt}


def translate_chain(first, text):
    """Translate with `first` (or 'auto'), then the rest in accuracy order. Returns (english, engine)."""
    if not text.strip():
        return "", "none"
    order = RANKED if first not in ENGINES else [first] + [e for e in RANKED if e != first]
    now = time.monotonic()
    for name in order:
        if _down_until.get(name, 0) > now:
            continue
        try:
            out = ENGINES[name](text)
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
