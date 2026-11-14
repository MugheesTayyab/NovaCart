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
          {(() => {
            const segs = splitCitations(para);
            return segs.map((seg, j) => {
              if (seg.kind === "text") {
                // Punctuation right after a chip is drawn with the chip, so it never starts a line.
                const prev = segs[j - 1];
                const text = prev?.kind === "ref" ? seg.text.replace(/^[.,;:]/, "") : seg.text;
                return <span key={j}>{text}</span>;
              }
              const id = refId(seg.file, seg.section);
              const label = shortRef(id);
              const cls = `${styles.chip} ${active === id ? styles.active : ""}`;
              const next = segs[j + 1];
              const trail = next?.kind === "text" ? (next.text.match(/^[.,;:]/)?.[0] ?? "") : "";
              const chip = onCite ? (
                <button type="button" className={cls} onClick={() => onCite(id)} aria-label={`Show source ${label}`}>
                  {label}
                </button>
              ) : (
                <Link className={cls} href={`/app/policies/${seg.file}${seg.section ? `#s${seg.section}` : ""}`}>
                  {label}
                </Link>
              );
              return (
                <span key={j} className={styles.keep}>
                  {chip}
                  {trail}
                </span>
              );
            });
          })()}
        </p>
      ))}
    </div>
  );
}
