/*
 * Places where two policy files give different rules for the same thing, and how
 * file 00, Section 4 settles each one. Found by reading every file against those
 * rules; each entry cites the exact items, and the page shows their text from the
 * files themselves.
 */

export type Conflict = {
  id: string;
  topic: string;
  sides: { item: string; says: string }[];
  rule: string; // the item that decides it (a file 00 rule), or the unclear clause
  outcome: "resolved" | "unresolved" | "date-dependent" | "unclear";
  resolution: string;
};

export const CONFLICTS: Conflict[] = [
  {
    id: "cod-limit",
    topic: "Maximum order value for cash on delivery",
    sides: [
      { item: "10#3.2", says: "Rs. 40,000" },
      { item: "11#1.2", says: "Rs. 50,000" },
    ],
    rule: "00#4.4",
    outcome: "unresolved",
    resolution:
      "Both files took effect on 2026-05-01 with general scope. The files do not settle it, so the desk states both limits and says NovaCart support must confirm.",
  },
  {
    id: "bundle-codes",
    topic: "Discount codes on items in a bundle",
    sides: [
      { item: "12#1.5", says: "A code applies to eligible items, including items in a bundle." },
      { item: "13#4.2", says: "Bundle items are not eligible for any discount code." },
    ],
    rule: "00#4.3",
    outcome: "resolved",
    resolution:
      "Both took effect on 2026-06-01. File 13 has specific scope and file 12 general, so file 13 applies: no code discount on bundle items.",
  },
  {
    id: "returns-versions",
    topic: "Return windows and fees, versions 2 and 3",
    sides: [
      { item: "02#2.1", says: "Electronics 10 days, clothing 14 days (from 2025-06-01)." },
      { item: "01#2.1", says: "Electronics 7 days, clothing 30 days (from 2026-03-01)." },
    ],
    rule: "00#4.2",
    outcome: "date-dependent",
    resolution:
      "Same topic and scope, different effective dates. From 2026-03-01 file 01 applies and the reply says the files differ. Before that date only file 02 is in force.",
  },
  {
    id: "shipping-2027",
    topic: "Standard shipping fees from 2027",
    sides: [
      { item: "06#1.1", says: "Metro Rs. 250, free from Rs. 5,000. Rest of Pakistan Rs. 350, free from Rs. 7,500." },
      { item: "21#1.1", says: "Metro Rs. 300, free from Rs. 6,000. Rest of Pakistan Rs. 400, free from Rs. 8,500." },
    ],
    rule: "00#3.1",
    outcome: "date-dependent",
    resolution:
      "File 21 is not in force until 2027-02-01, even though it was last updated in 2026. Questions dated before then use file 06; from then on file 21 replaces the fee table.",
  },
  {
    id: "remote-windows",
    topic: "Return windows in Remote areas",
    sides: [
      { item: "01#2.1", says: "Electronics 7 days, clothing 30 days, personal care 14 days." },
      { item: "19#4.1", says: "Electronics 10 days, clothing 33 days, personal care 17 days." },
    ],
    rule: "00#4.1",
    outcome: "resolved",
    resolution:
      "File 19 has regional scope, so it overrides file 01 for Remote areas whatever the dates. Topics file 19 does not mention still follow file 01.",
  },
  {
    id: "cod-credit-bonus",
    topic: "Store credit bonus on a cash on delivery refund",
    sides: [
      { item: "03#3.3", says: "COD orders are refunded by bank transfer or store credit, never cash." },
      { item: "14#3.1", says: "The 5% bonus is for choosing credit instead of a refund to the original payment method." },
    ],
    rule: "14#3.1",
    outcome: "unclear",
    resolution:
      "Not a direct contradiction. The files do not say whether choosing store credit on a COD refund counts as choosing it instead of the original method, so the desk explains both readings rather than promising the bonus.",
  },
];

export const OUTCOME_LABEL: Record<Conflict["outcome"], string> = {
  resolved: "Settled by file 00",
  "date-dependent": "Depends on the date",
  unresolved: "Not settled by the files",
  unclear: "Wording unclear",
};
