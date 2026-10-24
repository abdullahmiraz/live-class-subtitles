"""Stream a 16 kHz wav file to the server in real time and print what comes back."""
import asyncio
import json
import sys
import time

import numpy as np
import soundfile as sf
import websockets


async def main(path, url="ws://127.0.0.1:8765/test"):
    audio, sr = sf.read(path, dtype="int16")
    assert sr == 16000
    async with websockets.connect(url) as ws:
        t0 = time.monotonic()

        async def recv():
            async for m in ws:
                d = json.loads(m)
                if d["type"] in ("partial", "final"):
                    print(f"{time.monotonic() - t0:5.1f}s {d['type']:7} {d.get('en', '')}  |  {d.get('ru', '')}")

        r = asyncio.create_task(recv())
        step = 1600  # 100 ms
        for i in range(0, len(audio), step):
            await ws.send(audio[i:i + step].astype(np.int16).tobytes())
            await asyncio.sleep(0.1)
        await asyncio.sleep(1.0)
        await ws.close()
        await r


asyncio.run(main(sys.argv[1]))
