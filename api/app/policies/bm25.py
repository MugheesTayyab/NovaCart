"""Okapi BM25 over the numbered policy items. Small, local, no dependencies."""

from __future__ import annotations

import math
import re
from collections import Counter

TOKEN = re.compile(r"[a-z0-9]+(?:[./-][a-z0-9]+)*")

# Very common words that carry no policy meaning.
STOPWORDS = frozenset(
    """a an the and or of to in on for is are be by with as at from that this it its
    if not no any all can will must may when which who what how do does i my me you your
    we our they their them was were has have had than then there these those into after
    before within per each other only also""".split()
)


def tokenize(text: str) -> list[str]:
    toks = TOKEN.findall(text.lower())
    out = []
    for t in toks:
        if t in STOPWORDS:
            continue
        out.append(t)
        # Light stemming so "returns"/"returned"/"returning" meet "return".
        for suf in ("ing", "ed", "es", "s"):
            if len(t) > 4 and t.endswith(suf) and not t[-len(suf) - 1].isdigit():
                out.append(t[: -len(suf)])
                break
    return out


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.4, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(d) for d in docs]
        self.lengths = [len(d) for d in docs]
        self.avg = sum(self.lengths) / max(1, len(self.lengths))
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: list[str]) -> list[float]:
        out = []
        for d, length in zip(self.docs, self.lengths):
            s = 0.0
            norm = self.k1 * (1 - self.b + self.b * length / self.avg)
            for t in query:
                tf = d.get(t)
                if tf:
                    s += self.idf.get(t, 0.0) * tf * (self.k1 + 1) / (tf + norm)
            out.append(s)
        return out

    def top(self, query: list[str], k: int) -> list[tuple[int, float]]:
        scored = [(i, s) for i, s in enumerate(self.scores(query)) if s > 0]
        scored.sort(key=lambda x: (-x[1], x[0]))
        return scored[:k]
