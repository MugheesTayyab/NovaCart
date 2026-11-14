import Link from "next/link";
import type { Metadata } from "next";
import shell from "../app.module.css";
import styles from "./conflicts.module.css";
import { PolicyBlocks } from "@/components/PolicyBlocks";
import { CONFLICTS, OUTCOME_LABEL } from "@/lib/conflicts";
import { getItem } from "@/lib/policies";

export const metadata: Metadata = { title: "Conflicts" };

function Ref({ id }: { id: string }) {
  const [f, s] = id.split("#");
  const hit = getItem(id);
  return (
    <Link href={`/app/policies/${f}#s${s}`} className={styles.ref}>
      {hit ? `${hit.file.fileName}, Section ${s}` : id}
    </Link>
  );
}

export default function ConflictsPage() {
  return (
    <div className={shell.page}>
      <header className={shell.pageHead}>
        <h1>Conflicts</h1>
        <p>
          Where two NovaCart files give different rules for the same thing, and which rule in{" "}
          <Link href="/app/policies/00#s4.1">file 00, Section 4</Link> decides it. The desk applies these decisions and
          tells the customer when the files differ.
        </p>
      </header>

      <ol className={styles.list}>
        {CONFLICTS.map((c) => (
          <li key={c.id} className={styles.conflict}>
            <div className={styles.top}>
              <h2>{c.topic}</h2>
              <span className={styles.outcome} data-outcome={c.outcome}>
                {OUTCOME_LABEL[c.outcome]}
              </span>
            </div>
            <div className={styles.sides}>
              {c.sides.map((s) => {
                const hit = getItem(s.item);
                return (
                  <div key={s.item} className={styles.side}>
                    <Ref id={s.item} />
                    <p className={styles.says}>{s.says}</p>
                    {hit && (
                      <details>
                        <summary>Full text</summary>
                        <PolicyBlocks blocks={hit.item.blocks} />
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
            <p className={styles.resolution}>
              <Ref id={c.rule} /> {c.resolution}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
