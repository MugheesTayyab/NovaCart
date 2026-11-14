"""Rule values the calculators need, each tied to the item it comes from.

Written from the policy files and checked by hand. Which version applies is decided
at request time from each file's effective_date in its front matter (file 00,
Sections 3 and 4), never from the values here. Promo codes are not listed here:
they are read from file 12's table at startup.
"""

from __future__ import annotations

# ---------- returns ----------

# Return windows in days from delivery. None = not returnable for change of mind.
RETURN_WINDOWS = {
    "01": {  # returns policy v3
        "source": "01#2.1",
        "days": {"electronics": 7, "clothing": 30, "furniture/bulky": 14, "personal care": 14,
                 "grocery/perishables": None},
    },
    "02": {  # returns policy v2
        "source": "02#2.1",
        "days": {"electronics": 10, "clothing": 14, "furniture/bulky": 14, "personal care": 14,
                 "grocery/perishables": None},
    },
}
REMOTE_RETURN_WINDOWS = {  # 19 §4.1: three days longer; bulky and grocery are not delivered there (19 §2.2)
    "source": "19#4.1",
    "days": {"electronics": 10, "clothing": 33, "personal care": 17},
}
INTERNATIONAL_RETURN_WINDOW = {"source": "20#6.1", "days": 10,
                               "categories": ("electronics", "clothing", "personal care")}
INTERNATIONAL_NO_CHANGE_OF_MIND = {"source": "20#6.2", "categories": ("personal care",)}

# Restocking fee as a percent of the paid price, for non-defective returns.
RESTOCKING = {
    "01": {"electronics": (15, "01#3.1"), "furniture/bulky": (10, "01#3.3")},  # opened electronics only
    "02": {"electronics": (10, "02#3.1"), "furniture/bulky": (10, "02#3.3")},
}
NO_RESTOCKING_ON_ERROR = {"01": "01#3.5", "02": "02#3.5"}
NO_RESTOCKING = {  # categories with no restocking fee
    "01": {"clothing": "01#3.2", "personal care": "01#3.4"},
    "02": {"clothing": "02#3.2", "personal care": "02#3.4"},
}

# One return fee per request: pickup fee if any bulky item, otherwise the label fee.
RETURN_FEES = {
    "01": {"label": 200, "pickup": 2000, "source": "01#4.1", "error_source": "01#4.2"},
    "02": {"label": 150, "pickup": 1500, "source": "02#4.1", "error_source": "02#4.2"},
}
REMOTE_RETURN_LABEL = {"label": 400, "source": "19#4.2"}
INTERNATIONAL_RETURN_COSTS = {"source": "20#6.3"}  # customer pays shipping, no label fee, restocking applies

NON_RETURNABLE = {
    "grocery/perishables": "04#1.1",
    "opened personal care": "04#1.2",
    "final sale": "04#2.1",
    "custom furniture": "04#2.2",
}

# ---------- shipping (file 00, Section 5.1 sets the order of steps) ----------

SHIPPING = {
    "06": {
        "source": "06#1.1",
        "metro": {"fee": 250, "free_from": 5000},
        "rest_of_pakistan": {"fee": 350, "free_from": 7500},
        "express": (500, "06#1.2"),
        "bulky": ({"metro": 1500, "rest_of_pakistan": 2500}, "06#1.3"),
    },
    "21": {
        "source": "21#1.1",
        "metro": {"fee": 300, "free_from": 6000},
        "rest_of_pakistan": {"fee": 400, "free_from": 8500},
        "express": (600, "21#1.2"),
        "bulky": ({"metro": 1800, "rest_of_pakistan": 3000}, "21#1.3"),
    },
}
REMOTE_SHIPPING = {"fee": 600, "free_from": 12000, "source": "19#2.1"}
INTERNATIONAL_SHIPPING = {"UAE": 3500, "UK": 5500, "USA": 6500, "source": "20#4.1"}
INTERNATIONAL_EXPORT_PRICE = {"divisor": "1.18", "source": "20#3.1"}
COD_FEE = {"fee": 100, "source": "11#2.1"}
COD_REGIONS = {"regions": ("metro", "rest_of_pakistan"), "source": "11#1.1"}
COD_LIMITS = [(40000, "10#3.2"), (50000, "11#1.2")]  # same date, same scope: unresolved (00 §4.4)
EXPRESS_RULES = {"metro_only": "05#2.2", "replaces_standard": "06#2.3"}
FREESHIP_RULES = {"removes": "12#5.1", "regions": "12#5.2", "minimum": "12#5.3"}
GROCERY_METRO_ONLY = "05#2.5"

# ---------- promo codes ----------

ONE_DISCOUNT_CODE = "12#1.2"
CODE_VALIDITY = "12#1.3"
ELIGIBLE_SUBTOTAL = "12#3.1"
PERCENT_DISCOUNT = "12#3.2"
FLAT_DISCOUNT = "12#3.3"
MINIMUM_CHECK = "12#3.4"
NO_CODES_MARKETPLACE = "12#4.1"
NO_CODES_FINAL_SALE = "12#4.2"
NO_CODES_BUNDLES = "13#4.2"
WELCOME10_FIRST_ORDER = "12#2.2"
DISCOUNT_SPLIT = "12#6.1"
DISCOUNT_SPLIT_REMAINDER = "12#6.2"
PAID_PRICE = {"01": "01#5.1", "02": "02#5.1"}
REFUND_ITEM = {"01": "01#5.2", "02": "02#5.2"}
REFUND_TOTAL = {"01": "01#5.3", "02": "02#5.3"}

# ---------- other ----------

STORE_CREDIT_BONUS = {"percent": 5, "cap": 1000, "source": "14#3.1"}
WARRANTY_MONTHS = {"electronics": 12, "accessory": 6, "furniture/bulky": 24, "source": "08#2.1",
                   "prorata": "08#4.3", "full_months": "00#1.7"}
ACCESSORY_WORDS = ("charger", "cable", "adapter", "accessory", "case", "cover")
