"use client";

import Link from "next/link";
import styles from "./AnswerText.module.css";
import { SourceMarker } from "@/components/SourceMenu";
import { parseAnswer, refId, shortRef, splitCitations } from "@/lib/cite";
import type { SourceRef } from "@/lib/contract";

/*
 * Renders an answer line by line. Sources appear as small numbered markers beside the
 * claim they support; each opens a menu with the clause. `chips` keeps the long
 * "01 §5.3" chips, used for version notices, which are about the files themselves.
 */
export function AnswerText({
  text,
  sources,
  onCite,
  active,
  chips,
}: {
  text: string;
  sources?: SourceRef[];
  onCite?: (id: string) => void;
  active?: string | null;
  chips?: boolean;
}) {
  if (chips) return <ChipText text={text} onCite={onCite} active={active} />;
  const { lines } = parseAnswer(text, sources);
  return (
    <div className={styles.answer}>
      {lines.map((parts, i) => (
        <p key={i}>
          {parts.map((part, j) => {
            if (part.kind === "text") {
              // Punctuation right after a marker is drawn with it, so it never starts a line.
              const prev = parts[j - 1];
              return <span key={j}>{prev?.kind === "marker" ? part.text.replace(/^[.,;:]/, "") : part.text}</span>;
            }
            const next = parts[j + 1];
            const trail = next?.kind === "text" ? (next.text.match(/^[.,;:]/)?.[0] ?? "") : "";
            return (
              <span key={j} className={styles.keep}>
                <SourceMarker n={part.n} id={part.id} active={!!part.id && active === part.id} onShow={onCite} />
                {trail}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function ChipText({ text, onCite, active }: { text: string; onCite?: (id: string) => void; active?: string | null }) {
  return (
    <div className={styles.answer}>
      {text.split(/\n{2,}/).map((para, i) => {
        const segs = splitCitations(para);
        return (
          <p key={i}>
            {segs.map((seg, j) => {
              if (seg.kind === "text") {
                const prev = segs[j - 1];
                return <span key={j}>{prev?.kind === "ref" ? seg.text.replace(/^[.,;:]/, "") : seg.text}</span>;
              }
              const id = refId(seg.file, seg.section);
              const label = shortRef(id);
              const cls = `${styles.chip} ${active === id ? styles.active : ""}`;
              const next = segs[j + 1];
              const trail = next?.kind === "text" ? (next.text.match(/^[.,;:]/)?.[0] ?? "") : "";
              return (
                <span key={j} className={styles.keep}>
                  {onCite ? (
                    <button type="button" className={cls} onClick={() => onCite(id)} aria-label={`Show source ${label}`}>
                      {label}
                    </button>
                  ) : (
                    <Link className={cls} href={`/app/policies/${seg.file}${seg.section ? `#s${seg.section}` : ""}`}>
                      {label}
                    </Link>
                  )}
                  {trail}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
