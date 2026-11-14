"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./PolicyBrowser.module.css";
import { fileStates, type FileMeta } from "@/lib/cite";

// Topic areas as listed in the organizers' README.
const TOPICS: [string, string[]][] = [
  ["How the policies fit together", ["00"]],
  ["Returns and refunds", ["01", "02", "03", "04"]],
  ["Shipping", ["05", "06", "07", "21"]],
  ["Warranty", ["08", "09"]],
  ["Payments", ["10", "11"]],
  ["Offers and promo codes", ["12", "13", "14"]],
  ["Privacy", ["15", "16"]],
  ["Rules for sellers", ["17", "18"]],
  ["Special rules for some regions", ["19", "20"]],
];

const STATE_LABEL = { "in-force": "In force", superseded: "Replaced", "not-yet": "Not yet in force" } as const;

export function PolicyBrowser({ files, itemCounts }: { files: FileMeta[]; itemCounts: Record<string, number> }) {
  const [date, setDate] = useState("2026-11-14");
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const states = valid ? fileStates(files, date) : null;
  const byNum = Object.fromEntries(files.map((f) => [f.num, f]));
  const counts = states
    ? Object.values(states).reduce(
        (a, s) => ({ ...a, [s.state]: (a[s.state] ?? 0) + 1 }),
        {} as Record<string, number>,
      )
    : {};

  return (
    <>
      <div className={styles.control}>
        <label htmlFor="contact">Contact date</label>
        <input id="contact" type="date" value={date} min="2025-01-01" max="2027-12-31" onChange={(e) => setDate(e.target.value)} />
        {states && (
          <p aria-live="polite">
            {counts["in-force"] ?? 0} in force
            {counts.superseded ? `, ${counts.superseded} replaced by a later version` : ""}
            {counts["not-yet"] ? `, ${counts["not-yet"]} not yet in force` : ""}. A file applies from its effective date
            (file 00, Section 3.1).
          </p>
        )}
      </div>

      <div className={styles.groups}>
        {TOPICS.map(([topic, nums]) => (
          <section key={topic} className={styles.group}>
            <h2>{topic}</h2>
            <ul>
              {nums.map((n) => {
                const f = byNum[n];
                const st = states?.[n];
                return (
                  <li key={n} data-state={st?.state}>
                    <Link href={`/app/policies/${n}`} className={styles.row}>
                      <span className={styles.num}>{n}</span>
                      <span className={styles.title}>
                        {f.title}
                        {st?.note && <span className={styles.note}>{st.note}</span>}
                      </span>
                      <span className={styles.meta}>
                        v{f.version}, from {f.effectiveDate}
                      </span>
                      <span className={styles.meta}>{itemCounts[n]} sections</span>
                      <span className={styles.scope} data-scope={f.scope}>
                        {f.scope}
                      </span>
                      <span className={styles.state}>{st ? STATE_LABEL[st.state] : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
