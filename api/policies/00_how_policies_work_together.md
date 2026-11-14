---
doc_id: NC-POL-00
title: How NovaCart Policies Work Together
version: 1.0
effective_date: 2026-01-01
last_updated: 2025-12-15
scope: general
---

# How NovaCart Policies Work Together

NovaCart is a fictional online store created for the Tech Fusion '26 AI Hackathon. Every policy, price, fee and date in these files is invented. This file explains the conventions that all other policy files use.

## 1. Conventions

**1.1** Currency. All amounts are in Pakistani Rupees (PKR), written "Rs.". Amounts are whole rupees.

**1.2** Tax. Listed prices include 18% GST. The GST contained in a GST-inclusive price is the price multiplied by 18 and divided by 118, rounded half up. GST is not shown separately unless a file says so.

**1.3** Rounding. When a rule produces an amount that is not a whole rupee (a percentage discount, a restocking fee, a proportional share), the amount is rounded half up to the nearest whole rupee at the moment it is computed. Decimals are never carried into a later step.

**1.4** Dates. Dates are written YYYY-MM-DD.

**1.5** Business days. Business days are Monday to Friday. Public holidays are not excluded. Counting starts on the first business day after the event.

**1.6** Days from delivery. A time limit of N days from delivery ends on the delivery date plus N calendar days. A request made on that last day is in time.

**1.7** Full months. Full months elapsed from date A to date B are counted in whole calendar months. A month is complete on the same day of the month as date A. If the later month has no such day, it is complete on the last day of that month. Example: from 2026-01-10 to 2026-04-09 is 2 full months, and from 2026-01-10 to 2026-04-10 is 3 full months.

**1.8** Contact date. The contact date is the day the customer asks a question or submits a request.

## 2. Regions, categories and sellers

**2.1** Metro cities are Islamabad, Lahore and Karachi. Only these three cities are Metro cities.

**2.2** Remote areas are Azad Jammu & Kashmir and Gilgit-Baltistan.

**2.3** International means delivery to the USA, the UK or the UAE. No other country is served.

**2.4** Rest of Pakistan means every place in Pakistan that is not a Metro city and not a Remote area.

**2.5** Every item belongs to exactly one category: electronics, clothing, grocery/perishables, furniture/bulky, or personal care. A bulky item is any item in the furniture/bulky category.

**2.6** Items are either "Sold by NovaCart" or sold by a marketplace seller (see [file 17, Section 1]). Files that do not mention marketplace items apply to items Sold by NovaCart only.

## 3. Which version of a policy is in force

**3.1** Every file has an effective_date in its front matter. A file is in force on a contact date if its effective_date is on or before that date. A file whose effective_date is after the contact date is not yet in force and is not applied.

**3.2** The contact date decides which file applies. The only exception is the validity of a promo code, which depends on the order date (see [file 12, Section 1]).

## 4. When two files disagree

**4.1** A file with scope "regional" overrides files with scope "general" or "specific" for the region it covers and for the topics it covers, whatever the dates. Topics a regional file does not mention follow the other files.

**4.2** If two files in force cover the same topic with the same scope and have different effective dates, the file with the later effective_date applies. The customer must be told that the files differ and which one was used.

**4.3** If two files in force have the same effective_date and different scope values, the file with the more specific scope applies. From least to most specific the order is: general, specific, regional.

**4.4** If two files in force have the same effective_date, the same scope and different rules for the same topic, the files do not settle the question. The customer must be told what each file says and that NovaCart support must confirm.

**4.5** Dates and scope are read only from the front matter of each file.

## 5. Order of calculation for checkout totals

**5.1** Totals are worked out in this order:

1. Item prices: the sale price where an item is on sale, or the bundle price for a bundle (see [file 13, Section 1]).
2. Merchandise subtotal: the sum of the item prices.
3. Discount code: calculated on the eligible subtotal (see [file 12, Section 3]).
4. Subtotal after discount: the merchandise subtotal minus the discount.
5. Standard shipping fee: decided using the subtotal after discount (see [file 06, Section 2]).
6. Extra charges: express fee, bulky surcharges and the COD fee. These are never discounted and never count toward free-shipping thresholds.
7. Total payable: the subtotal after discount plus the shipping fee plus the extra charges.

**5.2** The FREESHIP code works at step 5 (see [file 12, Section 5]).

**5.3** Refunds are worked out under [file 01, Section 5] and [file 03].

## 6. How the policy files are organised

**6.1** Each file is named NN_topic.md. The number NN is also the last part of the doc_id (NC-POL-NN).

**6.2** Each file starts with front matter holding doc_id, title, version, effective_date, last_updated and scope.

**6.3** Rules are numbered by section and item. Section 3.2 of a file means item 3.2 under heading 3. Answers should cite the file name and the item number.

**6.4** Cross-references are written as [file NN, Section X].
