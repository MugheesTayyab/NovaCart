"""Local evidence retrieval: BM25, then deterministic expansion.

Order: normalize -> synonyms -> BM25 top 6 -> topic registry -> regional and seller
rules -> cross-references (with cycle detection) -> competing rules -> file 00
interpretation rules. Six is where search starts, not a cap: every required
exception, override and dependency stays in.
"""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, field

from .facts import Facts
from .policies import registry
from .policies.bm25 import tokenize
from .policies.loader import Section
from .policies.store import PolicyStore

BM25_TOP_K = 6
FILE_REF_TOP_K = 3  # a reference to a whole file brings in its most relevant items
SECTION_REF_MAX = 3  # a reference to a larger section brings in its best FILE_REF_TOP_K items


@dataclass
class Evidence:
    ids: list[str] = field(default_factory=list)  # full section ids, deduplicated
    why: dict[str, str] = field(default_factory=dict)  # id -> how it was found
    topics: list[str] = field(default_factory=list)
    search_hits: list[str] = field(default_factory=list)


def normalize(text: str) -> str:
    """Lower-case and tidy spacing and punctuation. Codes, numbers, currency, dates and
    place names keep their characters (only case changes; codes are matched upper-case
    elsewhere)."""
    t = text.replace("’", "'").replace("‘", "'")
    t = re.sub(r"[^\w\s.,'&/%:+-]", " ", t)
    t = re.sub(r"(?<![\d])[.,](?![\d])", " ", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def expand_synonyms(norm: str) -> str:
    extra = [target for phrase, target in registry.SYNONYMS.items() if re.search(r"\b" + re.escape(phrase) + r"\b", norm)]
    return norm + (" " + " ".join(extra) if extra else "")


def _matches(text: str, keyword: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(keyword) + r"(?![a-z0-9])", text) is not None


class Retriever:
    def __init__(self, store: PolicyStore, cache_size: int):
        self.store = store
        self.cache_size = cache_size
        self._cache: OrderedDict[tuple, Evidence] = OrderedDict()
        self._lock = threading.Lock()

    def retrieve(self, question: str, facts: Facts) -> tuple[Evidence, bool]:
        norm = normalize(question)
        key = (norm, facts.key(), facts.contact_date, self.store.corpus_hash)
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None:
                self._cache.move_to_end(key)
                return hit, True
        ev = self._retrieve(norm, facts)
        if self.cache_size:
            with self._lock:
                self._cache[key] = ev
                if len(self._cache) > self.cache_size:
                    self._cache.popitem(last=False)
        return ev, False

    def _retrieve(self, norm: str, facts: Facts) -> Evidence:
        st = self.store
        ev = Evidence()
        # "cash on delivery fee" is a COD question, not a delivery-fee question.
        query_text = expand_synonyms(re.sub(r"cash on delivery", "cod", norm))
        query = tokenize(query_text)

        def add(sections: list[Section], why: str) -> None:
            for s in sections:
                if s.id not in ev.why:
                    ev.ids.append(s.id)
                    ev.why[s.id] = why

        # 1. BM25.
        for idx, _score in st.bm25.top(query, BM25_TOP_K) if st.bm25 else []:
            s = st.sections[idx]
            ev.search_hits.append(s.id)
            add([s], "search")

        # 2. Topics named by the question (keywords include the synonym expansion).
        for name, topic in registry.TOPICS.items():
            if any(_matches(query_text, k) for k in topic["keywords"]):
                ev.topics.append(name)
                for ref in topic["sections"]:
                    add(st.expand(ref), f"topic {name}")

        # 3. Regional overrides and seller rules that the known facts make relevant.
        if facts.region in registry.REGIONAL:
            for ref in registry.REGIONAL[facts.region]:
                add(st.expand(ref), f"region {facts.region}")
            add(self._best_in_file(registry.REGIONAL_FILES[facts.region], query), f"region {facts.region}")
        if facts.seller in registry.SELLER:
            for ref in registry.SELLER[facts.seller]:
                add(st.expand(ref), f"seller {facts.seller}")

        # 4. Cross-references from the search hits (the rules the question matched), one
        # level, no cycles. A reference to a whole file, or to a section with many items,
        # brings in that target's best-matching items. References into another region's
        # addendum are skipped once the customer's region is known.
        other_regions = {f for r, f in registry.REGIONAL_FILES.items() if facts.region and r != facts.region}
        seen = set(ev.ids)
        for sid in list(ev.search_hits):
            s = st.by_id[sid]
            for file_num, sec in s.refs:
                if file_num in other_regions:
                    continue
                targets = st.expand(f"{file_num}#{sec}") if sec else []
                if not sec or len(targets) > SECTION_REF_MAX:
                    targets = self._best(targets or st.expand(f"{file_num}#*"), query)
                for t in targets:
                    if t.id not in seen:
                        seen.add(t.id)
                        add([t], f"referenced by {s.short}")

        # 5. Competing rules for the same thing: bring every version, precedence picks.
        # A regional version for a region the customer is known not to be in is left out.
        present = {st.by_id[i].short for i in ev.ids}
        for group in registry.COMPETING:
            if present & set(group["items"]):
                for ref in group["items"]:
                    if ref[:2] in other_regions:
                        continue
                    add(st.expand(ref), f"competing rule: {group['topic']}")

        # 6. File 00 interpretation rules the known facts call for.
        needs = ["always"]
        if facts.amounts or facts.items:
            needs.append("money")
        if facts.delivery_date or facts.order_date:
            needs.append("dates")
        if facts.region:
            needs.append(facts.region)
        elif re.search(r"(city|region|area|country|deliver(ed|y)? to|live in)", norm):
            needs.append("place_unknown")
        if facts.category:
            needs.append("category")
        if facts.seller or "seller" in norm or "marketplace" in norm:
            needs.append("seller")
        if facts.promo_codes:
            needs.append("promo")
        if re.search(r"(shipping|total|checkout|freeship|payable)", query_text):
            needs.append("checkout")
        for need in needs:
            for ref in registry.INTERPRETATION[need]:
                add(st.expand(ref), "file 00 interpretation")
        return ev

    def _best_in_file(self, file_num: str, query: list[str]) -> list[Section]:
        doc = self.store.docs.get(file_num)
        return self._best(list(doc.sections), query) if doc else []

    def _best(self, candidates: list[Section], query: list[str]) -> list[Section]:
        if not candidates or not self.store.bm25:
            return []
        scores = self.store.bm25.scores(query)
        ranked = sorted(candidates, key=lambda s: -scores[self.store.position[s.id]])
        return [s for s in ranked[:FILE_REF_TOP_K] if scores[self.store.position[s.id]] > 0]

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
