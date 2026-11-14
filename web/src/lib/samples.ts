import type { AskResponse } from "./contract";

/*
 * Sample questions with answers worked out by hand from the policy files.
 * They are shown in preview mode (no answer API configured) and double as
 * expected outputs for the evaluation set. Every figure and citation here was
 * checked against /policies. Do not edit a number without re-checking the file.
 */

export type Sample = {
  id: string;
  label: string;
  question: string;
  response: AskResponse;
  /** Replies to the clarifying question, keyed by the value the customer picks. */
  followUps?: { value: string; response: AskResponse }[];
};

const followUp = (
  answer: string,
  sources: [string, string][],
  region: string,
  rule: { rule: string; reason: string },
): AskResponse => ({
  status: "answered",
  answer,
  sources: sources.map(([file, section]) => ({ file, section })),
  calculation: [],
  rule_order: [rule],
  clarifying_question: null,
  not_covered_parts: [],
  meta: {
    preview: true,
    contact_date: "2026-08-12",
    slots: { region, category: "Electronics", "delivery date": "2026-08-03", condition: "Sealed", reason: "Change of mind" },
  },
});

export const SAMPLES: Sample[] = [
  {
    id: "partial-return-promo",
    label: "Partial return with a promo code",
    question:
      "I ordered a shirt (Rs. 2,400) and trousers (Rs. 3,600) on 2026-06-28 with code STYLE15 and paid by card. They were delivered to Lahore on 2026-07-01. Today is 2026-07-10 and I want to return the shirt. It's unworn with the tags on. How much do I get back?",
    response: {
      status: "answered",
      // Two lines, as the system prompt requires. The working is in the calculation below.
      answer: [
        "Yes, you can return the shirt until 2026-07-31 and get Rs. 1,840 [file 01, Section 2.1]: paid Rs. 2,040 after its Rs. 360 share of STYLE15 [file 12, Section 6.1]; no restocking fee [file 01, Section 3.2]; minus the Rs. 200 return label fee [file 01, Section 4.1].",
        "It goes back to your card within 7 business days of passing inspection [file 03, Section 3.2], or you can take Rs. 1,932 in store credit with the 5% bonus [file 14, Section 3.1].",
      ].join("\n"),
      sources: [
        { file: "01", section: "2.1" },
        { file: "12", section: "6.1" },
        { file: "01", section: "3.2" },
        { file: "01", section: "4.1" },
        { file: "01", section: "5.3" },
        { file: "03", section: "2.1" },
        { file: "06", section: "1.1" },
        { file: "03", section: "3.2" },
        { file: "14", section: "3.1" },
      ],
      calculation: [
        { label: "Eligible subtotal", formula: "2,400 + 3,600", result: "6,000", rule: "12#3.1" },
        { label: "STYLE15 discount", formula: "15% of 6,000, cap 1,500", result: "900", rule: "12#3.2" },
        { label: "Shirt's share of discount", formula: "900 × 2,400 ÷ 6,000", result: "360", rule: "12#6.1" },
        { label: "Shirt paid price", formula: "2,400 − 360", result: "2,040", rule: "01#5.1" },
        { label: "Restocking fee, clothing", result: "0", rule: "01#3.2" },
        { label: "Return label fee", result: "−200", rule: "01#4.1" },
        { label: "Refund to card", formula: "2,040 − 0 − 200", result: "1,840", rule: "01#5.3" },
      ],
      rule_order: [
        {
          rule: "00#4.2",
          reason:
            "Files 01 and 02 both cover returns with general scope. File 01 has the later effective date and is in force on 2026-07-10, so it applies.",
        },
        { rule: "12#1.3", reason: "STYLE15 was valid: ordered 2026-06-28, before its last order date of 2026-08-31." },
        {
          rule: "12#6.1",
          reason: "The discount is split across items first, because the refund starts from the item's paid price (file 01, Section 5.1).",
        },
        { rule: "01#5.2", reason: "Any restocking fee comes off the item's paid price. Clothing has none." },
        { rule: "01#5.3", reason: "One return fee comes off the refund total, once per request." },
        { rule: "03#2.1", reason: "The shipping fee is kept on a partial return." },
      ],
      clarifying_question: null,
      not_covered_parts: [],
      meta: {
        preview: true,
        contact_date: "2026-07-10",
        slots: {
          region: "Lahore, a Metro city",
          category: "Clothing",
          "order date": "2026-06-28",
          "delivery date": "2026-07-01",
          payment: "Card",
          "promo code": "STYLE15",
        },
        notices: [
          "Two returns policies exist. File 01 (version 3, from 2026-03-01) and file 02 (version 2, from 2025-06-01) set different windows and fees. File 01 was used because it has the later effective date [file 00, Section 4.2].",
        ],
      },
    },
  },
  {
    id: "return-window-region",
    label: "Return window, region missing",
    question:
      "Today is 2026-08-12. My headphones were delivered on 2026-08-03 and I've changed my mind. They're still sealed. Can I return them?",
    response: {
      status: "needs_info",
      answer: "Which city or country were the headphones delivered to?",
      sources: [
        { file: "01", section: "2.1" },
        { file: "19", section: "4.1" },
        { file: "20", section: "6.1" },
      ],
      calculation: [],
      rule_order: [
        { rule: "00#4.2", reason: "File 01 (version 3) is the returns policy in force on 2026-08-12." },
        {
          rule: "00#4.1",
          reason: "The Remote areas and International addenda override file 01 for their regions, so the region changes the window.",
        },
      ],
      clarifying_question: "Which city or country were the headphones delivered to?",
      not_covered_parts: [],
      meta: {
        preview: true,
        contact_date: "2026-08-12",
        slots: {
          region: null,
          category: "Electronics",
          "delivery date": "2026-08-03",
          condition: "Sealed",
          reason: "Change of mind",
        },
        slot_test: {
          slot: "region",
          outcomes: [
            { value: "Metro city or Rest of Pakistan", outcome: "7-day window ended 2026-08-10. Not returnable.", rule: "01#2.1" },
            { value: "Remote area", outcome: "10-day window ends 2026-08-13. Returnable.", rule: "19#4.1" },
            { value: "International", outcome: "10-day window ends 2026-08-13. Returnable.", rule: "20#6.1" },
          ],
        },
      },
    },
    followUps: [
      {
        value: "Metro city or Rest of Pakistan",
        response: followUp(
          "No, the 7-day electronics window ended on 2026-08-10, so a change-of-mind return is no longer accepted [file 01, Section 2.1].\nIf the headphones turn out to be defective, the 12-month electronics warranty still covers them [file 08, Section 2.1].",
          [
            ["01", "2.1"],
            ["08", "2.1"],
          ],
          "Metro city or Rest of Pakistan",
          { rule: "01#2.1", reason: "No regional addendum covers this region, so the general window of 7 days applies." },
        ),
      },
      {
        value: "Remote area",
        response: followUp(
          "Yes, Remote areas get a 10-day electronics window, so you can return them until 2026-08-13 [file 19, Section 4.1].\nSealed electronics have no restocking fee [file 01, Section 3.1]; the Remote return label fee is Rs. 400 [file 19, Section 4.2].",
          [
            ["19", "4.1"],
            ["01", "3.1"],
            ["19", "4.2"],
          ],
          "Remote area",
          { rule: "00#4.1", reason: "File 19 is regional and overrides file 01's window and label fee for Remote areas." },
        ),
      },
      {
        value: "International",
        response: followUp(
          "Yes, international orders get a 10-day window, so you can return them until 2026-08-13 [file 20, Section 6.1].\nYou arrange and pay the return shipping with no label fee, and sealed electronics have no restocking fee [file 20, Section 6.3][file 01, Section 3.1].",
          [
            ["20", "6.1"],
            ["20", "6.3"],
            ["01", "3.1"],
          ],
          "International",
          { rule: "00#4.1", reason: "File 20 is regional and overrides file 01's window and return costs for international orders." },
        ),
      },
    ],
  },
  {
    id: "gift-card-cod-fee",
    label: "One part covered, one not",
    question: "Today is 2026-09-01. Can I pay with a gift card, and how much is the cash on delivery fee?",
    response: {
      status: "partial",
      answer: [
        "Cash on delivery costs Rs. 100 per order, in Metro cities and the Rest of Pakistan only [file 11, Section 2.1][file 11, Section 1.1].",
        "Gift cards: this is not covered in the supplied NovaCart policies, which list cards, online banking, JazzCash, Easypaisa, cash on delivery and store credit [file 10, Section 1.1].",
      ].join("\n"),
      sources: [
        { file: "11", section: "2.1" },
        { file: "11", section: "1.1" },
        { file: "10", section: "1.1" },
      ],
      calculation: [],
      rule_order: [],
      clarifying_question: null,
      not_covered_parts: ["Paying with a gift card"],
      meta: { preview: true, contact_date: "2026-09-01", slots: { payment: "Gift card, cash on delivery" } },
    },
  },
  {
    id: "cod-limit-conflict",
    label: "Two files disagree",
    question: "Today is 2026-09-01. What is the largest order I can pay for with cash on delivery?",
    response: {
      status: "conflict",
      answer: [
        "The files disagree: one sets the cash on delivery maximum at Rs. 40,000 [file 10, Section 3.2] and another at Rs. 50,000 [file 11, Section 1.2], so NovaCart support must confirm [file 00, Section 4.4].",
        "An order up to Rs. 40,000 is within both limits; orders above Rs. 20,000 are verified by phone first [file 11, Section 3.1].",
      ].join("\n"),
      sources: [
        { file: "10", section: "3.2" },
        { file: "11", section: "1.2" },
        { file: "00", section: "4.4" },
        { file: "11", section: "3.1" },
      ],
      calculation: [],
      rule_order: [
        {
          rule: "00#4.4",
          reason: "Same effective date (2026-05-01), same scope (general), different rules. The files do not decide, so both are shown.",
        },
      ],
      clarifying_question: null,
      not_covered_parts: [],
      meta: { preview: true, contact_date: "2026-09-01", slots: { payment: "Cash on delivery" } },
    },
  },
];

export function findSample(question: string) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return SAMPLES.find((s) => norm(s.question) === norm(question));
}
