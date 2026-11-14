"""The in-memory policy store: parsed documents, BM25 index, resolved references.

Built once at startup. The parsed corpus is cached in INDEX_CACHE_DIR under the
corpus hash, so a restart with unchanged files loads instead of re-parsing, and any
change to a policy file produces a new hash and a rebuild. Nothing here touches the
disk during a request.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from . import registry
from .bm25 import BM25, tokenize
from .loader import Document, Section, corpus_hash, document_from_dict, document_to_dict, parse_file, policy_files

log = logging.getLogger("policies.store")
CACHE_VERSION = 1


@dataclass
class PromoCode:
    code: str
    benefit: str
    eligible: str
    minimum: int | None
    maximum: int | None
    last_order_date: date | None
    source: str  # short id of the table's item


@dataclass
class PolicyStore:
    docs: dict[str, Document] = field(default_factory=dict)  # by file number
    sections: list[Section] = field(default_factory=list)
    by_id: dict[str, Section] = field(default_factory=dict)  # full and short ids
    bm25: BM25 | None = None
    corpus_hash: str = ""
    unresolved_refs: list[str] = field(default_factory=list)
    unknown_registry_ids: list[str] = field(default_factory=list)
    promo_codes: dict[str, PromoCode] = field(default_factory=dict)
    position: dict[str, int] = field(default_factory=dict)  # full id -> index in sections

    # ---------- build ----------

    @classmethod
    def build(cls, policy_dir: Path, cache_dir: Path) -> "PolicyStore":
        t0 = time.perf_counter()
        files = policy_files(policy_dir)
        store = cls()
        if not files:
            log.error("policies_missing", extra={"policy_dir": str(policy_dir)})
            return store
        store.corpus_hash = corpus_hash(files)
        cache_file = cache_dir / f"index-v{CACHE_VERSION}-{store.corpus_hash}.json"
        docs: list[Document] | None = None
        if cache_file.is_file():
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                docs = [document_from_dict(d) for d in data["docs"]]
                log.info("policy_index_loaded_from_cache", extra={"hash": store.corpus_hash})
            except Exception:
                log.warning("policy_index_cache_unreadable", exc_info=True)
                docs = None
        if docs is None:
            docs = [parse_file(p) for p in files]
            try:
                cache_dir.mkdir(parents=True, exist_ok=True)
                for old in cache_dir.glob("index-*.json"):
                    old.unlink(missing_ok=True)
                cache_file.write_text(json.dumps({"docs": [document_to_dict(d) for d in docs]}), encoding="utf-8")
            except OSError:
                log.warning("policy_index_cache_write_failed", exc_info=True)
            log.info("policy_index_built", extra={"hash": store.corpus_hash})

        for d in docs:
            store.docs[d.file_num] = d
            for s in d.sections:
                store.sections.append(s)
                store.by_id[s.id] = s
                store.by_id[s.short] = s
        store.position = {s.id: i for i, s in enumerate(store.sections)}
        store.bm25 = BM25([tokenize(f"{s.doc_title} {s.heading} {s.text}") for s in store.sections])
        store._check_refs()
        store._check_registry()
        store._load_promo_codes()
        log.info(
            "policy_store_ready",
            extra={
                "files": len(store.docs),
                "sections": len(store.sections),
                "hash": store.corpus_hash,
                "unresolved_refs": len(store.unresolved_refs),
                "ms": round((time.perf_counter() - t0) * 1000),
            },
        )
        return store

    # ---------- lookups ----------

    @property
    def ready(self) -> bool:
        return bool(self.sections) and self.bm25 is not None

    def expand(self, ref: str) -> list[Section]:
        """'06#2.2' -> that item; '06#2' -> every item in section 2; '06#*' -> the whole file."""
        file_num, _, part = ref.partition("#")
        doc = self.docs.get(file_num)
        if not doc:
            return []
        if part == "*":
            return list(doc.sections)
        if "." in part:
            s = self.by_id.get(ref)
            return [s] if s else []
        return [s for s in doc.sections if s.heading_num == part]

    def ref_targets(self, s: Section) -> list[Section]:
        out: list[Section] = []
        for file_num, sec in s.refs:
            out.extend(self.expand(f"{file_num}#{sec}" if sec else f"{file_num}#*"))
        return out

    # ---------- startup checks ----------

    def _check_refs(self) -> None:
        for s in self.sections:
            for file_num, sec in s.refs:
                ref = f"{file_num}#{sec}" if sec else f"{file_num}#*"
                if not self.expand(ref):
                    self.unresolved_refs.append(f"{s.short} -> {ref}")
        for r in self.unresolved_refs:
            log.warning("policy_cross_reference_unresolved", extra={"ref": r})

    def _check_registry(self) -> None:
        ids: list[str] = []
        for t in registry.TOPICS.values():
            ids += t["sections"]
        for g in registry.COMPETING:
            ids += g["items"]
        for lst in (*registry.REGIONAL.values(), *registry.SELLER.values(), *registry.INTERPRETATION.values()):
            ids += lst
        for ref in sorted(set(ids)):
            if not self.expand(ref):
                self.unknown_registry_ids.append(ref)
                log.warning("registry_id_not_in_policies", extra={"ref": ref})

    def _load_promo_codes(self) -> None:
        """Reads the code table from file 12 (the item whose table has a 'Code' column)."""
        doc = self.docs.get("12")
        if not doc:
            return
        for s in doc.sections:
            rows = [r for r in s.text.splitlines() if r.startswith("|")]
            if not rows or "code" not in rows[0].lower():
                continue
            head = [c.strip().lower() for c in rows[0].strip("|").split("|")]
            for row in rows[1:]:
                cells = [c.strip() for c in row.strip("|").split("|")]
                if len(cells) != len(head) or set(row) <= set("|-: "):
                    continue
                cell = dict(zip(head, cells))
                code = cell.get("code", "").upper()
                if not re.fullmatch(r"[A-Z0-9]{3,20}", code):
                    continue
                self.promo_codes[code] = PromoCode(
                    code=code,
                    benefit=cell.get("benefit", ""),
                    eligible=cell.get("eligible items", ""),
                    minimum=_rupees(cell.get("minimum eligible subtotal", "")),
                    maximum=_rupees(cell.get("maximum discount", "")),
                    last_order_date=_date(cell.get("last order date", "")),
                    source=s.short,
                )
        if not self.promo_codes:
            log.warning("promo_code_table_not_found")


def _rupees(text: str) -> int | None:
    m = re.search(r"Rs\.?\s*([\d,]+)", text)
    return int(m.group(1).replace(",", "")) if m else None


def _date(text: str) -> date | None:
    try:
        return date.fromisoformat(text.strip())
    except ValueError:
        return None
