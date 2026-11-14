import Link from "next/link";
import styles from "./AnswerText.module.css";
import { refId, shortRef, splitCitations } from "@/lib/cite";

/*
 * Renders answer text with each "[file NN, Section X]" turned into a source chip.
 * With onCite the chip opens the passage in place; without it, it links to the
 * policy library.
 */
export function AnswerText({
  text,
  onCite,
  active,
}: {
  text: string;
  onCite?: (id: string) => void;
  active?: string | null;
}) {
  return (
    <div className={styles.answer}>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {splitCitations(para).map((seg, j) => {
            if (seg.kind === "text") return <span key={j}>{seg.text}</span>;
            const id = refId(seg.file, seg.section);
            const label = shortRef(id);
            const cls = `${styles.chip} ${active === id ? styles.active : ""}`;
            return onCite ? (
              <button key={j} type="button" className={cls} onClick={() => onCite(id)} aria-label={`Show source ${label}`}>
                {label}
              </button>
            ) : (
              <Link key={j} className={cls} href={`/app/policies/${seg.file}${seg.section ? `#s${seg.section}` : ""}`}>
                {label}
              </Link>
            );
          })}
        </p>
      ))}
    </div>
  );
}
