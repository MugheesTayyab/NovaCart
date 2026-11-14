import styles from "./VersionStrip.module.css";
import type { FileMeta } from "@/lib/cite";

/*
 * Effective dates of all policy files on one axis. Files that share a date are
 * stacked. The point it makes: the policies change over time, so the date in a
 * question decides which file applies.
 */
export function VersionStrip({ files }: { files: FileMeta[] }) {
  const byDate = new Map<string, FileMeta[]>();
  for (const f of files) byDate.set(f.effectiveDate, [...(byDate.get(f.effectiveDate) ?? []), f]);
  const dates = [...byDate.keys()].sort();
  const t = (d: string) => new Date(d + "T00:00:00Z").getTime();
  const min = t(dates[0]);
  const max = t(dates[dates.length - 1]);
  const pos = (d: string) => 3 + ((t(d) - min) / (max - min)) * 94;

  return (
    <figure className={styles.strip}>
      <div className={styles.axis}>
        {dates.map((d) => (
          <div key={d} className={styles.stop} style={{ left: `${pos(d)}%` }}>
            <ul className={styles.files}>
              {byDate.get(d)!.map((f) => (
                <li key={f.num} title={f.title} className={f.scope === "regional" ? styles.regional : undefined}>
                  {f.num}
                </li>
              ))}
            </ul>
            <span className={styles.tick} />
            <span className={styles.date}>{d}</span>
          </div>
        ))}
      </div>
      <figcaption>
        Effective date of each file. Files 01 and 02 are two versions of the returns policy, and file 21 changes
        shipping fees from 2027. Regional addenda are marked in blue.
      </figcaption>
    </figure>
  );
}
