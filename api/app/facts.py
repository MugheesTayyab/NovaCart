"""Customer facts per session, extracted with deterministic parsers.

A fact is set only when the customer's words support it. Values the answer model
proposes go through `apply_model_updates`, which validates them against the same
vocabularies before they are stored.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

# ---------- vocabularies (regions are defined in file 00, Section 2) ----------

METRO = {"islamabad": "Islamabad", "lahore": "Lahore", "karachi": "Karachi"}
REMOTE = {
    "azad jammu": "Azad Jammu & Kashmir", "azad kashmir": "Azad Jammu & Kashmir", "ajk": "Azad Jammu & Kashmir",
    "muzaffarabad": "Azad Jammu & Kashmir", "mirpur": "Azad Jammu & Kashmir",
    "gilgit": "Gilgit-Baltistan", "baltistan": "Gilgit-Baltistan", "skardu": "Gilgit-Baltistan",
    "hunza": "Gilgit-Baltistan",
}
# Cities that are in Pakistan but neither Metro nor Remote: "Rest of Pakistan" (00 §2.4).
REST_OF_PAKISTAN = [
    "rawalpindi", "faisalabad", "multan", "peshawar", "quetta", "hyderabad", "sialkot", "gujranwala", "sukkur",
    "bahawalpur", "abbottabad", "sargodha", "sahiwal", "larkana", "mardan", "gujrat", "jhelum", "sheikhupura",
    "okara", "rahim yar khan", "dera ghazi khan", "nawabshah", "mingora", "kasur", "chiniot", "murree", "attock",
    "gwadar", "taxila", "wah cantt",
]
INTERNATIONAL = {
    "usa": "USA", "united states": "USA", "america": "USA", "new york": "USA",
    "uk": "UK", "united kingdom": "UK", "england": "UK", "london": "UK", "britain": "UK",
    "uae": "UAE", "dubai": "UAE", "abu dhabi": "UAE", "sharjah": "UAE", "emirates": "UAE",
}
UNSERVED_COUNTRIES = [
    "canada", "saudi", "ksa", "qatar", "oman", "kuwait", "bahrain", "india", "china", "australia", "germany",
    "france", "turkey", "malaysia", "afghanistan", "iran", "bangladesh",
]

CATEGORY_WORDS = {
    "electronics": ["headphone", "earphone", "earbud", "phone", "mobile", "laptop", "tablet", "charger", "cable",
                    "speaker", "camera", "watch", "tv", "television", "monitor", "keyboard", "mouse", "console",
                    "electronics", "power bank", "router", "smartwatch"],
    "clothing": ["shirt", "trouser", "jeans", "dress", "kurta", "shalwar", "jacket", "shoe", "sneaker", "clothing",
                 "clothes", "t-shirt", "tshirt", "hoodie", "sweater", "scarf", "socks", "innerwear", "swimwear",
                 "abaya", "dupatta"],
    "grocery/perishables": ["grocery", "groceries", "food", "fruit", "vegetable", "milk", "perishable", "rice",
                            "flour", "meat", "snacks"],
    "furniture/bulky": ["sofa", "bed", "table", "chair", "wardrobe", "furniture", "mattress", "cupboard", "desk",
                        "bulky", "fridge", "refrigerator", "washing machine"],
    "personal care": ["shampoo", "cream", "lotion", "perfume", "makeup", "razor", "toothpaste", "personal care",
                      "soap", "serum", "trimmer"],
}

PAYMENT_WORDS = {
    "card": ["credit card", "debit card", "visa", "mastercard", "by card", "my card", "card payment", "paid by card"],
    "online banking": ["online banking", "bank transfer", "net banking"],
    "wallet": ["jazzcash", "jazz cash", "easypaisa", "easy paisa", "wallet"],
    "cash on delivery": ["cash on delivery", "cod", "pay on delivery", "paid cash"],
    "store credit": ["store credit"],
}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

ALLOWED_REGION_CLASSES = ("metro", "rest_of_pakistan", "remote", "international", "unserved")


@dataclass
class Item:
    name: str
    price: int  # whole rupees
    category: str | None = None
    quantity: int = 1


@dataclass
class Facts:
    location: str | None = None  # as the customer named it
    region: str | None = None  # metro | rest_of_pakistan | remote | international | unserved
    country: str | None = None  # for international
    category: str | None = None
    seller: str | None = None  # novacart | marketplace
    order_date: str | None = None
    delivery_date: str | None = None
    contact_date: str | None = None
    contact_date_stated: bool = False
    payment_method: str | None = None
    promo_codes: list[str] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    amounts: list[int] = field(default_factory=list)
    condition: str | None = None  # sealed | opened | used | defective | damaged | wrong_item
    reason: str | None = None  # change_of_mind | novacart_error
    first_order: bool | None = None
    final_sale: bool | None = None
    express: bool | None = None

    def public(self) -> dict:
        """Facts worth showing the model and the UI (no empty values)."""
        d = asdict(self)
        d.pop("contact_date_stated", None)
        return {k: v for k, v in d.items() if v not in (None, [], "")}

    def key(self) -> tuple:
        """The facts that change which policies apply; part of the retrieval cache key."""
        return (self.region, self.category, self.seller, self.express)


# ---------- parsing helpers ----------

DATE_ISO = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
DATE_TEXT = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})\b"
    r"|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b",
    re.I,
)
AMOUNT = re.compile(r"(?:\brs\.?|\bpkr|₨)\s*([\d,]+(?:\.\d+)?)|\b([\d,]{3,})\s*(?:rupees|rs\b|pkr\b)", re.I)
DAYS_AGO = re.compile(r"\b(\d{1,3})\s+days?\s+ago\b", re.I)

ORDER_WORDS = ("order", "ordered", "placed", "bought", "purchased", "buy")
DELIVERY_WORDS = ("deliver", "received", "arrived", "got it", "got them", "came on", "reached")
CONTACT_WORDS = ("today is", "today's date", "it is now", "current date", "date today", "today,")


def _dates(text: str) -> list[tuple[int, date]]:
    out: list[tuple[int, date]] = []
    for m in DATE_ISO.finditer(text):
        try:
            out.append((m.start(), date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
        except ValueError:
            pass
    for m in DATE_TEXT.finditer(text):
        try:
            if m.group(1):
                d = date(int(m.group(3)), MONTHS[m.group(2).lower()[:3]], int(m.group(1)))
            else:
                d = date(int(m.group(6)), MONTHS[m.group(4).lower()[:3]], int(m.group(5)))
            out.append((m.start(), d))
        except (ValueError, KeyError):
            pass
    return sorted(out)


def _label_for(text: str, pos: int) -> str | None:
    window = text[max(0, pos - 60):pos].lower()
    # The keyword closest to the date wins.
    best, best_at = None, -1
    for label, words in (("contact", CONTACT_WORDS), ("order", ORDER_WORDS), ("delivery", DELIVERY_WORDS)):
        for w in words:
            at = window.rfind(w)
            if at > best_at:
                best, best_at = label, at
    if best is None and re.search(r"\btoday\b", window):
        return "contact"
    return best


def _contains(text: str, word: str) -> bool:
    return re.search(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", text) is not None


def category_of(name: str) -> str | None:
    n = name.lower()
    for cat, words in CATEGORY_WORDS.items():
        if any(_contains(n, w) or _contains(n, w + "s") for w in words):
            return cat
    return None


def _items(text: str) -> list[Item]:
    """'a shirt (Rs. 2,400)', 'headphones for Rs 3,200', 'shirt Rs. 2,000' -> items with prices."""
    items: list[Item] = []
    for m in AMOUNT.finditer(text):
        raw = (m.group(1) or m.group(2)).replace(",", "")
        try:
            price = int(float(raw))
        except ValueError:
            continue
        before = text[max(0, m.start() - 48):m.start()]
        before = re.sub(r"[(\[]\s*$", "", before).strip()
        before = re.sub(r"\b(for|at|costing|priced at|worth|of|=|:)\s*$", "", before, flags=re.I).strip()
        words = re.findall(r"[A-Za-z][A-Za-z-]*", before)[-3:]
        name = " ".join(words).lower()
        cat = category_of(name)
        if cat:
            # Keep the noun that gave the category as the item name.
            noun = next((w for w in reversed(words) if category_of(w)), words[-1] if words else name)
            items.append(Item(name=noun.lower(), price=price, category=cat))
    return items


def extract(text: str, today: date, facts: Facts) -> Facts:
    """Updates `facts` from one customer message. Returns the same object."""
    low = " " + text.lower() + " "

    # Dates.
    for pos, d in _dates(text):
        label = _label_for(text, pos)
        if label == "contact":
            facts.contact_date, facts.contact_date_stated = d.isoformat(), True
        elif label == "order":
            facts.order_date = d.isoformat()
        elif label == "delivery":
            facts.delivery_date = d.isoformat()
    if not facts.contact_date_stated:
        facts.contact_date = today.isoformat()
    contact = date.fromisoformat(facts.contact_date)
    m = DAYS_AGO.search(text)
    if m:
        label = _label_for(text, m.start()) or _label_for(text, m.end() + 1)
        target = (contact - timedelta(days=int(m.group(1)))).isoformat()
        if label == "order":
            facts.order_date = target
        elif label == "delivery" or label is None:
            facts.delivery_date = target
    if re.search(r"\b(delivered|arrived|received|got (it|them))\s+yesterday\b", low):
        facts.delivery_date = (contact - timedelta(days=1)).isoformat()
    if re.search(r"\b(delivered|arrived|received|got (it|them))\s+today\b", low):
        facts.delivery_date = contact.isoformat()

    # Location -> region class (file 00, Section 2).
    for key, name in METRO.items():
        if _contains(low, key):
            facts.location, facts.region, facts.country = name, "metro", "Pakistan"
    for key, name in REMOTE.items():
        if _contains(low, key):
            facts.location, facts.region, facts.country = name, "remote", "Pakistan"
    for key in REST_OF_PAKISTAN:
        if _contains(low, key):
            facts.location, facts.region, facts.country = key.title(), "rest_of_pakistan", "Pakistan"
    for key, country in INTERNATIONAL.items():
        if _contains(low, key):
            facts.location, facts.region, facts.country = country, "international", country
    for key in UNSERVED_COUNTRIES:
        if _contains(low, key):
            facts.location, facts.region, facts.country = key.title(), "unserved", key.title()

    # Items, amounts, category.
    found = _items(text)
    if found:
        facts.items = found
    amounts = []
    for m in AMOUNT.finditer(text):
        try:
            amounts.append(int(float((m.group(1) or m.group(2)).replace(",", ""))))
        except ValueError:
            pass
    if amounts:
        facts.amounts = amounts
    cats = {i.category for i in facts.items if i.category}
    if len(cats) == 1:
        facts.category = cats.pop()
    elif not facts.items:
        cat = category_of(low)
        if cat:
            facts.category = cat

    # Seller (file 00, Section 2.6).
    if re.search(r"\bmarketplace\b|\bsold by (?!novacart)[a-z]", low):
        facts.seller = "marketplace"
    elif "sold by novacart" in low:
        facts.seller = "novacart"

    # Payment.
    for method, words in PAYMENT_WORDS.items():
        if any(_contains(low, w) for w in words):
            facts.payment_method = method

    # Condition and reason.
    if re.search(r"\b(wrong item|wrong product|not what i ordered)\b", low):
        facts.condition, facts.reason = "wrong_item", "novacart_error"
    elif re.search(r"\b(damaged|broken|cracked|smashed|arrived broken)\b", low):
        facts.condition, facts.reason = "damaged", "novacart_error"
    elif re.search(r"\b(defective|faulty|not working|stopped working|doesn't work|does not work)\b", low):
        facts.condition, facts.reason = "defective", "novacart_error"
    else:
        if re.search(r"\b(sealed|unopened|never opened|still in the box|unused)\b", low):
            facts.condition = "sealed"
        elif re.search(r"\b(opened|used it|tried it|seal (is )?broken|worn|washed)\b", low):
            facts.condition = "opened"
        if re.search(r"\b(change of mind|changed my mind|don'?t want|do not want|don'?t like|no longer need)\b", low):
            facts.reason = "change_of_mind"

    if re.search(r"\bfirst order\b", low):
        facts.first_order = not re.search(r"\bnot (my )?first order\b", low)
    if "final sale" in low:
        facts.final_sale = True
    if re.search(r"\bexpress\b", low):
        facts.express = True
    return facts


def extract_codes(text: str, known: set[str], facts: Facts) -> None:
    """Promo codes are matched against the codes listed in file 12, plus any CODE-like token."""
    up = text.upper()
    codes = [c for c in known if re.search(r"(?<![A-Z0-9])" + c + r"(?![A-Z0-9])", up)]
    for m in re.finditer(r"\b(?:code|coupon|voucher)\s+([A-Z][A-Z0-9]{3,15})\b", up):
        if m.group(1) not in codes:
            codes.append(m.group(1))
    if codes:
        facts.promo_codes = sorted(set(codes), key=codes.index)


# ---------- model-proposed updates ----------

MODEL_FIELDS = {"location", "region", "category", "seller", "order_date", "delivery_date", "payment_method",
                "condition", "reason"}
CATEGORIES = tuple(CATEGORY_WORDS)
CONDITIONS = ("sealed", "opened", "used", "defective", "damaged", "wrong_item")
REASONS = ("change_of_mind", "novacart_error")


def apply_model_updates(facts: Facts, updates: object) -> list[str]:
    """Validates and applies the model's proposed fact updates. Returns rejected keys."""
    rejected: list[str] = []
    if not isinstance(updates, dict):
        return ["<not an object>"]
    for key, value in updates.items():
        if key not in MODEL_FIELDS or not isinstance(value, str) or not value.strip():
            rejected.append(str(key))
            continue
        v = value.strip()
        ok = False
        if key in ("order_date", "delivery_date"):
            try:
                date.fromisoformat(v)
                ok = True
            except ValueError:
                ok = False
        elif key == "region":
            ok = v in ALLOWED_REGION_CLASSES
        elif key == "category":
            ok = v in CATEGORIES
        elif key == "seller":
            ok = v in ("novacart", "marketplace")
        elif key == "payment_method":
            ok = v in PAYMENT_WORDS
        elif key == "condition":
            ok = v in CONDITIONS
        elif key == "reason":
            ok = v in REASONS
        elif key == "location":
            ok = len(v) <= 60
        # Never overwrite a fact the customer stated with a model guess.
        if ok and getattr(facts, key) in (None, ""):
            setattr(facts, key, v)
        elif not ok:
            rejected.append(key)
    return rejected
