"""Reads the policy Markdown files and splits them into numbered items.

File format (organizer README): front matter between two `---` lines with doc_id,
title, version, effective_date, last_updated and scope; `## N. Heading` sections;
items that start with `**N.M**`. A table or list belongs to the item that introduces
it, so an item is never split from its table, conditions or exceptions.

Text that no numbered item owns (blockquotes, HTML comments, loose paragraphs) is
not policy text. It is kept out of the index and only counted in the logs.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

log = logging.getLogger("policies.loader")

META_FIELDS = ("doc_id", "title", "version", "effective_date", "last_updated", "scope")
SCOPES = ("general", "specific", "regional")
CROSS_REF = re.compile(r"\[file (\d{2})(?:, Section ([\d.]+))?\]")
FILE_RE = re.compile(r"^(\d{2})_[a-z0-9_]+\.md$")

# Lines that address an AI system instead of stating a store rule. Policy text is data;
# a line like this is dropped from the evidence and logged, never passed to the model.
INSTRUCTION_LIKE = re.compile(
    r"(?i)(\b(instructions?|notes?) for (ai |customer[- ]service )?(assistants?|bots?|chatbots?)\b"
    r"|\bignore (all |any )?(previous|prior|above) instructions\b"
    r"|\bsystem (prompt|override)\b"
    r"|\b(ai|language model|assistant)s?\b.{0,40}\b(must|should|always|never)\b)"
)


@dataclass
class Section:
    """One numbered item, the unit of retrieval and citation."""

    id: str  # "06_shipping_fees_and_free_shipping.md#2.2"
    file_num: str  # "06"
    filename: str
    doc_title: str
    heading_num: str  # "2"
    heading: str  # "How the fees are applied"
    num: str  # "2.2"
    text: str  # item text with its tables and lists, as Markdown
    refs: list[tuple[str, str | None]] = field(default_factory=list)  # (file_num, section or None)

    @property
    def short(self) -> str:
        return f"{self.file_num}#{self.num}"


@dataclass
class Document:
    file_num: str
    filename: str
    meta: dict  # values may be None when missing or malformed
    sections: list[Section]
    unattached_lines: int

    @property
    def effective(self) -> date | None:
        return _parse_date(self.meta.get("effective_date"))

    @property
    def scope(self) -> str | None:
        return self.meta.get("scope")

    @property
    def title(self) -> str:
        return self.meta.get("title") or self.filename


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _parse_meta(raw: str, filename: str) -> tuple[dict, str]:
    meta: dict = {k: None for k in META_FIELDS}
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", raw, re.S)
    body = raw
    if m:
        body = raw[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip()
                if key in meta:
                    meta[key] = value.strip() or None
    else:
        # Fallback: a Markdown metadata table "| field | value |".
        for key, value in re.findall(r"^\|\s*(\w+)\s*\|\s*([^|]+?)\s*\|", raw, re.M):
            if key in meta:
                meta[key] = value.strip() or None

    for key in META_FIELDS:
        if meta[key] is None:
            log.warning("policy_meta_missing", extra={"file": filename, "field": key})
    for key in ("effective_date", "last_updated"):
        if meta[key] and _parse_date(meta[key]) is None:
            log.warning("policy_meta_malformed", extra={"file": filename, "field": key})
            meta[key] = None
    if meta["scope"] and meta["scope"] not in SCOPES:
        log.warning("policy_meta_malformed", extra={"file": filename, "field": "scope"})
        meta["scope"] = None
    return meta, body


def parse_file(path: Path) -> Document:
    raw = path.read_text(encoding="utf-8")
    filename = path.name
    file_num = filename[:2]
    meta, body = _parse_meta(raw, filename)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)

    sections: list[Section] = []
    heading_num, heading = "", ""
    current: list[str] | None = None
    current_num = ""
    item_open = False
    unattached = 0
    filtered = 0

    def close():
        nonlocal current
        if current is not None:
            text = "\n".join(current).strip()
            refs = [(f, s) for f, s in CROSS_REF.findall(text)]
            sections.append(
                Section(
                    id=f"{filename}#{current_num}",
                    file_num=file_num,
                    filename=filename,
                    doc_title=meta.get("title") or filename,
                    heading_num=heading_num,
                    heading=heading,
                    num=current_num,
                    text=text,
                    refs=[(f, s or None) for f, s in refs],
                )
            )
        current = None

    for line in body.splitlines():
        t = line.strip()
        if not t:
            if current is not None:
                current.append("")
            continue
        if t.startswith("# "):
            continue
        h2 = re.match(r"^##\s+(\d+)\.\s+(.*)$", t)
        if h2:
            close()
            heading_num, heading = h2.group(1), h2.group(2)
            item_open = False
            continue
        item = re.match(r"^\*\*(\d+\.\d+)\*\*\s*(.*)$", t)
        if item and heading_num:
            close()
            first = item.group(2)
            if INSTRUCTION_LIKE.search(first):
                filtered += 1
                first = ""
            current_num = item.group(1)
            current = [first]
            item_open = True
            continue
        if item_open and current is not None and (t.startswith("|") or re.match(r"^(\d+\.|-)\s+", t)):
            if INSTRUCTION_LIKE.search(t):
                filtered += 1
                continue
            current.append(t)
            continue
        # A loose paragraph ends the item; it is not part of any numbered rule.
        item_open = False
        if heading_num:
            unattached += 1
    close()

    if unattached:
        log.info("policy_unattached_text_skipped", extra={"file": filename, "lines": unattached})
    if filtered:
        log.warning("policy_instruction_like_text_dropped", extra={"file": filename, "lines": filtered})
    return Document(file_num=file_num, filename=filename, meta=meta, sections=sections, unattached_lines=unattached)


def policy_files(policy_dir: Path) -> list[Path]:
    if not policy_dir.is_dir():
        return []
    return sorted(p for p in policy_dir.iterdir() if p.is_file() and FILE_RE.match(p.name))


def corpus_hash(files: list[Path]) -> str:
    h = hashlib.sha256()
    for p in files:
        h.update(p.name.encode())
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:16]


def document_to_dict(doc: Document) -> dict:
    return {
        "file_num": doc.file_num,
        "filename": doc.filename,
        "meta": doc.meta,
        "unattached_lines": doc.unattached_lines,
        "sections": [asdict(s) for s in doc.sections],
    }


def document_from_dict(d: dict) -> Document:
    sections = [Section(**{**s, "refs": [tuple(r) for r in s["refs"]]}) for s in d["sections"]]
    return Document(
        file_num=d["file_num"],
        filename=d["filename"],
        meta=d["meta"],
        sections=sections,
        unattached_lines=d["unattached_lines"],
    )
