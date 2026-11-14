import Link from "next/link";
import styles from "./PolicyBlocks.module.css";
import type { Block } from "@/lib/policies";
import { splitCitations } from "@/lib/cite";

/** Inline text with "[file NN, Section X]" cross-references turned into links. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {splitCitations(text).map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text.replace(/\*\*/g, "")}</span>
        ) : (
          <Link key={i} className={styles.xref} href={`/app/policies/${s.file}${s.section ? `#s${s.section}` : ""}`}>
            {s.raw.slice(1, -1)}
          </Link>
        ),
      )}
    </>
  );
}

/** Renders one policy item exactly as written in the file: text, tables, lists. */
export function PolicyBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className={styles.blocks}>
      {blocks.map((b, i) => {
        if (b.kind === "text")
          return (
            <p key={i}>
              <Inline text={b.text} />
            </p>
          );
        if (b.kind === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={styles.list}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <div key={i} className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>
                        <Inline text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
