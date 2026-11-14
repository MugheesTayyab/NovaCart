"""Which retrieved rules apply, decided in code from each file's metadata.

Implements file 00: Section 3.1 (a file applies from its effective_date), 4.1
(regional files override for their region and topics), 4.2 (same scope: later date
wins and the customer is told), 4.3 (same date: general < specific < regional) and
4.4 (same date and scope: unresolved, show both). Dates and scope come only from
front matter (4.5). Precedence is applied inside each group of rules on the same
topic, never across the whole corpus.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .facts import Facts
from .policies import registry
from .policies.store import PolicyStore

SCOPE_RANK = {"general": 0, "specific": 1, "regional": 2}
REGION_OF_FILE = {"19": "remote", "20": "international"}  # the regional addenda and the region each covers


@dataclass
class Decision:
    topic: str
    outcome: str  # resolved | unresolved | depends_on_region | not_in_force | seller
    rule: str  # the file 00 item (or other) that decides it
    reason: str
    applies: list[str] = field(default_factory=list)  # short ids
    set_aside: list[str] = field(default_factory=list)  # short ids


@dataclass
class Applicability:
    status: dict[str, str] = field(default_factory=dict)  # full id -> applies | superseded | other_region | conflict | not_in_force
    decisions: list[Decision] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)  # full ids removed from the evidence
    decisive_missing: list[str] = field(default_factory=list)  # facts that would change the answer


def decide(store: PolicyStore, ids: list[str], facts: Facts, contact: date) -> Applicability:
    out = Applicability()
    by_short = {store.by_id[i].short: i for i in ids}

    # 1. Files not yet in force on the contact date (00 §3.1).
    late: dict[str, list[str]] = {}
    for i in ids:
        s = store.by_id[i]
        eff = store.docs[s.file_num].effective
        if eff is not None and eff > contact:
            late.setdefault(s.file_num, []).append(i)
        else:
            out.status[i] = "applies"
    for file_num, gone in late.items():
        doc = store.docs[file_num]
        out.excluded += gone
        out.decisions.append(
            Decision(
                topic=doc.title,
                outcome="not_in_force",
                rule="00#3.1",
                reason=f"File {file_num} takes effect on {doc.meta.get('effective_date')}, after the contact date "
                f"{contact.isoformat()}, so it does not apply.",
                set_aside=[store.by_id[g].short for g in gone],
            )
        )

    # 2. Competing rules on the same topic.
    for group in registry.COMPETING:
        members = [m for m in group["items"] if m in by_short and by_short[m] not in out.excluded]
        if len(members) < 2:
            continue
        regional = [m for m in members if store.docs[m[:2]].scope == "regional"]
        general = [m for m in members if m not in regional]

        # Regional override (00 §4.1).
        if regional:
            if facts.region is None:
                out.decisions.append(
                    Decision(
                        topic=group["topic"],
                        outcome="depends_on_region",
                        rule="00#4.1",
                        reason="Remote areas and international orders have their own rule here, and the region is "
                        "not known yet.",
                        applies=members,
                    )
                )
                if "region" not in out.decisive_missing:
                    out.decisive_missing.append("region")
            else:
                matching = [m for m in regional if REGION_OF_FILE.get(m[:2]) == facts.region]
                others = [m for m in regional if m not in matching]
                for m in others:
                    out.status[by_short[m]] = "other_region"
                if matching:
                    for m in general:
                        out.status[by_short[m]] = "superseded"
                    out.decisions.append(
                        Decision(
                            topic=group["topic"],
                            outcome="resolved",
                            rule="00#4.1",
                            reason=f"File {matching[0][:2]} is regional and covers this delivery region, so it "
                            "overrides the general rule for this topic.",
                            applies=matching,
                            set_aside=general + others,
                        )
                    )
                    continue
        if group.get("agree") or len(general) < 2:
            continue

        # Among the non-regional rules (00 §4.2 to §4.4).
        docs = {m: store.docs[m[:2]] for m in general}
        if any(d.effective is None or d.scope is None for d in docs.values()):
            out.decisions.append(
                Decision(
                    topic=group["topic"],
                    outcome="unresolved",
                    rule="00#4.5",
                    reason="A file's effective date or scope is missing, so precedence cannot be decided.",
                    applies=general,
                )
            )
            for m in general:
                out.status[by_short[m]] = "conflict"
            continue
        latest = max(d.effective for d in docs.values())
        newest = [m for m in general if docs[m].effective == latest]
        older = [m for m in general if m not in newest]
        if older:
            for m in older:
                out.status[by_short[m]] = "superseded"
            out.decisions.append(
                Decision(
                    topic=group["topic"],
                    outcome="resolved",
                    rule="00#4.2",
                    reason=f"{' and '.join('file ' + m[:2] for m in newest)} has the later effective date "
                    f"({latest}). Tell the customer the files differ and which one was used.",
                    applies=newest,
                    set_aside=older,
                )
            )
        if len(newest) > 1:
            ranks = {m: SCOPE_RANK.get(docs[m].scope, -1) for m in newest}
            top = max(ranks.values())
            winners = [m for m in newest if ranks[m] == top]
            losers = [m for m in newest if ranks[m] != top]
            if losers:
                for m in losers:
                    out.status[by_short[m]] = "superseded"
                out.decisions.append(
                    Decision(
                        topic=group["topic"],
                        outcome="resolved",
                        rule="00#4.3",
                        reason=f"Same effective date; file {winners[0][:2]} has the more specific scope "
                        f"({docs[winners[0]].scope}), so it applies.",
                        applies=winners,
                        set_aside=losers,
                    )
                )
            if len(winners) > 1:
                for m in winners:
                    out.status[by_short[m]] = "conflict"
                out.decisions.append(
                    Decision(
                        topic=group["topic"],
                        outcome="unresolved",
                        rule="00#4.4",
                        reason="Same effective date and same scope, different rules. The files do not settle it: "
                        "state what each says and that NovaCart support must confirm.",
                        applies=winners,
                    )
                )

    # 3. Seller (00 §2.6): marketplace items follow files 17 and 18.
    seller_relevant = any(store.by_id[i].file_num in ("17", "18") for i in ids)
    if facts.seller == "marketplace":
        out.decisions.append(
            Decision(
                topic="seller",
                outcome="seller",
                rule="00#2.6",
                reason="The item is sold by a marketplace seller: files 17 and 18 apply, promo codes and store "
                "credit do not, and the seller gives the warranty.",
            )
        )
    elif facts.seller is None and seller_relevant:
        out.decisions.append(
            Decision(
                topic="seller",
                outcome="seller",
                rule="00#2.6",
                reason="Some rules differ for marketplace items. Unless the customer says so, treat the item as "
                "Sold by NovaCart, and ask only if the answer would change.",
            )
        )

    for i in out.excluded:
        out.status.pop(i, None)
    return out
