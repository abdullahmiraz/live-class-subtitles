"""Local live-translation server.

Clients (the Chrome extension, or dev/test_client.py) connect to
ws://127.0.0.1:8765/<label>?engine=<auto|yandex-nmt|google|yandex>&hide_en=<0|1>&learn=<0|1>
and stream 16 kHz mono Int16 PCM (binary frames). Text frame "flush" = finish the sentence in progress;
the server answers {"type": "done"} once every pending sentence has been sent. Server -> client JSON:
  {"type": "partial", "ru": "...", "en": "...", "align": [...]}   rough live text while someone is speaking
  {"type": "final", "ru": "...", "en": "...", "lang": "ru|en", "start": 12.3, "end": 15.8,
   "engine": "yandex-nmt|google|yandex|whisper", "align": [[ru_start, ru_len, en_start, en_len], ...]}
Nothing is written to disk unless started with --save-transcripts (saving is the extension's job, opt-in).

Speech recognition is local (GigaAM-v3, light on CPU). Sentences spoken in English (detected by a
free text check: GigaAM writes them in Latin letters) are written down with Whisper-tiny instead of
being translated, or hidden if the client asks with ?hide_en=1. Translation is online only, default
order Yandex classic -> Google -> Yandex (LLM) (owner's choice). Live partial text is translated at most once
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
from translate import translate_chain, yandex_aligned

VAD_WINDOW = 512  # samples, required by Silero VAD at 16 kHz
PARTIAL_EVERY = 0.35  # seconds between partial updates
MAX_GAIN = 8.0
TRANSCRIPTS = Path(__file__).parent / "transcripts"
SAVE_TRANSCRIPTS = False  # set by --save-transcripts; normal saving is done by the extension (user's choice)
PARTIAL_TRANSLATE_EVERY = 1.5  # seconds between online translations of live text

final_asr: FinalASR
english_asr: EnglishASR
pool = ThreadPoolExecutor(max_workers=2)  # translation
asr_pool = ThreadPoolExecutor(max_workers=1)  # all speech recognition runs on ONE thread (sherpa-onnx is not safe to mix across threads)
class Session:
    def __init__(self, ws, label, chain, hide_en=False, learn=False):
        self.ws, self.chain, self.hide_en, self.learn = ws, chain, hide_en, learn
        self.vad = self.partial = None  # created on asr_pool in init()
        self.buf = np.zeros(0, dtype=np.float32)
        self.speaking = False
        self.peak = 0.1
        self.preroll = deque(maxlen=int(0.6 * SAMPLE_RATE / VAD_WINDOW))
        self.last_partial = 0.0
        self.last_partial_ru = ""
        self.partial_en = ""
        self.partial_align, self.partial_src = [], ""
        self.last_partial_tr = 0.0
        self.partial_task = None
        self.gen = 0  # bumps when a sentence ends, so late partial translations are dropped
        self.finals = asyncio.Queue()
        self.worker = None
        self.log = None
        if SAVE_TRANSCRIPTS:  # off unless the server was started with --save-transcripts
            TRANSCRIPTS.mkdir(exist_ok=True)
            now = datetime.now()
            self.log = TRANSCRIPTS / f"{now:%Y-%m-%d_%H-%M}_{label}.md"
            self.log.write_text(f"# Transcript {now:%Y-%m-%d %H:%M} ({label})\n\n", encoding="utf-8")

    async def init(self):
        # every sherpa-onnx object is created and used only on asr_pool (one thread)
        loop = asyncio.get_running_loop()
        self.vad, self.partial = await loop.run_in_executor(asr_pool, lambda: (make_vad(), PartialASR()))
        self.worker = asyncio.create_task(self.final_worker())

    def write_log(self, text):
        if self.log:
            with self.log.open("a", encoding="utf-8") as f:
                f.write(text)

    async def send(self, **msg):
        try:
            await self.ws.send(json.dumps(msg, ensure_ascii=False))
        except websockets.ConnectionClosed:
            pass

    # ---- runs on asr_pool: gain + VAD + live recognition for one chunk; returns events ----
    def _process(self, chunk):
        events = []
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
                events.append(("partial", self.partial.feed(win)))
            else:
                self.preroll.append(win)
            events += self._segments()
        return events

    def _segments(self):  # asr_pool
        out = []
        while not self.vad.empty():
            # copy BEFORE pop(): pop() frees the segment in C++, and reading it afterwards returned
            # random memory (the cause of the "<unk><unk>…" / "!!!!!!" / missing-sentence glitches)
            front = self.vad.front
            samples, start = np.array(front.samples, dtype=np.float32), front.start
            self.vad.pop()
            self.partial.reset()
            self.speaking = False
            out.append(("segment", samples, start / SAMPLE_RATE))
        return out

    def _flush(self):  # asr_pool: end the sentence in progress
        self.vad.flush()
        return self._segments()

    async def handle(self, events):
        for ev in events:
            if ev[0] == "segment":
                self.last_partial_ru, self.partial_en = "", ""
                self.gen += 1
                self.finals.put_nowait((ev[1], ev[2]))
        texts = [ev[1] for ev in events if ev[0] == "partial" and ev[1]]
        if not texts:
            return
        text, now = texts[-1], time.monotonic()
        if text != self.last_partial_ru and now - self.last_partial > PARTIAL_EVERY:
            self.last_partial, self.last_partial_ru = now, text
            if self.partial_en:  # show the newest Russian with the last translation (+ its colors)
                await self.send(type="partial", ru=text, en=self.partial_en,
                                align=self.partial_align if text.startswith(self.partial_src) else [])
            else:
                await self.send(type="partial", ru=text, en="")
            idle = self.partial_task is None or self.partial_task.done()
            if idle and now - self.last_partial_tr > PARTIAL_TRANSLATE_EVERY:
                self.last_partial_tr = now
                self.partial_task = asyncio.create_task(self.translate_partial(text, self.gen))

    async def on_audio(self, chunk: np.ndarray):
        await self.handle(await asyncio.get_running_loop().run_in_executor(asr_pool, self._process, chunk))

    async def flush(self):
        """Client asked to finish the current sentence (before saving / switching settings)."""
        await self.handle(await asyncio.get_running_loop().run_in_executor(asr_pool, self._flush))
        await self.finals.join()  # every pending sentence has been recognized, translated and sent
        await self.send(type="done")

    async def translate_partial(self, text, gen):
        loop = asyncio.get_running_loop()
        en, align = "", []
        if self.learn:  # learning mode: color the live line too (word alignment from Yandex classic)
            try:
                en, align = await loop.run_in_executor(pool, yandex_aligned, text)
            except Exception:
                pass
        if not en:
            align = []
            en, _ = await loop.run_in_executor(pool, translate_chain, self.chain, text)
        if gen == self.gen and en:
            self.partial_en, self.partial_align, self.partial_src = en, align, text
            await self.send(type="partial", ru=text, en=en, align=align)

    async def final_worker(self):
        """Accurate recognition + online translation, in order, without blocking the audio loop."""
        while True:
            samples, start = await self.finals.get()
            try:
                if samples is None:
                    return
                await self.final(samples, start)
            except Exception as e:
                print(f"[final] error: {e}", flush=True)
            finally:
                self.finals.task_done()

    async def final(self, samples, start):
        loop = asyncio.get_running_loop()
        ru = (await loop.run_in_executor(asr_pool, final_asr, samples)).replace("<unk>", "").strip()
        if not any(c.isalpha() for c in ru):  # silence / noise / decoder glitch
            print(f"[final] no words in a {len(samples) / SAMPLE_RATE:.1f}s segment at {start:.1f}s (skipped)", flush=True)
            await self.send(type="partial", ru="", en="")
            return
        stamp = f"{int(start // 3600):d}:{int(start % 3600 // 60):02d}:{int(start % 60):02d}"
        end = start + len(samples) / SAMPLE_RATE
        if looks_english(ru):
            # spoken in English: don't translate it, write down what was actually said
            if self.hide_en:
                await self.send(type="partial", ru="", en="")
                print(f"[{stamp}] (English sentence hidden)", flush=True)
                return
            en = await loop.run_in_executor(asr_pool, english_asr, samples)
            if sum(c.isalpha() for c in en) < 2:  # Whisper glitch (e.g. "!!!!!!"): don't show garbage
                print(f"[{stamp}] dropped unclear sentence [GigaAM heard: {ru[:80]}] [Whisper: {en[:40]}]", flush=True)
                await self.send(type="partial", ru="", en="")
                return
            await self.send(type="final", ru="", en=en, lang="en", start=round(start, 2), end=round(end, 2), engine="whisper")
            self.write_log(f"**[{stamp}]** {en}  \n<sub>(spoken in English)</sub>\n\n")
            print(f"[{stamp}] (English) {en}   [GigaAM heard: {ru[:80]}]", flush=True)
            return
        en, used, align = "", "", []
        if self.learn:  # learning mode: Yandex classic gives word alignment for the color matching
            try:
                en, align = await loop.run_in_executor(pool, yandex_aligned, ru)
                used = "yandex-nmt"
            except Exception as e:
                print(f"[translate] aligned yandex failed ({e}); normal translation", flush=True)
        if not en:
            align = []  # alignment only belongs to the text it came with
            en, used = await loop.run_in_executor(pool, translate_chain, self.chain, ru)
        await self.send(type="final", ru=ru, en=en, lang="ru", start=round(start, 2), end=round(end, 2), engine=used, align=align)
        self.write_log(f"**[{stamp}]** {en}  \n<sub>{ru}</sub>\n\n")
        print(f"[{stamp}] ({used}) {ru}\n          → {en}", flush=True)

    async def close(self):
        if self.partial_task:
            self.partial_task.cancel()
        if self.vad is not None:
            for _, samples, start in await asyncio.get_running_loop().run_in_executor(asr_pool, self._flush):
                self.finals.put_nowait((samples, start))
        if self.worker:
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
    learn = q.get("learn", ["0"])[0] == "1"
    print(f"client connected: {label} (engine={chain}, hide English={hide_en}, learning mode={learn})", flush=True)
    s = Session(ws, label, chain, hide_en, learn)
    try:
        await s.init()
        await s.send(type="ready")
        async for msg in ws:
            if isinstance(msg, bytes):
                await s.on_audio(np.frombuffer(msg, dtype=np.int16).astype(np.float32) / 32768.0)
            elif msg == "flush":
                await s.flush()
    except websockets.ConnectionClosed:
        pass
    finally:
        await s.close()
        print("client disconnected" + (f", server log: {s.log}" if s.log else ""), flush=True)


async def main():
    global final_asr, english_asr, SAVE_TRANSCRIPTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--threads", type=int, default=4, help="CPU threads for speech recognition")
    ap.add_argument("--save-transcripts", action="store_true", help="also keep a debug log of every session in server/transcripts/")
    a = ap.parse_args()
    SAVE_TRANSCRIPTS = a.save_transcripts
    t = time.time()
    final_asr = FinalASR(a.threads)
    english_asr = EnglishASR(a.threads)
    print(f"models loaded in {time.time() - t:.1f}s, listening on ws://{a.host}:{a.port}", flush=True)
    async with websockets.serve(handler, a.host, a.port, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
