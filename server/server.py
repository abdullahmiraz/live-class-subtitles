"""Local live-translation server.

Clients (the Chrome extension, or dev/test_client.py) connect to ws://127.0.0.1:8765/<label>?engine=<name>
and stream 16 kHz mono Int16 PCM. The server answers with JSON messages:
  {"type": "partial", "ru": "...", "en": "..."}   rough live text while someone is speaking
  {"type": "final",   "ru": "...", "en": "...", "start": 12.3, "end": 15.8, "engine": "google"}
Every session is also saved to transcripts/<date>_<label>.md.

Speech recognition is local (GigaAM-v3, light on CPU). Sentences spoken in English (detected by a
free text check: GigaAM writes them in Latin letters) are written down with Whisper-tiny instead of
being translated, or hidden if the client asks with ?hide_en=1. Translation is online only, ranked by
accuracy: Google -> Yandex (LLM) -> Yandex (classic). Live partial text is translated at most once
every PARTIAL_TRANSLATE_EVERY seconds, in the background, so the endpoints aren't spammed.
"""
import argparse
import asyncio
import json
import time
import urllib.parse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import numpy as np
import websockets

from engine import SAMPLE_RATE, EnglishASR, FinalASR, PartialASR, looks_english, make_vad
from translate import translate_chain

VAD_WINDOW = 512  # samples, required by Silero VAD at 16 kHz
PARTIAL_EVERY = 0.35  # seconds between partial updates
MAX_GAIN = 8.0
TRANSCRIPTS = Path(__file__).parent / "transcripts"
PARTIAL_TRANSLATE_EVERY = 1.5  # seconds between online translations of live text

final_asr: FinalASR
english_asr: EnglishASR
pool = ThreadPoolExecutor(max_workers=2)  # translation
asr_pool = ThreadPoolExecutor(max_workers=1)  # all speech recognition runs on ONE thread (sherpa-onnx is not safe to mix across threads)
class Session:
    def __init__(self, ws, label, chain, hide_en=False):
        self.ws, self.chain, self.hide_en = ws, chain, hide_en
        self.vad = make_vad()
        self.partial = PartialASR()
        self.buf = np.zeros(0, dtype=np.float32)
        self.speaking = False
        self.reset_partial = False
        self.peak = 0.1
        self.preroll = deque(maxlen=int(0.6 * SAMPLE_RATE / VAD_WINDOW))
        self.last_partial = 0.0
        self.last_partial_ru = ""
        self.partial_en = ""
        self.last_partial_tr = 0.0
        self.partial_task = None
        self.gen = 0  # bumps when a sentence ends, so late partial translations are dropped
        self.finals = asyncio.Queue()
        self.worker = asyncio.create_task(self.final_worker())
        TRANSCRIPTS.mkdir(exist_ok=True)
        now = datetime.now()
        self.log = TRANSCRIPTS / f"{now:%Y-%m-%d_%H-%M}_{label}.md"
        self.log.write_text(f"# Transcript {now:%Y-%m-%d %H:%M} ({label})\n\n", encoding="utf-8")

    async def send(self, **msg):
        try:
            await self.ws.send(json.dumps(msg, ensure_ascii=False))
        except websockets.ConnectionClosed:
            pass

    async def on_audio(self, chunk: np.ndarray):
        loop = asyncio.get_running_loop()
        self.buf = np.concatenate([self.buf, chunk])
        while len(self.buf) >= VAD_WINDOW:
            win, self.buf = self.buf[:VAD_WINDOW], self.buf[VAD_WINDOW:]
            # automatic gain: quiet tabs / low volume still get detected
            self.peak = max(self.peak * 0.9995, float(np.abs(win).max()), 1e-4)
            win = np.clip(win * min(MAX_GAIN, 0.7 / self.peak), -1.0, 1.0)
            self.vad.accept_waveform(win)
            if self.vad.is_speech_detected():
                if not self.speaking:  # speech just started: feed the audio just before it too
                    self.speaking = True
                    win = np.concatenate([*self.preroll, win])
                    self.preroll.clear()
                if self.reset_partial:
                    await loop.run_in_executor(asr_pool, self.partial.reset)
                    self.reset_partial = False
                text = await loop.run_in_executor(asr_pool, self.partial.feed, win)
                now = time.monotonic()
                if text and text != self.last_partial_ru and now - self.last_partial > PARTIAL_EVERY:
                    self.last_partial, self.last_partial_ru = now, text
                    await self.send(type="partial", ru=text, en=self.partial_en)
                    idle = self.partial_task is None or self.partial_task.done()
                    if idle and now - self.last_partial_tr > PARTIAL_TRANSLATE_EVERY:
                        self.last_partial_tr = now
                        self.partial_task = asyncio.create_task(self.translate_partial(text, self.gen))
            else:
                self.preroll.append(win)
            self.drain_vad()

    async def translate_partial(self, text, gen):
        en, _ = await asyncio.get_running_loop().run_in_executor(pool, translate_chain, self.chain, text)
        if gen == self.gen and en:
            self.partial_en = en
            await self.send(type="partial", ru=self.last_partial_ru, en=en)

    def drain_vad(self):
        while not self.vad.empty():
            seg = self.vad.front
            self.vad.pop()
            self.reset_partial = True
            self.speaking, self.last_partial_ru, self.partial_en = False, "", ""
            self.gen += 1
            self.finals.put_nowait((np.array(seg.samples, dtype=np.float32), seg.start / SAMPLE_RATE))

    async def final_worker(self):
        """Accurate recognition + online translation, in order, without blocking the audio loop."""
        loop = asyncio.get_running_loop()
        while True:
            samples, start = await self.finals.get()
            if samples is None:
                return
            try:
                ru = await loop.run_in_executor(asr_pool, final_asr, samples)
                if not ru:
                    await self.send(type="partial", ru="", en="")
                    continue
                stamp = f"{int(start // 3600):d}:{int(start % 3600 // 60):02d}:{int(start % 60):02d}"
                end = start + len(samples) / SAMPLE_RATE
                if looks_english(ru):
                    # spoken in English: don't translate it, write down what was actually said
                    if self.hide_en:
                        await self.send(type="partial", ru="", en="")
                        print(f"[{stamp}] (English sentence hidden)", flush=True)
                        continue
                    en = await loop.run_in_executor(asr_pool, english_asr, samples) or ru
                    await self.send(type="final", ru="", en=en, lang="en", start=round(start, 2), end=round(end, 2), engine="whisper")
                    with self.log.open("a", encoding="utf-8") as f:
                        f.write(f"**[{stamp}]** {en}  \n<sub>(spoken in English)</sub>\n\n")
                    print(f"[{stamp}] (English) {en}", flush=True)
                    continue
                en, used = await loop.run_in_executor(pool, translate_chain, self.chain, ru)
                await self.send(type="final", ru=ru, en=en, lang="ru", start=round(start, 2), end=round(end, 2), engine=used)
                with self.log.open("a", encoding="utf-8") as f:
                    f.write(f"**[{stamp}]** {en}  \n<sub>{ru}</sub>\n\n")
                print(f"[{stamp}] ({used}) {ru}\n          → {en}", flush=True)
            except Exception as e:
                print(f"[final] error: {e}", flush=True)

    async def close(self):
        self.vad.flush()
        self.drain_vad()
        self.finals.put_nowait((None, 0))
        await self.worker


async def handler(ws):
    url = urllib.parse.urlparse(ws.request.path if ws.request else "/")
    label = (url.path.strip("/") or "tab").replace("/", "_")[:40]
    if label == "ping":  # popup health check
        await ws.close()
        return
    q = urllib.parse.parse_qs(url.query)
    chain = q.get("engine", ["auto"])[0]
    hide_en = q.get("hide_en", ["0"])[0] == "1"
    print(f"client connected: {label} (engine={chain}, hide English={hide_en})", flush=True)
    s = Session(ws, label, chain, hide_en)
    await s.send(type="ready")
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                await s.on_audio(np.frombuffer(msg, dtype=np.int16).astype(np.float32) / 32768.0)
    except websockets.ConnectionClosed:
        pass
    finally:
        await s.close()
        print(f"client disconnected, transcript: {s.log}", flush=True)


async def main():
    global final_asr, english_asr
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--threads", type=int, default=4, help="CPU threads for speech recognition")
    a = ap.parse_args()
    t = time.time()
    final_asr = FinalASR(a.threads)
    english_asr = EnglishASR(a.threads)
    print(f"models loaded in {time.time() - t:.1f}s, listening on ws://{a.host}:{a.port}", flush=True)
    async with websockets.serve(handler, a.host, a.port, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
