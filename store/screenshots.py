"""Make the Chrome Web Store screenshots (1280x800) with the real extension in headless Chrome.

  uv run --no-project --with websockets --with pillow python store/screenshots.py store/subs.json

Needs a local server with the current code (word card lookup); pass its URL as the 2nd argument
(default ws://127.0.0.1:8765). A temporary copy of the extension gets a
content_scripts entry so the overlay can be driven without a user gesture; nothing in extension/ changes.
"""
import asyncio
import base64
import http.server
import itertools
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "build"  # raw shots; store/compose.py turns them into the upload images
PORT, PAGE_PORT = 9333, 8811
W, H = 1280, 800

SLIDE = """<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'>
<rect width='1280' height='720' fill='#f4f1ea'/><rect x='0' y='0' width='1280' height='110' fill='#24324a'/>
<text x='60' y='72' font-family='DejaVu Sans' font-size='40' fill='#fff' font-weight='bold'>Урок 7 · Глаголы движения</text>
<text x='80' y='210' font-family='DejaVu Sans' font-size='44' fill='#24324a'>идти — ходить</text>
<text x='80' y='280' font-family='DejaVu Sans' font-size='44' fill='#24324a'>ехать — ездить</text>
<text x='80' y='350' font-family='DejaVu Sans' font-size='44' fill='#24324a'>лететь — летать</text>
<text x='80' y='460' font-family='DejaVu Sans' font-size='30' fill='#6b6b6b'>Я иду в университет. Мы едем домой.</text>
<circle cx='1080' cy='560' r='90' fill='#d9d2c3'/><circle cx='1080' cy='520' r='38' fill='#b7ab95'/>
<rect x='1010' y='565' width='140' height='70' rx='35' fill='#b7ab95'/></svg>"""

PAGE = """<!doctype html><meta charset=utf-8><title>Russian class · Lesson 7</title>
<style>body{margin:0;background:#1f2329;font:15px system-ui;color:#ddd}
header{height:52px;display:flex;align-items:center;padding:0 22px;gap:12px;background:#15181c}
.dot{width:10px;height:10px;border-radius:50%;background:#e04848}
main{display:flex;gap:16px;padding:16px}
video{width:900px;height:506px;background:#000;border-radius:10px;object-fit:cover}
aside{flex:1;background:#2a2f36;border-radius:10px;padding:14px;height:478px}
.p{display:flex;align-items:center;gap:10px;margin:10px 0}.a{width:34px;height:34px;border-radius:50%;background:#4a5568}
</style><header><span class=dot></span><b>Russian for beginners</b> · Lesson 7 · live</header>
<main><video poster="data:image/svg+xml;base64,POSTER"></video>
<aside><b>Participants</b><div class=p><span class=a></span>Teacher</div><div class=p><span class=a></span>You</div>
<div class=p><span class=a></span>Anna</div><div class=p><span class=a></span>Marco</div></aside></main>"""


class CDP:
    def __init__(self, ws):
        self.ws, self.ids, self.waiting = ws, itertools.count(1), {}
        asyncio.get_running_loop().create_task(self._recv())

    async def _recv(self):
        async for m in self.ws:
            d = json.loads(m)
            if "id" in d and d["id"] in self.waiting:
                self.waiting.pop(d["id"]).set_result(d)

    async def send(self, method, params=None, session=None):
        i = next(self.ids)
        fut = asyncio.get_running_loop().create_future()
        self.waiting[i] = fut
        msg = {"id": i, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        await self.ws.send(json.dumps(msg))
        d = await asyncio.wait_for(fut, 30)
        if "error" in d:
            raise RuntimeError(f"{method}: {d['error']}")
        return d["result"]

    async def open(self, url):
        t = (await self.send("Target.createTarget", {"url": url}))["targetId"]
        s = (await self.send("Target.attachToTarget", {"targetId": t, "flatten": True}))["sessionId"]
        await self.send("Page.enable", session=s)
        await self.send("Emulation.setDeviceMetricsOverride",
                        {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False}, s)
        return t, s

    async def js(self, s, expr):
        r = await self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, s)
        return r["result"].get("value")

    async def shot(self, t, s, name, clip=None):
        await self.send("Target.activateTarget", {"targetId": t})
        await asyncio.sleep(0.6)
        p = {"format": "png"}
        if clip:
            p["clip"] = {**clip, "scale": 1}
        data = (await self.send("Page.captureScreenshot", p, s))["data"]
        (OUT / name).write_bytes(base64.b64decode(data))
        print("wrote", OUT / name)


def serve(folder):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=folder, **k)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PAGE_PORT), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def main(subs):
    OUT.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="ruen-shots-"))
    ext = tmp / "ext"
    shutil.copytree(ROOT / "extension", ext, ignore=shutil.ignore_patterns("tests"))
    m = json.loads((ext / "manifest.json").read_text())
    m["content_scripts"] = [{"matches": [f"http://127.0.0.1:{PAGE_PORT}/*"], "js": ["content.js"]}]
    m["host_permissions"] = [f"http://127.0.0.1:{PAGE_PORT}/*"]
    (ext / "manifest.json").write_text(json.dumps(m))
    (tmp / "class.html").write_text(PAGE.replace("POSTER", base64.b64encode(SLIDE.encode()).decode()), encoding="utf-8")
    srv = serve(str(tmp))
    chrome = subprocess.Popen(["google-chrome", "--headless=new", f"--remote-debugging-port={PORT}",
                               f"--user-data-dir={tmp / 'profile'}", "--enable-unsafe-extension-debugging",
                               "--no-first-run", "--no-default-browser-check", f"--window-size={W},{H}", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"))
                break
            except OSError:
                time.sleep(0.2)
        async with websockets.connect(ver["webSocketDebuggerUrl"], max_size=2**26) as ws:
            c = CDP(ws)
            ext_id = (await c.send("Extensions.loadUnpacked", {"path": str(ext)}))["id"]
            await asyncio.sleep(1.5)  # onInstalled opens welcome.html
            wt, ws_ = await c.open(f"chrome-extension://{ext_id}/welcome.html")
            await asyncio.sleep(1.5)
            await c.shot(wt, ws_, "raw-welcome.png")

            pt, ps = await c.open(f"http://127.0.0.1:{PAGE_PORT}/class.html")
            await asyncio.sleep(1.5)
            xt, xs = await c.open(f"chrome-extension://{ext_id}/popup.html")
            await asyncio.sleep(1)

            server = sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8765"
            await c.js(xs, f"""chrome.storage.sync.set({{server: "{server}"}}).then(() =>
              chrome.storage.local.set({{"ui:127.0.0.1:{PAGE_PORT}": {{w: 780, h: 380, left: 250, top: 380}}}}))""")
            await c.send("Page.reload", session=ps)
            await asyncio.sleep(1.5)

            async def to_page(msg):
                await c.js(xs, f"""chrome.tabs.query({{url: "http://127.0.0.1:{PAGE_PORT}/*"}})
                  .then(([t]) => chrome.tabs.sendMessage(t.id, {json.dumps(msg, ensure_ascii=False)}))""")

            base = {"showRu": True, "fontSize": 20, "bgOpacity": 0.9, "learn": True, "hoverCard": True, "finalOnly": False}
            # 1) panel with history, learning colors and a live line
            await c.js(ps, "localStorage.clear()")
            await to_page({"type": "overlay-show", "conn": True, "settings": {**base, "display": "panel"}})
            now = int(time.time() * 1000)
            for i, s in enumerate(subs[:4]):
                await to_page({"type": "sub", "kind": "final", "lang": "ru", "engine": "yandex-nmt",
                               "start": now + i * 5000, "end": now + i * 5000 + 4000, **s})
                await asyncio.sleep(0.25)
            await to_page({"type": "sub", "kind": "partial", "ru": "Давайте посмотрим на примеры", "en": "Let's look at the examples", "align": []})
            await asyncio.sleep(1.2)
            await c.shot(pt, ps, "raw-panel.png")

            # 2) word card: hover a Russian word in the history
            pos = await c.js(ps, """(() => { const h = document.querySelector('#ruen-live-subs');
              const w = [...h.shadowRoot.querySelectorAll('.rw')].find(e => e.textContent.startsWith('университет'));
              const r = w.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()""")
            await c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pos[0], "y": pos[1]}, ps)
            await asyncio.sleep(4)  # lookup goes to the local server
            await c.shot(pt, ps, "raw-wordcard.png")
            await c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 5, "y": 5}, ps)

            # 3) subtitles over the video
            await to_page({"type": "overlay-hide"})
            await asyncio.sleep(0.5)
            await to_page({"type": "overlay-show", "conn": True,
                           "settings": {**base, "display": "subtitles", "learn": False, "fontSize": 26}})
            await to_page({"type": "sub", "kind": "final", "lang": "ru", "engine": "yandex-nmt",
                           "start": now, "end": now + 3000, **subs[2]})
            await asyncio.sleep(1.5)
            await c.shot(pt, ps, "raw-subtitles.png")

            # 4) popup tabs
            await c.send("Emulation.setDeviceMetricsOverride", {"width": 316, "height": 640, "deviceScaleFactor": 2, "mobile": False}, xs)
            for tab in ("basic", "advanced", "extra"):
                await c.js(xs, f"document.querySelector('[data-tab={tab}]').click()")
                await asyncio.sleep(0.4)
                hgt = await c.js(xs, "document.documentElement.scrollHeight")
                await c.shot(xt, xs, f"raw-popup-{tab}.png", {"x": 0, "y": 0, "width": 316, "height": hgt})
    finally:
        chrome.terminate()
        chrome.wait()
        srv.shutdown()
        print("temp folder (move to trash when done):", tmp)


if __name__ == "__main__":
    asyncio.run(main(json.load(open(sys.argv[1], encoding="utf-8"))))
