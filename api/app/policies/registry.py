"""Topic and dependency registry, written from a full read of the 22 policy files.

IDs are short item IDs "NN#N.M" (file number and item). A whole section can be
named as "NN#N" and a whole file as "NN#*". The store checks every ID against the
parsed files at startup and logs any that do not exist, so this file cannot drift
silently from the policies.

- TOPICS: what a question is about -> the items that answer it, found by keyword.
- COMPETING: items that set a rule for the same thing in different files. When one
  is in the evidence, all are added, and the precedence step decides between them
  using each file's effective_date and scope (file 00, Section 4).
- REGIONAL: items that override general rules for a region (file 00, Section 4.1).
- SELLER: items that apply when the item is sold by a marketplace seller.
- INTERPRETATION: the parts of file 00 an answer needs, by what the question involves.
"""

from __future__ import annotations

TOPICS: dict[str, dict] = {
    "returns": {
        "keywords": ["return", "send back", "change of mind", "restocking", "return window", "return label",
                     "pickup fee", "exchange"],
        "sections": ["01#1.4", "01#2.1", "01#2.2", "01#2.3", "01#3.1", "01#3.2", "01#3.3", "01#3.4", "01#3.5",
                     "01#4.1", "01#4.2", "01#4.3", "01#6.1", "04#1.1", "04#2.1", "04#3.1"],
    },
    "refund_amount": {
        "keywords": ["refund", "money back", "get back"],
        "sections": ["01#5.1", "01#5.2", "01#5.3", "01#5.4", "03#2.1", "03#2.5", "12#6.1", "12#6.2"],
    },
    "refund_timing": {
        "keywords": ["when will i get", "refund time", "processing time", "how long for the refund",
                     "how long will the refund", "business days"],
        "sections": ["03#1.2", "03#3.1", "03#3.2", "03#3.3", "01#6.2", "00#1.5"],
    },
    "cancellation": {
        "keywords": ["cancel", "cancellation"],
        "sections": ["03#4.1", "03#4.2", "12#1.6", "05#3.2"],
    },
    "non_returnable": {
        "keywords": ["final sale", "non-returnable", "non returnable", "custom", "made to order", "innerwear",
                     "swimwear", "hygiene seal", "perishable"],
        "sections": ["04#1.1", "04#1.2", "04#1.3", "04#2.1", "04#2.2", "04#3.1", "04#3.2", "13#2.3", "20#6.2"],
    },
    "shipping_fees": {
        "keywords": ["shipping", "delivery fee", "free shipping", "threshold", "express", "bulky surcharge",
                     "freeship", "shipping fee"],
        "sections": ["06#1.1", "06#1.2", "06#1.3", "06#2.1", "06#2.2", "06#2.3", "06#2.4", "00#5.1", "12#5.1",
                     "12#5.2", "12#5.3"],
    },
    "delivery_times": {
        "keywords": ["delivery time", "how long will it take", "how long does delivery", "arrive", "dispatch",
                     "late", "delayed", "split", "parcels"],
        "sections": ["05#1.2", "05#2.1", "05#2.2", "05#2.3", "05#2.4", "05#2.5", "05#5.1"],
    },
    "address_tracking": {
        "keywords": ["address", "tracking", "track"],
        "sections": ["05#3.1", "05#3.2"],
    },
    "failed_delivery": {
        "keywords": ["failed delivery", "delivery attempt", "not home", "refused", "refuse"],
        "sections": ["05#4.1", "05#4.2", "11#4.1", "11#4.2"],
    },
    "damaged_wrong_defective": {
        "keywords": ["damaged", "wrong item", "defective", "photos"],
        "sections": ["07#1.1", "07#1.2", "07#1.3", "07#1.4", "07#1.5", "01#1.4", "04#3.1", "03#2.1", "03#2.3",
                     "08#5.1"],
    },
    "lost_parcel": {
        "keywords": ["lost", "lost parcel", "marked delivered", "delivered but not received"],
        "sections": ["07#2.1", "07#2.2", "07#2.3", "07#3.1", "03#2.1"],
    },
    "warranty": {
        "keywords": ["warranty", "repair", "replacement", "claim", "appeal"],
        "sections": ["08#1.1", "08#2.1", "08#2.2", "08#3.1", "08#3.2", "08#4.1", "08#4.2", "08#4.3", "08#4.4",
                     "08#4.5", "08#5.1", "09#1.1", "09#1.2", "09#2.1", "09#2.2", "09#3.1", "09#5.1", "00#1.7"],
    },
    "payments": {
        "keywords": ["payment method", "payment methods", "pay with", "pay by", "payment options", "accept",
                     "visa", "mastercard", "online banking", "jazzcash", "easypaisa", "wallet", "3-d secure",
                     "3d secure", "invoice", "currency", "conversion", "order limit", "maximum order",
                     "largest order"],
        "sections": ["10#1.1", "10#1.2", "10#2.1", "10#3.1", "10#3.2", "10#4.1", "10#5.1", "10#5.2"],
    },
    "cod": {
        "keywords": ["cod", "cash on delivery"],
        "sections": ["11#1.1", "11#1.2", "11#2.1", "11#3.1", "11#4.1", "11#4.2", "11#6.1", "10#3.2", "03#2.4",
                     "03#3.3"],
    },
    "failed_payment": {
        "keywords": ["failed payment", "charged twice", "double charged", "money taken", "payment failed"],
        "sections": ["11#5.1", "11#5.2"],
    },
    "promo_codes": {
        "keywords": ["promo", "promo code", "code", "discount", "welcome10", "style15", "tech500", "freeship"],
        "sections": ["12#1.2", "12#1.3", "12#1.5", "12#2.1", "12#2.2", "12#2.3", "12#3.1", "12#3.2", "12#3.3",
                     "12#3.4", "12#4.1", "12#4.2", "12#4.3", "00#3.2"],
    },
    "sales_bundles": {
        "keywords": ["sale", "flash sale", "bundle", "price drop", "price dropped", "cheaper"],
        "sections": ["13#1.1", "13#1.2", "13#2.1", "13#2.2", "13#2.3", "13#3.1", "13#4.1", "13#4.2", "13#4.3",
                     "13#4.4", "13#4.5", "13#4.6"],
    },
    "store_credit": {
        "keywords": ["store credit", "bonus", "expire", "expiry"],
        "sections": ["14#1.1", "14#2.1", "14#3.1", "14#3.2", "14#3.3", "14#4.1", "14#5.1", "14#5.2", "14#5.3",
                     "14#6.1", "03#3.4"],
    },
    "privacy": {
        "keywords": ["privacy", "personal data", "cookies", "marketing email", "data breach", "account locked",
                     "login", "share my data", "sell my data"],
        "sections": ["15#*"],
    },
    "data_requests": {
        "keywords": ["copy of my data", "delete my account", "delete my data", "retention", "how long do you keep",
                     "unsubscribe", "correct my data"],
        "sections": ["16#*"],
    },
    "seller_rules": {
        "keywords": ["become a seller", "sell on", "commission", "payout", "seller account", "suspended",
                     "counterfeit", "handling fee"],
        "sections": ["17#*"],
    },
    "marketplace_items": {
        "keywords": ["marketplace", "seller", "sold by"],
        "sections": ["17#6.1", "17#6.2", "18#1.1", "18#2.1", "18#2.2", "18#3.1", "18#4.1", "18#5.1", "18#6.1",
                     "00#2.6", "12#4.1", "14#5.2"],
    },
    "remote_areas": {
        "keywords": ["remote area", "remote areas", "azad jammu kashmir", "gilgit-baltistan"],
        "sections": ["19#1.1", "19#2.1", "19#2.2", "19#2.3", "00#2.2"],
    },
    "international": {
        "keywords": ["international", "customs", "export"],
        "sections": ["20#1.1", "20#2.1", "20#3.1", "20#3.2", "20#4.2", "20#5.1", "00#2.3"],
    },
    "tax": {
        "keywords": ["gst", "tax", "vat"],
        "sections": ["00#1.2", "20#3.1"],
    },
}

# Each group: the same rule set in different files. Precedence decides between them.
# "agree": the non-regional items say the same thing, so they are not a conflict.
# Rules that differ only by who sells the item (NovaCart or a marketplace seller) are
# handled by SELLER below, not here.
COMPETING: list[dict] = [
    {"topic": "return windows", "items": ["01#2.1", "02#2.1", "19#4.1", "20#6.1"]},
    {"topic": "restocking fee for electronics", "items": ["01#3.1", "02#3.1"]},
    {"topic": "restocking fee for furniture/bulky", "items": ["01#3.3", "02#3.3"]},
    {"topic": "return fees", "items": ["01#4.1", "02#4.1", "19#4.2", "20#6.3"]},
    {"topic": "paid price for a refund", "items": ["01#5.1", "02#5.1"]},
    {"topic": "refund total", "items": ["01#5.3", "02#5.3"]},
    {"topic": "standard shipping fees", "items": ["06#1.1", "21#1.1", "19#2.1", "20#4.1"]},
    {"topic": "express fee", "items": ["06#1.2", "21#1.2"]},
    {"topic": "bulky surcharge", "items": ["06#1.3", "21#1.3"]},
    {"topic": "maximum cash on delivery order", "items": ["10#3.2", "11#1.2"]},
    {"topic": "discount codes on bundle items", "items": ["12#1.5", "13#4.2"]},
    {"topic": "refund processing time", "items": ["03#3.2", "20#6.4"]},
    {"topic": "lost parcel time limit", "items": ["07#2.1", "19#3.2", "20#4.3"]},
    # 08 and 09 state the same 14-day repair time, so only the regional override matters here.
    {"topic": "warranty repair time", "items": ["08#4.1", "09#3.1", "19#5.1"], "agree": True},
    {"topic": "delivery times", "items": ["05#2.1", "19#3.1", "20#4.1"]},
]

# Region -> items that override general rules there (file 00, Section 4.1).
# Only the scope item here; the region's competing items arrive through COMPETING and
# its other items through search.
REGIONAL: dict[str, list[str]] = {
    "remote": ["19#1.1", "19#2.2"],
    "international": ["20#1.1", "20#2.1", "20#3.1", "20#3.2"],
}
REGIONAL_FILES: dict[str, str] = {"remote": "19", "international": "20"}

# Applies when an item is sold by a marketplace seller (file 00, Section 2.6).
SELLER: dict[str, list[str]] = {
    "marketplace": ["00#2.6", "17#6.1", "17#6.2", "18#1.1", "18#2.1", "18#2.2", "18#3.1", "18#4.1", "18#5.1",
                    "12#4.1", "14#5.2"],
}

# File 00 rules an answer may need. Retrieval adds the ones the question's facts call
# for; the pipeline adds the rules behind each precedence decision and calculation.
INTERPRETATION: dict[str, list[str]] = {
    "always": ["00#3.1"],
    "money": ["00#1.1", "00#1.3"],
    "dates": ["00#1.6"],
    "metro": ["00#2.1"],
    "remote": ["00#2.2"],
    "international": ["00#2.3"],
    "rest_of_pakistan": ["00#2.4"],
    "unserved": ["00#2.3"],
    "place_unknown": ["00#2.1", "00#2.2", "00#2.3", "00#2.4"],
    "category": ["00#2.5"],
    "seller": ["00#2.6"],
    "promo": ["00#3.2"],
    "checkout": ["00#5.1"],
}

# Customer phrasing -> the policies' own terms. Applied before BM25.
SYNONYMS: dict[str, str] = {
    "money back": "refund",
    "get my money": "refund",
    "reimburse": "refund",
    "arrived broken": "damaged in transit",
    "broken": "damaged",
    "cracked": "damaged",
    "smashed": "damaged",
    "not working": "defective",
    "faulty": "defective",
    "stopped working": "defective",
    "pay on delivery": "cash on delivery cod",
    "cash on delivery": "cash on delivery cod",
    "wrong product": "wrong item delivered",
    "wrong item": "wrong item delivered",
    "coupon": "promo code discount code",
    "voucher": "promo code discount code",
    "discount code": "promo code discount code",
    "guarantee": "warranty",
    "postage": "shipping fee",
    "delivery charge": "shipping fee",
    "delivery fee": "shipping fee",
    "courier fee": "shipping fee",
    "send back": "return",
    "give back": "return",
    "swap": "exchange",
    "never arrived": "lost parcel",
    "not received": "lost parcel delivered but not received",
    "missing parcel": "lost parcel",
    "changed my mind": "change of mind",
    "don't want": "change of mind",
    "dont want": "change of mind",
    "unopened": "sealed",
    "unused": "sealed unused",
    "jazz cash": "jazzcash wallet",
    "easy paisa": "easypaisa wallet",
    "credit card": "card",
    "debit card": "card",
    "wallet credit": "store credit",
    "kashmir": "azad jammu kashmir remote area",
    "ajk": "azad jammu kashmir remote area",
    "gilgit": "gilgit-baltistan remote area",
    "dubai": "uae international",
    "abroad": "international",
}
