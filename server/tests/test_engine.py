"""Fast tests: no models, no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from engine import looks_english  # noqa: E402


@pytest.mark.parametrize("text,expected", [
    # English speech as GigaAM actually writes it (real example from a class)
    ("This Reserches the potencial the overtiran conventional Hyprofeces.", True),
    ("Okay, any questions?", True),
    # Russian, including sentences with English terms: must stay Russian
    ("Она обладает способностью лаконично объяснять сложные теории.", False),
    ("Сегодня мы обсудим machine learning и deep learning, а также нейронные сети.", False),
    ("Для этого используем Python и библиотеку NumPy.", False),
    ("Откройте файл main.py и запустите pip install numpy.", False),
    # too short to judge -> treated as Russian
    ("Окей.", False),
    ("Ок", False),
    ("OK", False),
    ("", False),
    # decoder glitches must not count as English
    ("<unk><unk><unk><unk><unk><unk>", False),
    ("<unk><unk>Привет, как дела<unk>", False),
])
def test_looks_english(text, expected):
    assert looks_english(text) is expected
