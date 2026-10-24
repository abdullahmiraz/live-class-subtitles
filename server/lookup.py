"""Word lookup for the learning hover card: dictionary form + grammar (pymorphy3, offline, fast)
and the meaning of the dictionary form (online translator, cached)."""
from functools import lru_cache

POS = {
    "NOUN": "noun", "ADJF": "adjective", "ADJS": "short adjective", "COMP": "comparative", "VERB": "verb",
    "INFN": "infinitive", "PRTF": "participle", "PRTS": "short participle", "GRND": "gerund", "NUMR": "numeral",
    "ADVB": "adverb", "NPRO": "pronoun", "PRED": "predicative", "PREP": "preposition", "CONJ": "conjunction",
    "PRCL": "particle", "INTJ": "interjection",
}
CASE = {
    "nomn": "nominative", "gent": "genitive", "datv": "dative", "accs": "accusative", "ablt": "instrumental",
    "loct": "prepositional", "voct": "vocative", "gen2": "partitive", "acc2": "accusative", "loc2": "locative",
}
GENDER = {"masc": "masculine", "femn": "feminine", "neut": "neuter"}
NUMBER = {"sing": "singular", "plur": "plural"}
TENSE = {"pres": "present", "past": "past", "futr": "future"}
ASPECT = {"perf": "perfective", "impf": "imperfective"}
PERSON = {"1per": "1st person", "2per": "2nd person", "3per": "3rd person"}

_morph = None


def morph():
    global _morph
    if _morph is None:
        import pymorphy3  # loaded on first lookup (0.1 s, ~35 MB)
        _morph = pymorphy3.MorphAnalyzer(lang="ru")
    return _morph


def analyze(word: str) -> dict:
    """Offline part: {"word", "lemma", "pos", "grammar"} for one Russian word."""
    word = word.strip().strip(".,!?;:«»\"'()—-").lower()
    if not word or not any("а" <= c <= "я" or c == "ё" for c in word):
        return {"word": word, "lemma": word, "pos": "", "grammar": ""}
    p = morph().parse(word)[0]
    t = p.tag
    parts = [POS.get(t.POS, "")]
    for value, names in ((t.aspect, ASPECT), (t.tense, TENSE), (t.person, PERSON), (t.gender, GENDER),
                         (t.case, CASE), (t.number, NUMBER)):
        if value in names:
            parts.append(names[value])
    return {"word": word, "lemma": p.normal_form, "pos": POS.get(t.POS, ""), "grammar": " · ".join(x for x in parts if x)}


@lru_cache(maxsize=4096)
def meaning(lemma: str, tl: str = "en") -> str:
    """Online part: translation of the dictionary form into the subtitle language (cached)."""
    from translate import translate_chain
    out, _ = translate_chain("auto", lemma, tl)
    return out


def lookup(word: str, tl: str = "en") -> dict:
    info = analyze(word)
    try:
        info["meaning"] = meaning(info["lemma"], tl) if info["lemma"] else ""
    except Exception:
        info["meaning"] = ""
    return info


def lemmas(text: str) -> list:
    """[[start, length, lemma], ...] for every Russian word in `text` (offline; for "color only new words")."""
    import re
    out = []
    for m in re.finditer(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*", text):
        out.append([m.start(), len(m.group()), morph().parse(m.group().lower())[0].normal_form])
    return out
