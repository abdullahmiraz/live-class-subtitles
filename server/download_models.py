"""Download the speech models the companion needs into server/models/ (~350 MB, once). Works on Windows,
macOS and Linux (standard library only). Skips models already present. Each model is unpacked into a
temporary folder and renamed only when complete, so an interrupted download never leaves a half model."""
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
MODELS = Path(os.environ.get("LCS_MODELS") or Path(__file__).resolve().parent / "models")
# name -> member suffixes to keep (None = everything)
ARCHIVES = {
    "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16": None,
    "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16": None,
    "sherpa-onnx-whisper-tiny": ("tiny-encoder.int8.onnx", "tiny-decoder.int8.onnx", "tiny-tokens.txt"),
}


def download(url, dest):
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
        total, done, last = int(r.headers.get("Content-Length") or 0), 0, -1
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            pct = done * 100 // total if total else -1
            if pct != last and pct % 5 == 0:
                print(f"\r  {dest.name}: {pct}%" if total else f"\r  {done >> 20} MB", end="", flush=True)
                last = pct
    print()


def fetch(name, keep):
    final = MODELS / name
    if final.is_dir():
        return
    print(f"Downloading {name} ...")
    part = MODELS / (name + ".part")
    shutil.rmtree(part, ignore_errors=True)  # leftover of an interrupted run (our own temp folder)
    part.mkdir(parents=True)
    archive = MODELS / (name + ".tar.bz2.part")
    try:
        download(f"{BASE}/{name}.tar.bz2", archive)
        with tarfile.open(archive, "r:bz2") as tar:
            for m in tar.getmembers():
                if not m.isfile() or (keep and not m.name.endswith(keep)):
                    continue
                rel = Path(*Path(m.name).parts[1:])  # strip the top folder
                if not rel.parts or ".." in rel.parts:
                    continue
                out = part / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(m) as src, open(out, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        part.rename(final)
    except Exception as e:
        shutil.rmtree(part, ignore_errors=True)
        sys.exit(f"Download of {name} failed ({e}). Check your internet connection and run the installer again.")
    finally:
        archive.unlink(missing_ok=True)


def main():
    MODELS.mkdir(exist_ok=True)
    only = sys.argv[1:]  # optional: names to fetch (tests)
    for name, keep in ARCHIVES.items():
        if not only or name in only:
            fetch(name, keep)
    vad = MODELS / "silero_vad.onnx"
    if not vad.exists():
        print("Downloading silero_vad.onnx ...")
        tmp = vad.with_suffix(".part")
        download(f"{BASE}/silero_vad.onnx", tmp)
        tmp.rename(vad)
    print("Speech models ready.")


if __name__ == "__main__":
    main()
