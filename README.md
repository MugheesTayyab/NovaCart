# Policy Desk for NovaCart

A customer-support assistant that answers from NovaCart's 22 policy files only, cites the file and section behind every line, works out money and dates in code, and says so when the files do not cover a question.

| Part | Folder | What it is |
| --- | --- | --- |
| Answer service | `api/` | FastAPI. Local BM25 retrieval, policy precedence and calculations in code, one streamed LLM call per answer |
| Web UI | `web/` | Next.js. Marketing site at `/`, the desk at `/app` (see `web/README.md`) |
| Policies | `policies/` | The organizers' 22 files, read as they are and never edited |

## Run

1. Copy `.env.example` to `.env` and fill in `PRIMARY_LLM_API_KEY` (and optionally `FALLBACK_LLM_API_KEY`).
2. `docker compose up --build`, then open http://localhost:3000.

Without Docker: `cd api && pip install -r requirements.txt && uvicorn app.main:app --port 8000`, and `cd web && npm install && npm run dev` with `NEXT_PUBLIC_API_URL=http://localhost:8000` in `web/.env.local`.

## Environment variables

All configuration is read from the environment once at startup; `.env.example` lists every variable with a comment. Required: `PRIMARY_LLM_API_KEY` and `PRIMARY_LLM_MODEL` (plus `PRIMARY_LLM_PROVIDER` or `PRIMARY_LLM_BASE_URL`). If they are missing the service still starts, `/health` reports the problem and chat replies that the service is not configured. The fallback provider is optional; without it the service logs one warning and runs on the primary alone. Keys are never logged and `.env` is git-ignored.

## How an answer is produced

1. **Facts.** Dates, amounts, items, promo codes, city or country, category, seller, payment method and condition are read from the message with deterministic parsers and kept per session (last `CHAT_HISTORY_TURNS` turns, idle sessions expire). The contact date is the date the customer states, otherwise today in `APP_TIMEZONE`.
2. **Retrieval** (`api/app/retrieval.py`). BM25 over every numbered item (title + heading + text), top 6, then a deterministic expansion: topic registry, regional and marketplace rules, one level of cross-references with cycle detection, every competing version of a rule, and the file 00 rules the facts call for. The top 6 is where search starts, not a cap on required evidence.
3. **Precedence** (`api/app/precedence.py`). Applies file 00: a file counts only from its `effective_date`; a regional addendum overrides for its region and topics; same scope, later date wins and the customer is told the files differ; same date, more specific scope wins; same date and scope is unresolved and both rules are shown. Dates and scope come only from each file's front matter.
4. **Calculation** (`api/app/calc.py`). Decimal arithmetic in whole rupees, rounded half up at each step; checkout order from file 00 Section 5; promo eligibility, minimums, caps and proportional splits; return windows, restocking and return fees; shipping thresholds; export prices; warranty pro-rata with full calendar months. If an input is missing the handler asks for it instead of producing a number.
5. **One model call** through the gateway, with the facts, recent turns, evidence (with source tags), precedence decisions and calculation. The model copies numbers, cites the supplied tags, asks one question when a missing fact would change the answer, and says "this is not covered" when the files do not answer. Citations are checked against the supplied evidence after generation; any other citation is replaced and logged. A hidden JSON line at the end carries status and fact updates, which are validated before use and never shown.

If the evidence for a question would exceed `LLM_MAX_INPUT_TOKENS`, the service asks the customer to narrow the question instead of dropping rules.

## LLM gateway (`api/app/gateway.py`)

All model calls go through one module. Primary first, fallback only on failure; a successful answer is exactly one call. Failover happens on 429, 5xx, timeouts, connection errors, 401/403 and model-not-found, and only before the first token is streamed. A 400 caused by our own request is logged and not retried. `Retry-After` is honoured, otherwise exponential backoff with jitter up to `LLM_MAX_RETRIES`; if waiting would exceed the request timeout it goes straight to the fallback. A semaphore (`LLM_MAX_CONCURRENT_REQUESTS`) queues bursts, and after 3 consecutive primary failures a circuit breaker routes to the fallback for 60 seconds. If both providers fail, the reply lists the policy sections that cover the question and any calculated result. Both providers are OpenAI-compatible endpoints, so either can be swapped by configuration.

## Policy index

Built automatically at startup from `POLICY_DIR` (default `policies/`). Each file's front matter is parsed (a missing or malformed field is logged and left unknown), the text is split into numbered items with their tables and lists, cross-references are resolved (unresolved ones are logged), and a BM25 index is built. The parsed corpus is cached in `INDEX_CACHE_DIR` under a hash of the files, so it is rebuilt only when a policy file changes. Text that no numbered item owns, and lines addressed to AI systems rather than customers, are kept out of the evidence and logged. Chat requests that arrive while the index is loading get a short "starting up" reply.

`GET /health` reports service status, policies loaded and corpus hash, index readiness, whether the primary and fallback are configured, and the circuit-breaker state. No secrets.

---

# NovaCart Policy Knowledge Base

**Tech Fusion '26 · AI Hackathon · Challenge A: Policy Q&A Bot**
Bahria University Islamabad · 14 November 2026 · Organised by the AI Club

This repository holds the complete knowledge base for Challenge A. It contains the policy files of **NovaCart**, a fictional online store, and nothing else. The problem statement, the submission and the leaderboard are handled on the **ETL** platform.

---
## Repository layout
```
novacart-policy-bot/
├── README.md        this file
├── .gitignore       keeps secrets such as .env out of your repository
└── policies/        the knowledge base: 22 policy files (00 to 21)
```
Your bot's code, your own tests and your own documents are added by your team in your own repository. The `policies/` folder is the only knowledge your bot may use.

---

## The policy files

There are 22 Markdown files, named `NN_topic.md`. The number `NN` is part of each file's identity and is used when citing.

**Start with file 00.** It explains the conventions the other files rely on: currency and tax, rounding, how days and months are counted, the regions and product categories, the order in which a checkout total is calculated, which version of a policy is in force on a given date, and what to do when two files do not agree. Treat file 00 as the single source of truth for these points.

### Coverage by topic

| Topic area | Files |
| --- | --- |
| How the policies fit together | 00 |
| Returns and refunds | 01, 02, 03, 04 |
| Shipping | 05, 06, 07, 21 |
| Warranty | 08, 09 |
| Payments | 10, 11 |
| Offers and promo codes | 12, 13, 14 |
| Privacy | 15, 16 |
| Rules for sellers | 17, 18 |
| Special rules for some regions | 19, 20 |

### File index

| # | File | What it covers |
| --- | --- | --- |
| 00 | `00_how_policies_work_together.md` | Conventions, regions, categories, versions, precedence, calculation order |
| 01 | `01_returns_policy.md` | Returns policy, version 3: windows, conditions, return fees, refund amount |
| 02 | `02_returns_policy_2025.md` | Returns policy, version 2 (2025 edition) |
| 03 | `03_refunds_policy.md` | Which fees are refunded, refund methods and timing, cancellations |
| 04 | `04_non_returnable_items.md` | Items that cannot be returned, and the exceptions |
| 05 | `05_shipping_policy.md` | Dispatch, delivery times, express and bulky delivery, failed deliveries |
| 06 | `06_shipping_fees_and_free_shipping.md` | Shipping fees, free-shipping thresholds, surcharges |
| 07 | `07_lost_or_damaged_deliveries.md` | Damaged, wrong, defective and lost deliveries |
| 08 | `08_warranty_policy.md` | Warranty periods, coverage, remedies |
| 09 | `09_warranty_claims.md` | How to claim, costs, repair time, appeals |
| 10 | `10_payments.md` | Payment methods, security, order limits |
| 11 | `11_cod_and_failed_payments.md` | Cash on delivery, COD fee, failed payments |
| 12 | `12_promo_code_rules.md` | Promo codes, eligibility, discount calculation, splitting a discount |
| 13 | `13_sales_and_bundles.md` | Sale prices, flash sales, Final Sale, bundle deals |
| 14 | `14_store_credit.md` | Store credit, bonus, expiry, mixed payments |
| 15 | `15_privacy_policy.md` | Data collected, use, sharing, cookies, security |
| 16 | `16_data_requests_and_retention.md` | Data requests, deletion, retention periods |
| 17 | `17_seller_marketplace_rules.md` | Seller eligibility, commission, payout, dispatch |
| 18 | `18_seller_return_obligations.md` | Marketplace returns, seller warranty, penalties |
| 19 | `19_remote_areas_addendum.md` | Fees, delivery, returns and warranty for Remote areas |
| 20 | `20_international_addendum.md` | Pricing, fees, returns and warranty for international orders |
| 21 | `21_shipping_fee_update_2027.md` | Shipping fee update announced for 2027 |

---

## File format

### Front matter

Every file starts with a block of metadata between two `---` lines:

```yaml
---
doc_id: NC-POL-06
title: Shipping Fees and Free Shipping
version: 2.0
effective_date: 2026-01-15
last_updated: 2026-01-05
scope: general
---
```

| Field | Meaning |
| --- | --- |
| `doc_id` | `NC-POL-` followed by the file number |
| `title` | Human-readable title |
| `version` | Version of that policy |
| `effective_date` | The date from which the file is in force (`YYYY-MM-DD`) |
| `last_updated` | The date the text was last edited |
| `scope` | `general`, `specific` or `regional`, as used by the rules in file 00 |

### Numbered sections

Each file has numbered headings (`## 3. Refund method and timing`) and numbered items (`**3.2** ...`). Items are the unit your bot should cite. A good citation names the file and the item, for example:

> `06_shipping_fees_and_free_shipping.md`, Section 2.2

Some items contain tables. A table belongs to the item that introduces it.

### Cross-references

When a file points to another one, it uses the form `[file NN, Section X]`. All cross-references point to files and sections that exist.

---

## Conventions at a glance

These are explained in full in file 00.

- Currency is PKR ("Rs."), in whole rupees. Listed prices include 18% GST.
- Amounts that are not whole rupees are rounded half up when they are computed.
- Dates are `YYYY-MM-DD`.
- Every question your bot is tested on states its own dates. Do not use the system clock.

---

## Ground rules for participants

1. The files in `policies/` are the only knowledge base. Do not add outside knowledge about real stores, laws or products.
2. Do not edit, rename or delete the policy files. Evaluation uses the original files, so changes in your copy will not be honoured.
3. You are free to read, split, index, embed or otherwise process the files in any way you like.
4. There are no sample questions or answers in this repository. Design your own tests.
5. Submission, the problem statement and the leaderboard are on ETL.

---

## Getting started

Teams clone this repository at kickoff and push it to a fresh repository created at kickoff.

```bash
git clone <organizer-repo-url> novacart-policy-bot
cd novacart-policy-bot
git remote set-url origin <your-new-repo-url>
git push -u origin main
```

Keep API keys in a `.env` file. It is already listed in `.gitignore`, so it will not be committed.

---

*Tech Fusion '26 · Innovate · Integrate · Inspire*
