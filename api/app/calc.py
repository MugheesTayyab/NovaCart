"""Exact calculations, in code. The answer model only copies these results.

Money is whole rupees, computed with Decimal and rounded half up at the moment each
amount is produced (file 00, Section 1.3). Every step records the item it applies.
When the inputs are missing or unclear the handler returns `needs_input` with the
fact to ask for, and no number at all.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import rules as R
from .facts import Facts, Item
from .policies.store import PolicyStore, PromoCode

# ---------- money and date helpers ----------


def rupees(x: Decimal | int | str) -> int:
    """Round half up to a whole rupee (file 00, Section 1.3)."""
    return int(Decimal(x).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def pct_of(amount: int, percent: int | str) -> int:
    return rupees(Decimal(amount) * Decimal(percent) / Decimal(100))


def gst_included(price: int) -> int:
    """GST contained in a GST-inclusive price: price x 18 / 118 (file 00, Section 1.2)."""
    return rupees(Decimal(price) * 18 / 118)


def split_proportionally(total: int, weights: list[int]) -> list[int]:
    """Shares of `total` in proportion to `weights`, each rounded half up. Any rounding
    difference goes to the largest weight, the first listed on a tie (12 §6.2, 13 §4.4)."""
    base = sum(weights)
    if base <= 0:
        return [0 for _ in weights]
    shares = [rupees(Decimal(total) * w / base) for w in weights]
    diff = total - sum(shares)
    if diff:
        top = max(range(len(weights)), key=lambda i: (weights[i], -i))
        shares[top] += diff
    return shares


def deadline(start: date, days: int) -> date:
    """Last day of an N-day limit from `start`: start + N calendar days, inclusive (00 §1.6)."""
    return start + timedelta(days=days)


def add_business_days(start: date, n: int) -> date:
    """Business days are Monday to Friday; public holidays are not excluded; counting
    starts on the first business day after the event (file 00, Section 1.5)."""
    d = start
    left = n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return d


def full_months(a: date, b: date) -> int:
    """Whole calendar months from a to b. A month completes on the same day of the month
    as `a`, or on the last day of a shorter month (file 00, Section 1.7)."""
    if b < a:
        return 0
    months = (b.year - a.year) * 12 + (b.month - a.month)
    last_day = calendar.monthrange(b.year, b.month)[1]
    if b.day < min(a.day, last_day):
        months -= 1
    return max(0, months)


def fmt(n: int) -> str:
    return f"{n:,}" if n >= 0 else f"−{abs(n):,}"


# ---------- results ----------


@dataclass
class Step:
    label: str
    result: str
    formula: str | None = None
    rule: str | None = None


@dataclass
class CalcResult:
    kind: str  # checkout_total | return_refund | return_window | warranty_refund
    status: str  # ok | needs_input | not_eligible | unsupported
    steps: list[Step] = field(default_factory=list)
    result: str | None = None
    missing: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    rules: list[str] = field(default_factory=list)

    def add(self, label: str, result: int | str, formula: str | None = None, rule: str | None = None) -> None:
        self.steps.append(Step(label, fmt(result) if isinstance(result, int) else result, formula, rule))
        if rule and rule not in self.rules:
            self.rules.append(rule)

    def cite(self, rule: str) -> None:
        if rule not in self.rules:
            self.rules.append(rule)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------- version selection (file 00, Sections 3 and 4) ----------


def in_force(store: PolicyStore, file_num: str, contact: date) -> bool:
    doc = store.docs.get(file_num)
    eff = doc.effective if doc else None
    return eff is not None and eff <= contact


def returns_version(store: PolicyStore, contact: date) -> str | None:
    """01 and 02 are the same topic and scope; the later effective date in force wins."""
    candidates = [f for f in ("01", "02") if in_force(store, f, contact)]
    if not candidates:
        return None
    return max(candidates, key=lambda f: store.docs[f].effective)


def shipping_version(store: PolicyStore, contact: date) -> str | None:
    candidates = [f for f in ("06", "21") if in_force(store, f, contact)]
    if not candidates:
        return None
    return max(candidates, key=lambda f: store.docs[f].effective)


# ---------- promo code discount ----------


def _code_kind(code: PromoCode) -> tuple[str, int | None]:
    m = re.search(r"(\d+)\s*%", code.benefit)
    if m:
        return "percent", int(m.group(1))
    m = re.search(r"Rs\.?\s*([\d,]+)\s*off", code.benefit, re.I)
    if m:
        return "flat", int(m.group(1).replace(",", ""))
    if "shipping" in code.benefit.lower():
        return "shipping", None
    return "unknown", None


def _code_eligible(code: PromoCode, category: str | None) -> bool:
    text = code.eligible.lower()
    if "whole order" in text:
        return True
    if category is None:
        return False
    if text.startswith("all categories except"):
        return category not in text
    if "only" in text:
        return text.replace("only", "").strip() in category or category in text
    return False


@dataclass
class Discount:
    code: str | None = None
    amount: int = 0
    eligible_idx: list[int] = field(default_factory=list)
    eligible_subtotal: int = 0
    reason_not_applied: str | None = None


def compute_discount(
    store: PolicyStore, facts: Facts, prices: list[int], items: list[Item], order_date: date, res: CalcResult
) -> Discount:
    codes = [c for c in facts.promo_codes if c in store.promo_codes]
    discount_codes = [c for c in codes if _code_kind(store.promo_codes[c])[0] in ("percent", "flat")]
    if not discount_codes:
        return Discount()
    if len(discount_codes) > 1:
        res.notes.append(f"Only one discount code can be used per order ({', '.join(discount_codes)} given).")
        res.cite(R.ONE_DISCOUNT_CODE)
        res.missing.append("which one discount code was used")
        return Discount(reason_not_applied="more than one discount code")
    code = store.promo_codes[discount_codes[0]]
    res.cite(code.source)
    d = Discount(code=code.code)
    if code.last_order_date and order_date > code.last_order_date:
        res.notes.append(f"{code.code} was not valid: its last order date is {code.last_order_date}.")
        res.cite(R.CODE_VALIDITY)
        d.reason_not_applied = "expired"
        return d
    if facts.seller == "marketplace":
        res.notes.append("Codes do not apply to items sold by marketplace sellers.")
        res.cite(R.NO_CODES_MARKETPLACE)
        d.reason_not_applied = "marketplace"
        return d
    if code.code == "WELCOME10" and facts.first_order is False:
        res.notes.append("WELCOME10 is for a customer's first order only.")
        res.cite(R.WELCOME10_FIRST_ORDER)
        d.reason_not_applied = "not first order"
        return d
    d.eligible_idx = [i for i, it in enumerate(items) if _code_eligible(code, it.category)]
    d.eligible_subtotal = sum(prices[i] for i in d.eligible_idx)
    names = " + ".join(fmt(prices[i]) for i in d.eligible_idx) or "0"
    res.add(f"Eligible subtotal for {code.code}", d.eligible_subtotal, names, R.ELIGIBLE_SUBTOTAL)
    if code.minimum and d.eligible_subtotal < code.minimum:
        res.notes.append(f"{code.code} needs an eligible subtotal of at least Rs. {fmt(code.minimum)}.")
        res.cite(R.MINIMUM_CHECK)
        d.reason_not_applied = "below minimum"
        return d
    kind, value = _code_kind(code)
    if kind == "percent":
        raw = pct_of(d.eligible_subtotal, value)
        d.amount = min(raw, code.maximum) if code.maximum else raw
        cap = f", cap {fmt(code.maximum)}" if code.maximum else ""
        res.add(f"{code.code} discount", d.amount, f"{value}% of {fmt(d.eligible_subtotal)}{cap}", R.PERCENT_DISCOUNT)
    else:
        d.amount = min(value or 0, d.eligible_subtotal)
        res.add(f"{code.code} discount", d.amount, f"Rs. {fmt(value or 0)} off", R.FLAT_DISCOUNT)
    return d


# ---------- handlers ----------


def _prices(facts: Facts, res: CalcResult) -> list[int]:
    """International orders pay the listed price without GST, per item (20 §3.1)."""
    if facts.region == "international":
        out = [rupees(Decimal(it.price) / Decimal(R.INTERNATIONAL_EXPORT_PRICE["divisor"])) for it in facts.items]
        for it, p in zip(facts.items, out):
            res.add(f"{it.name.capitalize()} export price", p, f"{fmt(it.price)} ÷ 1.18", R.INTERNATIONAL_EXPORT_PRICE["source"])
        return out
    return [it.price for it in facts.items]


def checkout_total(store: PolicyStore, facts: Facts, contact: date) -> CalcResult:
    res = CalcResult(kind="checkout_total", status="ok")
    res.cite("00#5.1")
    if not facts.items:
        return CalcResult(kind="checkout_total", status="needs_input", missing=["the items and their prices"])
    if any(it.category is None for it in facts.items):
        res.missing.append("the category of each item")
    if facts.region is None:
        res.missing.append("the delivery city or country")
    if res.missing:
        res.status = "needs_input"
        return res
    if facts.region == "unserved":
        res.status = "not_eligible"
        res.notes.append("NovaCart delivers only within Pakistan and to the USA, the UK and the UAE.")
        res.cite("00#2.3")
        return res
    if any(it.category == "grocery/perishables" for it in facts.items) and facts.region != "metro":
        res.status = "not_eligible"
        res.notes.append("Orders with grocery can only be delivered to a Metro city address.")
        res.cite(R.GROCERY_METRO_ONLY)
        return res

    order_date = date.fromisoformat(facts.order_date) if facts.order_date else contact
    prices = _prices(facts, res)
    subtotal = sum(prices)
    res.add("Merchandise subtotal", subtotal, " + ".join(fmt(p) for p in prices), "00#5.1")
    disc = compute_discount(store, facts, prices, facts.items, order_date, res)
    if "which one discount code was used" in res.missing:
        res.status = "needs_input"
        return res
    after = subtotal - disc.amount
    res.add("Subtotal after discount", after, f"{fmt(subtotal)} − {fmt(disc.amount)}", "00#5.1")

    bulky = sum(1 for it in facts.items if it.category == "furniture/bulky")
    extras: list[tuple[str, int, str]] = []
    if facts.region in ("metro", "rest_of_pakistan"):
        ver = shipping_version(store, contact)
        if not ver:
            res.status = "unsupported"
            res.notes.append("No shipping fee file is in force on this date.")
            return res
        table = R.SHIPPING[ver]
        tier = table[facts.region]
        if facts.express:
            if facts.region != "metro" or bulky:
                res.status = "not_eligible"
                res.notes.append("Express delivery is for Metro cities only and not for orders with a bulky item.")
                res.cite(R.EXPRESS_RULES["metro_only"])
                return res
            fee, src = table["express"]
            res.add("Express fee (replaces the standard fee)", fee, None, src)
            res.cite(R.EXPRESS_RULES["replaces_standard"])
        else:
            fs = store.promo_codes.get("FREESHIP") if "FREESHIP" in facts.promo_codes else None
            fs_ok = False
            if fs is not None:
                res.cite(fs.source)
                if fs.last_order_date and order_date > fs.last_order_date:
                    res.notes.append(f"FREESHIP was not valid: its last order date is {fs.last_order_date}.")
                    res.cite(R.CODE_VALIDITY)
                elif after < (fs.minimum or 0):
                    res.notes.append(
                        f"FREESHIP needs a merchandise subtotal after discount of at least Rs. {fmt(fs.minimum or 0)}."
                    )
                    res.cite(R.FREESHIP_RULES["minimum"])
                else:
                    fs_ok = True
            if after >= tier["free_from"]:
                res.add("Standard shipping", 0, f"{fmt(after)} is at least {fmt(tier['free_from'])}", table["source"])
            elif fs_ok:
                res.add("Standard shipping, removed by FREESHIP", 0, None, R.FREESHIP_RULES["removes"])
                res.cite(R.FREESHIP_RULES["minimum"])
            else:
                res.add("Standard shipping", tier["fee"], f"below the free threshold of {fmt(tier['free_from'])}", table["source"])
        if bulky:
            fees, src = table["bulky"]
            extras.append((f"Bulky surcharge × {bulky}", fees[facts.region] * bulky, src))
        if facts.payment_method == "cash on delivery":
            extras.append(("Cash on delivery fee", R.COD_FEE["fee"], R.COD_FEE["source"]))
    elif facts.region == "remote":
        if not in_force(store, "19", contact):
            res.status = "unsupported"
            res.notes.append("The Remote areas addendum is not yet in force on this date.")
            return res
        if bulky or facts.express or facts.payment_method == "cash on delivery":
            res.status = "not_eligible"
            res.notes.append("Express, bulky items and cash on delivery are not available for Remote areas.")
            res.cite("19#2.2")
            return res
        rs = R.REMOTE_SHIPPING
        if "FREESHIP" in facts.promo_codes:
            res.notes.append("FREESHIP is not valid for Remote areas.")
            res.cite("19#2.3")
        fee = 0 if after >= rs["free_from"] else rs["fee"]
        res.add("Standard shipping, Remote areas", fee, f"free from {fmt(rs['free_from'])}", rs["source"])
    elif facts.region == "international":
        country = facts.country if facts.country in R.INTERNATIONAL_SHIPPING else None
        if not country:
            res.status = "needs_input"
            res.missing.append("the destination country (USA, UK or UAE)")
            return res
        res.add(f"Shipping to {country}", R.INTERNATIONAL_SHIPPING[country], "flat fee per order", R.INTERNATIONAL_SHIPPING["source"])
        res.cite("20#4.2")

    for label, amount, src in extras:
        res.add(label, amount, None, src)
    shipping_and_extras = sum(
        int(s.result.replace(",", "").replace("−", "-")) for s in res.steps
        if s.label.startswith(("Standard shipping", "Express fee", "Shipping to", "Bulky", "Cash on delivery"))
    )
    total = after + shipping_and_extras
    res.add("Total payable", total, f"{fmt(after)} + {fmt(shipping_and_extras)}", "00#5.1")
    res.result = f"Rs. {fmt(total)}"
    if facts.payment_method == "cash on delivery" and total > R.COD_LIMITS[0][0]:
        res.notes.append(
            "The maximum for a cash on delivery order is Rs. 40,000 in file 10 and Rs. 50,000 in file 11; "
            "the files do not settle it and support must confirm."
        )
        for _, src in R.COD_LIMITS:
            res.cite(src)
        res.cite("00#4.4")
    return res


def return_window(store: PolicyStore, facts: Facts, contact: date) -> CalcResult | None:
    """Is a change-of-mind return still in time? Needs a delivery date and a category."""
    if not facts.delivery_date or not facts.category:
        return None
    res = CalcResult(kind="return_window", status="ok")
    delivered = date.fromisoformat(facts.delivery_date)
    cat = facts.category
    if facts.region is None:
        res.status = "needs_input"
        res.missing.append("the delivery city or country")
        res.notes.append("Remote areas and international orders have their own return windows.")
        for r in ("01#2.2", R.REMOTE_RETURN_WINDOWS["source"], R.INTERNATIONAL_RETURN_WINDOW["source"]):
            res.cite(r)
        return res
    days: int | None
    src: str
    if facts.region == "remote" and in_force(store, "19", contact):
        days = R.REMOTE_RETURN_WINDOWS["days"].get(cat)
        src = R.REMOTE_RETURN_WINDOWS["source"]
    elif facts.region == "international" and in_force(store, "20", contact):
        if cat in R.INTERNATIONAL_NO_CHANGE_OF_MIND["categories"] and facts.reason != "novacart_error":
            res.status = "not_eligible"
            res.notes.append("Personal care items cannot be returned from international orders for change of mind.")
            res.cite(R.INTERNATIONAL_NO_CHANGE_OF_MIND["source"])
            return res
        days = R.INTERNATIONAL_RETURN_WINDOW["days"] if cat in R.INTERNATIONAL_RETURN_WINDOW["categories"] else None
        src = R.INTERNATIONAL_RETURN_WINDOW["source"]
    else:
        ver = returns_version(store, contact)
        if not ver:
            return None
        days = R.RETURN_WINDOWS[ver]["days"].get(cat)
        src = R.RETURN_WINDOWS[ver]["source"]
    if days is None:
        res.status = "not_eligible"
        res.notes.append(f"{cat.capitalize()} cannot be returned for change of mind.")
        res.cite(src)
        res.cite(R.NON_RETURNABLE["grocery/perishables"] if cat == "grocery/perishables" else src)
        return res
    last = deadline(delivered, days)
    res.add("Delivered", facts.delivery_date)
    res.add(f"Return window, {cat}", f"{days} days", None, src)
    res.add("Last day to request", last.isoformat(), f"{facts.delivery_date} + {days} days", "00#1.6")
    in_time = contact <= last
    res.add("Contact date", contact.isoformat())
    res.result = "in time" if in_time else "window has passed"
    if not in_time:
        res.status = "not_eligible"
        if cat in ("electronics", "furniture/bulky"):
            res.notes.append("A defect after the window can still be handled under warranty.")
            res.cite("01#2.3")
    return res


def return_refund(store: PolicyStore, facts: Facts, contact: date, text: str) -> CalcResult:
    res = CalcResult(kind="return_refund", status="ok")
    if not facts.items:
        res.status = "needs_input"
        res.missing.append("the price paid for each item")
        return res
    returned = _returned_items(facts.items, text)
    if not returned:
        res.status = "needs_input"
        res.missing.append("which items are being returned")
        return res
    ver = returns_version(store, contact)
    if not ver:
        res.status = "unsupported"
        res.notes.append("No returns policy is in force on this date.")
        return res
    if any(it.category is None for it in facts.items):
        res.missing.append("the category of each item")
    if facts.region is None:
        res.missing.append("the delivery city or country")
    error = facts.reason == "novacart_error"
    if not error and any(facts.items[i].category == "electronics" for i in returned) and facts.condition is None:
        res.missing.append("whether the electronics item is still sealed or has been opened")
    if res.missing:
        res.status = "needs_input"
        return res
    if facts.region == "unserved":
        res.status = "not_eligible"
        res.notes.append("NovaCart does not deliver to this country.")
        res.cite("00#2.3")
        return res
    if facts.reason is None:
        res.notes.append("Treated as a change-of-mind return because no defect, damage or wrong item was mentioned.")
    if any(facts.items[i].category == "grocery/perishables" for i in returned) and not error:
        res.status = "not_eligible"
        res.notes.append("Grocery and perishables cannot be returned for change of mind.")
        res.cite(R.NON_RETURNABLE["grocery/perishables"])
        return res
    if facts.final_sale and not error:
        res.status = "not_eligible"
        res.notes.append("Items marked Final Sale cannot be returned for change of mind.")
        res.cite(R.NON_RETURNABLE["final sale"])
        return res
    if any(facts.items[i].category == "personal care" for i in returned) and facts.condition == "opened" and not error:
        res.status = "not_eligible"
        res.notes.append("Opened personal care items cannot be returned.")
        res.cite(R.NON_RETURNABLE["opened personal care"])
        return res

    window = return_window(store, facts, contact)
    if window and window.status == "not_eligible" and not error:
        window.kind = "return_refund"
        return window

    order_date = date.fromisoformat(facts.order_date) if facts.order_date else contact
    prices = _prices(facts, res)
    disc = compute_discount(store, facts, prices, facts.items, order_date, res)
    if "which one discount code was used" in res.missing:
        res.status = "needs_input"
        return res
    shares = [0] * len(prices)
    if disc.amount and disc.eligible_idx:
        split = split_proportionally(disc.amount, [prices[i] for i in disc.eligible_idx])
        for i, s in zip(disc.eligible_idx, split):
            shares[i] = s

    item_refunds = 0
    paid_rule = R.PAID_PRICE[ver]
    for i in returned:
        it = facts.items[i]
        name = it.name.capitalize()
        if shares[i]:
            res.add(f"{name}'s share of the discount", shares[i],
                    f"{fmt(disc.amount)} × {fmt(prices[i])} ÷ {fmt(disc.eligible_subtotal)}", R.DISCOUNT_SPLIT)
        paid = prices[i] - shares[i]
        res.add(f"{name} paid price", paid, f"{fmt(prices[i])} − {fmt(shares[i])}" if shares[i] else None, paid_rule)
        fee = 0
        if error:
            res.add(f"Restocking fee, {it.category}", 0, "NovaCart error", R.NO_RESTOCKING_ON_ERROR[ver])
        elif it.category in R.RESTOCKING[ver] and (it.category != "electronics" or facts.condition != "sealed"):
            pct, src = R.RESTOCKING[ver][it.category]
            fee = pct_of(paid, pct)
            res.add(f"Restocking fee, {it.category}", -fee, f"{pct}% of {fmt(paid)}", src)
        else:
            src = R.NO_RESTOCKING[ver].get(it.category, R.RESTOCKING[ver].get("electronics", (0, "01#3.1"))[1])
            res.add(f"Restocking fee, {it.category}", 0, "sealed" if it.category == "electronics" else None, src)
        item_refunds += paid - fee

    # One return fee per request.
    if error:
        ret_fee, src, why = 0, R.RETURN_FEES[ver]["error_source"], "NovaCart error"
    elif facts.region == "international":
        ret_fee, src, why = 0, R.INTERNATIONAL_RETURN_COSTS["source"], "customer arranges return shipping"
    elif facts.region == "remote" and in_force(store, "19", contact):
        ret_fee, src, why = R.REMOTE_RETURN_LABEL["label"], R.REMOTE_RETURN_LABEL["source"], "Remote areas label fee"
    else:
        any_bulky = any(facts.items[i].category == "furniture/bulky" for i in returned)
        fees = R.RETURN_FEES[ver]
        ret_fee, src, why = (fees["pickup"], fees["source"], "pickup fee") if any_bulky else (fees["label"], fees["source"], "label fee")
    res.add("Return fee, one per request", -ret_fee, why, src)
    total = max(0, item_refunds - ret_fee)
    res.add("Refund total", total, f"{fmt(item_refunds)} − {fmt(ret_fee)}, never below 0", R.REFUND_TOTAL[ver])
    res.result = f"Rs. {fmt(total)}"
    res.cite("03#2.1")  # shipping fees are not refunded on partial or change-of-mind returns
    if ver == "01" and in_force(store, "02", contact):
        res.notes.append("Returns policy version 3 (file 01) applies; version 2 (file 02) sets different windows and fees.")
        res.cite("00#4.2")
    if re.search(r"store credit", text, re.I) and facts.payment_method != "cash on delivery":
        bonus = min(pct_of(total, R.STORE_CREDIT_BONUS["percent"]), R.STORE_CREDIT_BONUS["cap"])
        res.add("Store credit bonus, if chosen", bonus, f"5% of {fmt(total)}, cap 1,000", R.STORE_CREDIT_BONUS["source"])
        res.notes.append(f"As store credit the customer would receive Rs. {fmt(total + bonus)}.")
    if window and window.result:
        res.notes.append(f"Return window: {window.result} (last day {window.steps[2].result}).")
        for r in window.rules:
            res.cite(r)
    return res


def warranty_refund(store: PolicyStore, facts: Facts, contact: date, text: str) -> CalcResult:
    res = CalcResult(kind="warranty_refund", status="ok")
    if not facts.delivery_date:
        res.missing.append("the delivery date")
    price = facts.items[0].price if len(facts.items) == 1 else (facts.amounts[0] if len(facts.amounts) == 1 else None)
    if price is None:
        res.missing.append("the price paid for the item")
    accessory = any(w in text.lower() for w in R.ACCESSORY_WORDS)
    cat = "accessory" if accessory and facts.category == "electronics" else facts.category
    if cat not in ("electronics", "accessory", "furniture/bulky"):
        if cat is None:
            res.missing.append("what kind of item it is")
        else:
            res.status = "not_eligible"
            res.notes.append(f"{cat.capitalize()} has no warranty.")
            res.cite(R.WARRANTY_MONTHS["source"])
            return res
    if res.missing:
        res.status = "needs_input"
        return res
    if facts.seller == "marketplace":
        res.status = "not_eligible"
        res.notes.append("Marketplace items carry the seller's warranty, not NovaCart's.")
        res.cite("18#4.1")
        return res
    w = R.WARRANTY_MONTHS[cat]
    delivered = date.fromisoformat(facts.delivery_date)
    m = full_months(delivered, contact)
    res.add("Warranty period", f"{w} months", cat, R.WARRANTY_MONTHS["source"])
    res.add("Full months since delivery", str(m), f"{facts.delivery_date} to {contact.isoformat()}", R.WARRANTY_MONTHS["full_months"])
    if m >= w:
        res.status = "not_eligible"
        res.notes.append("The warranty period has ended.")
        return res
    refund = rupees(Decimal(price) * (w - m) / w)
    res.add("Refund if no repair or replacement is possible", refund, f"{fmt(price)} × ({w} − {m}) ÷ {w}", R.WARRANTY_MONTHS["prorata"])
    res.result = f"Rs. {fmt(refund)}"
    res.notes.append("NovaCart first tries a repair, then a replacement; this refund applies only if neither is possible.")
    res.cite("08#4.1")
    res.cite("08#4.2")
    return res


def _returned_items(items: list[Item], text: str) -> list[int]:
    if len(items) == 1:
        return [0]
    low = text.lower()
    m = re.search(r"\breturn(?:ing)?\b(.*)", low)
    tail = m.group(1)[:80] if m else ""
    picked = [i for i, it in enumerate(items) if re.search(r"\b" + re.escape(it.name.rstrip("s")), tail)]
    if re.search(r"\b(both|all|everything|whole order)\b", tail):
        return list(range(len(items)))
    return picked


# ---------- dispatch ----------

RETURN_WORDS = re.compile(r"\b(return|send (it|them) back|refund|money back|get back)\b", re.I)
TOTAL_WORDS = re.compile(r"\b(total|how much (will|do|would) i pay|pay(able)?|shipping|delivery (fee|charge)|checkout|free shipping|cost)\b", re.I)
WARRANTY_WORDS = re.compile(r"\b(warranty|guarantee)\b", re.I)


def run(store: PolicyStore, facts: Facts, contact: date, text: str) -> CalcResult | None:
    """Picks the calculation the question asks for, if any."""
    has_money = bool(facts.items or facts.amounts)
    asks_amount = re.search(r"\b(how much|refund|total|amount|get back|pay|cost|fee)\b", text, re.I)
    if WARRANTY_WORDS.search(text) and has_money and asks_amount:
        return warranty_refund(store, facts, contact, text)
    if RETURN_WORDS.search(text) and has_money and asks_amount:
        return return_refund(store, facts, contact, text)
    if RETURN_WORDS.search(text) and facts.delivery_date:
        return return_window(store, facts, contact)
    if TOTAL_WORDS.search(text) and has_money:
        return checkout_total(store, facts, contact)
    return None
