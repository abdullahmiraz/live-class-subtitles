"""Local Russian speech recognition: Silero VAD, GigaAM-v3 (accurate) and a streaming Zipformer (instant partials)."""
from pathlib import Path

import numpy as np
import sherpa_onnx

MODELS = Path(__file__).parent / "models"
GIGAAM = MODELS / "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16"
STREAMING = MODELS / "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16"
SAMPLE_RATE = 16000


def make_vad(min_silence=0.5, max_speech=12.0):
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = str(MODELS / "silero_vad.onnx")
    cfg.silero_vad.threshold = 0.3
    cfg.silero_vad.min_silence_duration = min_silence
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = max_speech
    cfg.sample_rate = SAMPLE_RATE
    return sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)


class FinalASR:
    """Accurate offline recognizer, run on each speech segment cut by the VAD."""

    def __init__(self, threads=8):
        self.rec = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(GIGAAM / "encoder.int8.onnx"),
            decoder=str(GIGAAM / "decoder.onnx"),
            joiner=str(GIGAAM / "joiner.onnx"),
            tokens=str(GIGAAM / "tokens.txt"),
            model_type="nemo_transducer",
            num_threads=threads,
        )

    def __call__(self, samples: np.ndarray) -> str:
        s = self.rec.create_stream()
        s.accept_waveform(SAMPLE_RATE, samples)
        self.rec.decode_stream(s)
        return s.result.text.strip()


class PartialASR:
    """Fast streaming recognizer for instant (rough) text while someone is speaking."""

    def __init__(self, threads=2):
        self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            encoder=str(STREAMING / "encoder.int8.onnx"),
            decoder=str(STREAMING / "decoder.onnx"),
            joiner=str(STREAMING / "joiner.int8.onnx"),
            tokens=str(STREAMING / "tokens.txt"),
            num_threads=threads,
            enable_endpoint_detection=False,
        )
        self.reset()

    def reset(self):
        self.stream = self.rec.create_stream()

    def feed(self, samples: np.ndarray) -> str:
        self.stream.accept_waveform(SAMPLE_RATE, samples)
        while self.rec.is_ready(self.stream):
            self.rec.decode_stream(self.stream)
        return self.rec.get_result(self.stream).strip()


WHISPER_TINY = MODELS / "sherpa-onnx-whisper-tiny"


def looks_english(text: str) -> bool:
    """GigaAM writes English speech in Latin letters. Mostly-Latin text = an English sentence;
    Russian sentences with a few English words ("обсудим machine learning") stay Russian."""
    letters = [c for c in text.replace("<unk>", "") if c.isalpha()]
    if len(letters) < 4:
        return False
    latin = sum(c.isascii() for c in letters)
    return latin / len(letters) > 0.5


class EnglishASR:
    """Whisper-tiny, used only for sentences that were spoken in English."""

    def __init__(self, threads=4):
        self.rec = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=str(WHISPER_TINY / "tiny-encoder.int8.onnx"),
            decoder=str(WHISPER_TINY / "tiny-decoder.int8.onnx"),
            tokens=str(WHISPER_TINY / "tiny-tokens.txt"),
            language="en",
            task="transcribe",
            num_threads=threads,
        )

    def __call__(self, samples: np.ndarray) -> str:
        s = self.rec.create_stream()
        s.accept_waveform(SAMPLE_RATE, samples)
        self.rec.decode_stream(s)
        return s.result.text.strip()
