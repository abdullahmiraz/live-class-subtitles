"""End-to-end test of the real extension in headless Chrome (no window), without a user gesture:
microphone mode + Chrome's fake microphone playing a Russian wav → offscreen capture → local server →
translation → overlay on a page → auto-saved transcript + MP3.

  uv run --no-project --with websockets python extension/tests/e2e_headless.py <16k-russian.wav> [ws://127.0.0.1:8765] [target] ['{"display":"subtitles",…}']

Tab capture itself can't be tested this way (Chrome requires a real click or shortcut).
"""
import asyncio
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

ROOT = Path(__file__).resolve().parents[2]
PORT, PAGE_PORT = 9336, 8812


async def main(wav, server, target, extra):
    tmp = Path(tempfile.mkdtemp(prefix="ruen-e2e-"))
    ext = tmp / "ext"
    shutil.copytree(ROOT / "extension", ext, ignore=shutil.ignore_patterns("tests"))
    m = json.loads((ext / "manifest.json").read_text())
    m["host_permissions"] = [f"http://127.0.0.1:{PAGE_PORT}/*"]  # stands in for the activeTab grant a click gives
    (ext / "manifest.json").write_text(json.dumps(m))
    (tmp / "page.html").write_text("<!doctype html><title>class</title><body style='background:#222;height:100vh'>")
    downloads = tmp / "downloads"
    downloads.mkdir()

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(tmp), **k)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PAGE_PORT), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    chrome = subprocess.Popen([
        "google-chrome", "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={tmp / 'profile'}",
        "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        f"--use-file-for-fake-audio-capture={Path(wav).resolve()}", "--autoplay-policy=no-user-gesture-required", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failures = []
    try:
        for _ in range(50):
            try:
                ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"))
                break
            except OSError:
                time.sleep(0.2)
        async with websockets.connect(ver["webSocketDebuggerUrl"], max_size=2**25) as ws:
            ids, errors = itertools.count(1), []

            async def send(method, params=None, session=None):
                i = next(ids)
                msg = {"id": i, "method": method, "params": params or {}}
                if session:
                    msg["sessionId"] = session
                await ws.send(json.dumps(msg))
                while True:
                    d = json.loads(await ws.recv())
                    if d.get("method") == "Runtime.exceptionThrown":
                        errors.append(d["params"]["exceptionDetails"].get("exception", {}).get("description", "?")[:300])
                    if d.get("id") == i:
                        if "error" in d:
                            raise RuntimeError(f"{method}: {d['error']}")
                        return d["result"]

            async def open_tab(url):
                t = (await send("Target.createTarget", {"url": url}))["targetId"]
                s = (await send("Target.attachToTarget", {"targetId": t, "flatten": True}))["sessionId"]
                await send("Runtime.enable", None, s)
                return t, s

            async def js(s, expr):
                r = await send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, s)
                return r["result"].get("value")

            await send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(downloads), "eventsEnabled": False})
            ext_id = (await send("Extensions.loadUnpacked", {"path": str(ext)}))["id"]
            await send("Browser.grantPermissions", {"origin": f"chrome-extension://{ext_id}", "permissions": ["audioCapture"]})
            _, ps = await open_tab(f"http://127.0.0.1:{PAGE_PORT}/page.html")
            _, xs = await open_tab(f"chrome-extension://{ext_id}/popup.html")
            await asyncio.sleep(1.5)
            settings = {"server": server, "audioSource": "mic", "target": target, "learn": True, "display": "panel",
                        "saveMode": "auto", "saveTranscript": True, "saveAudio": True, "audioFormat": "mp3", "saveFormat": "md", **extra}
            await js(xs, f"chrome.storage.sync.set({json.dumps(settings)})")
            tab_id = await js(xs, f"chrome.tabs.query({{url: 'http://127.0.0.1:{PAGE_PORT}/*'}}).then(([t]) => t.id)")
            res = await js(xs, f"chrome.runtime.sendMessage({{target: 'background', type: 'start', tabId: {tab_id}}})")
            print("start:", res)
            await asyncio.sleep(30)
            caption = await js(ps, """(() => { const c = document.querySelector('#ruen-live-captions');
              return c ? c.shadowRoot.querySelector('.wrap').innerText : null; })()""")
            print("subtitle-mode caption:", caption)
            state = await js(ps, """(() => { const h = document.querySelector('#ruen-live-subs'); if (!h) return null;
              const r = h.shadowRoot; return { status: r.querySelector('.st').textContent,
                items: [...r.querySelectorAll('.item')].map(i => [i.querySelector('.en').textContent, i.querySelector('.ru').textContent,
                  i.querySelectorAll('.en .w').length]) }; })()""")
            print("overlay:", json.dumps(state, ensure_ascii=False, indent=1))
            await js(xs, "chrome.runtime.sendMessage({target: 'background', type: 'stop'})")
            await asyncio.sleep(4)
            # headless Chrome names CDP-managed downloads by GUID; the extension's own names are checked in the transcript
            saved = [p for p in downloads.rglob("*") if p.is_file()]
            def kind(p):  # GUID names may lack an extension (e.g. .srt): tell by content
                head = p.read_bytes()[:64]
                if p.suffix in (".mp3", ".webm") or head[:3] == b"ID3" or head[:4] == b"\x1aE\xdf\xa3":
                    return p.suffix or ".audio"
                return p.suffix or ("." + settings["saveFormat"])
            files = sorted(f"{kind(p)} ({p.stat().st_size} B)" for p in saved)
            print("saved files:", files)
            for p in saved:
                if kind(p) in (".md", ".srt", ".txt", ".json"):
                    print(p.read_text()[:700])
            if not state or not state["items"]:
                failures.append("no subtitles in the overlay")
            elif "live" not in state["status"]:
                failures.append(f"status: {state['status']}")
            want_t, want_a = "." + settings["saveFormat"], "." + settings["audioFormat"]
            if settings["saveTranscript"] and not any(f.startswith(want_t) for f in files):
                failures.append(f"no {want_t} transcript saved")
            if settings["saveAudio"] and not any(f.startswith(want_a) and int(f.split("(")[1].split()[0]) > 20000 for f in files):
                failures.append(f"no {want_a} audio saved")
            if settings.get("display") == "subtitles" and not caption:
                failures.append("no caption in subtitle mode")
            if errors:
                failures.append(f"page errors: {errors}")
    finally:
        chrome.terminate()
        chrome.wait()
        srv.shutdown()
        print("temp folder (move to trash when done):", tmp)
    print("FAIL: " + "; ".join(failures) if failures else "PASS")
    return not failures


if __name__ == "__main__":
    ok = asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8765",
                          sys.argv[3] if len(sys.argv) > 3 else "en", json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}))
    sys.exit(0 if ok else 1)
