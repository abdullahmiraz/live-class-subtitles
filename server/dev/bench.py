"""Benchmark Russian ASR + ru->en translation on Google FLEURS (many speakers, human English references).

  .venv/bin/python dev/bench.py asr --models gigaam-rnnt --cond clean noisy phone quiet
  .venv/bin/python dev/bench.py mt  --engines google yandex yandex-nmt --n 150
Needs: uv pip install -r dev/requirements-dev.txt

FLEURS data expected in --data (default /tmp/rlt/fleurs): ru_ru.tsv, en_us.tsv, test/*.wav
"""
import argparse
import csv
import json
import random
import re
import sys
import time
from pathlib import Path

import jiwer
import numpy as np
import sacrebleu
import sherpa_onnx
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import MODELS, SAMPLE_RATE  # noqa: E402

RESULTS = Path(__file__).parent / "bench_results"


def load_fleurs(data):
    data = Path(data)
    en = {}
    for row in csv.reader(open(data / "en_us.tsv", encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        en.setdefault(row[0], row[2])
    items = []
    for row in csv.reader(open(data / "ru_ru.tsv", encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        items.append({"id": row[0], "wav": str(data / "test" / row[1]), "ru": row[2], "gender": row[6], "en": en.get(row[0])})
    return items


def norm_ru(s):
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------- ASR models ----------
def asr_factory(name, threads=8):
    d = lambda n: str(MODELS / n)
    if name == "gigaam-rnnt":
        p = "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16"
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=d(f"{p}/encoder.int8.onnx"), decoder=d(f"{p}/decoder.onnx"), joiner=d(f"{p}/joiner.onnx"),
            tokens=d(f"{p}/tokens.txt"), model_type="nemo_transducer", num_threads=threads)
    if name == "vosk-stream":
        return ("stream", name)
    raise ValueError(name)


def run_stream(name, audio, threads=4):
    from engine import PartialASR
    r = PartialASR(threads)
    r.feed(audio)
    r.feed(np.zeros(int(0.5 * SAMPLE_RATE), dtype=np.float32))
    return r.rec.get_result(r.stream)


# ---------- degradations (closer to a real online class) ----------
def degrade(audio, cond, rng):
    if cond == "clean":
        return audio
    x = audio.copy()
    if cond in ("noisy", "room"):
        # small-room reverb: exponentially decaying noise impulse response
        n = int(0.35 * SAMPLE_RATE)
        ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.06 * SAMPLE_RATE))
        ir[0] = 4.0
        ir /= np.abs(ir).sum() / 4
        x = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[: len(x)]
    if cond in ("noisy",):
        # pink-ish background noise at 10 dB SNR
        white = rng.standard_normal(len(x))
        pink = np.fft.irfft(np.fft.rfft(white) / np.sqrt(np.arange(1, len(white) // 2 + 2)), len(white))
        sig = np.sqrt(np.mean(x ** 2)) + 1e-9
        pink *= sig / (np.sqrt(np.mean(pink ** 2)) + 1e-9) / (10 ** (10 / 20))
        x = x + pink
    if cond == "quiet":
        x = x * 0.05
    if cond == "phone":  # narrowband call quality (Zoom on bad network)
        spec = np.fft.rfft(x)
        f = np.fft.rfftfreq(len(x), 1 / SAMPLE_RATE)
        spec[(f < 300) | (f > 3400)] = 0
        x = np.fft.irfft(spec, len(x))
    return np.clip(x, -1, 1).astype(np.float32)


def cmd_asr(a):
    items = load_fleurs(a.data)
    if a.n:
        items = random.Random(0).sample(items, a.n)
    RESULTS.mkdir(exist_ok=True)
    summary = {}
    for name in a.models:
        rec = asr_factory(name)
        for cond in a.cond:
            rng = np.random.default_rng(0)
            hyps, refs, t_proc, t_audio, rows = [], [], 0.0, 0.0, []
            for it in items:
                audio, sr = sf.read(it["wav"], dtype="float32")
                audio = degrade(audio, cond, rng)
                t = time.time()
                if isinstance(rec, tuple):
                    text = run_stream(name, audio)
                else:
                    s = rec.create_stream()
                    s.accept_waveform(SAMPLE_RATE, audio)
                    rec.decode_stream(s)
                    text = s.result.text
                t_proc += time.time() - t
                t_audio += len(audio) / SAMPLE_RATE
                hyps.append(norm_ru(text) or "<empty>")
                refs.append(norm_ru(it["ru"]))
                rows.append({**it, "hyp": text.strip()})
            wer = jiwer.wer(refs, hyps)
            cer = jiwer.cer(refs, hyps)
            by_g = {g: jiwer.wer([r for r, it in zip(refs, items) if it["gender"] == g],
                                 [h for h, it in zip(hyps, items) if it["gender"] == g]) for g in ("MALE", "FEMALE")}
            key = f"{name}/{cond}"
            summary[key] = {"wer": wer, "cer": cer, "wer_male": by_g["MALE"], "wer_female": by_g["FEMALE"], "rtf": t_proc / t_audio, "n": len(items)}
            print(f"{key:24} WER {wer*100:5.2f}%  CER {cer*100:5.2f}%  (male {by_g['MALE']*100:.1f} / female {by_g['FEMALE']*100:.1f})  RTF {t_proc/t_audio:.3f}", flush=True)
            json.dump(rows, open(RESULTS / f"asr_{name}_{cond}.json", "w"), ensure_ascii=False, indent=1)
    json.dump(summary, open(RESULTS / f"asr_summary_{int(time.time())}.json", "w"), indent=1)


def cmd_mt(a):
    from translate import ENGINES
    items = load_fleurs(a.data)
    uniq = {}
    for it in items:
        uniq.setdefault(it["id"], it)
    sents = random.Random(1).sample(sorted(uniq.values(), key=lambda x: x["id"]), min(a.n, len(uniq)))
    asr_hyp = {}
    if a.asr_json:
        for r in json.load(open(a.asr_json)):
            asr_hyp.setdefault(r["id"], r["hyp"])
    refs = [s["en"] for s in sents]
    for name in a.engines:
        eng = ENGINES[name]
        for src_kind in (["ref"] + (["asr"] if asr_hyp else [])):
            outs, t0, fails = [], time.time(), 0
            for s in sents:
                src = s["ru"] if src_kind == "ref" else asr_hyp.get(s["id"], s["ru"])
                try:
                    outs.append(eng(src))
                except Exception as e:
                    fails += 1
                    outs.append("")
                time.sleep(0.05)
            dt = (time.time() - t0) / len(sents)
            chrf = sacrebleu.corpus_chrf(outs, [refs]).score
            bleu = sacrebleu.corpus_bleu(outs, [refs]).score
            print(f"{name:11} src={src_kind:3}  chrF {chrf:5.1f}  BLEU {bleu:5.1f}  {dt:5.2f}s/sent  fails {fails}", flush=True)
            json.dump([{"ru": s["ru"], "ref": s["en"], "out": o} for s, o in zip(sents, outs)],
                      open(RESULTS / f"mt_{name}_{src_kind}.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/tmp/rlt/fleurs")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("asr")
    p.add_argument("--models", nargs="+", default=["gigaam-rnnt"])
    p.add_argument("--cond", nargs="+", default=["clean"])
    p.add_argument("--n", type=int, default=0)
    p = sub.add_parser("mt")
    p.add_argument("--engines", nargs="+", default=["google", "yandex", "yandex-nmt"])
    p.add_argument("--n", type=int, default=150)
    p.add_argument("--asr-json")
    a = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    {"asr": cmd_asr, "mt": cmd_mt}[a.cmd](a)
