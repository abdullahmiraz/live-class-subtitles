"""translate_chain fallback logic, with the online engines replaced by fakes (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import translate  # noqa: E402


@pytest.fixture
def fake_engines(monkeypatch):
    calls = []

    def ok(name):
        def f(text):
            calls.append(name)
            return f"{name}:{text}"
        return f

    def broken(text):
        calls.append("google")
        raise RuntimeError("HTTP 429")

    monkeypatch.setattr(translate, "ENGINES", {"google": broken, "yandex": ok("yandex"), "yandex-nmt": ok("yandex-nmt")})
    monkeypatch.setattr(translate, "_down_until", {})
    return calls


def test_ranked_order_and_fallback(fake_engines, monkeypatch):
    monkeypatch.setattr(translate, "RANKED", ["google", "yandex", "yandex-nmt"])
    out, used = translate.translate_chain("auto", "привет")
    assert (out, used) == ("yandex:привет", "yandex")
    assert fake_engines == ["google", "yandex"]


def test_failed_engine_is_skipped_during_cooldown(fake_engines, monkeypatch):
    monkeypatch.setattr(translate, "RANKED", ["google", "yandex", "yandex-nmt"])
    translate.translate_chain("auto", "a")
    fake_engines.clear()
    translate.translate_chain("auto", "b")
    assert fake_engines == ["yandex"]  # google not retried within COOLDOWN


def test_preferred_engine_first(fake_engines):
    out, used = translate.translate_chain("yandex-nmt", "x")
    assert used == "yandex-nmt"


def test_empty_text(fake_engines):
    assert translate.translate_chain("auto", "   ") == ("", "none")
    assert fake_engines == []


def test_default_order_is_owners_choice():
    assert translate.RANKED == ["yandex-nmt", "google", "yandex"]  # Yandex classic first (owner's preference)
