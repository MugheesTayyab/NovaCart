"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./SourceMenu.module.css";
import { shortRef } from "@/lib/cite";
import type { Block, IndexedItem } from "@/lib/policies";

/* The policy sections, handed down once per page so any marker can show its clause. */
const ItemsContext = createContext<Record<string, IndexedItem> | null>(null);

export function PolicyItemsProvider({ items, children }: { items: Record<string, IndexedItem>; children: React.ReactNode }) {
  return <ItemsContext.Provider value={items}>{children}</ItemsContext.Provider>;
}

export function usePolicyItems() {
  return useContext(ItemsContext);
}

function firstText(blocks: Block[]): string {
  for (const b of blocks) {
    if (b.kind === "text" && b.text.trim()) return b.text;
    if (b.kind === "list" && b.items.length) return b.items.join("; ");
    if (b.kind === "table" && b.rows.length) return `${b.head.join(", ")}: ${b.rows[0].join(", ")}...`;
  }
  return "";
}

/** Strips the files' own emphasis and citation brackets for a plain excerpt. */
function plain(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[(file \d{2}[^\]]*)\]/g, "($1)");
}

/*
 * A numbered source marker. Clicking it opens a small menu with the file, the section,
 * the clause itself, and ways to read more: in the desk's evidence panel when there is
 * one, and in the policy library.
 */
export function SourceMarker({
  n,
  id,
  active,
  onShow,
}: {
  n: number;
  id: string | null;
  active?: boolean;
  onShow?: (id: string) => void;
}) {
  const items = usePolicyItems();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (!wrap.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Keep the menu on screen: nudge it left or right if it would cross an edge.
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    const pad = 12;
    if (r.left < pad) setShift((s) => s + (pad - r.left));
    else if (r.right > window.innerWidth - pad) setShift((s) => s - (r.right - window.innerWidth + pad));
  }, [open]);

  if (!id) {
    return (
      <span className={`${styles.marker} ${styles.pending}`} aria-hidden="true">
        {n}
      </span>
    );
  }

  const [file, section] = id.split("#");
  const it = items?.[id];
  const excerpt = it ? plain(firstText(it.blocks)) : "";

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={`${styles.marker} ${active || open ? styles.on : ""}`}
        aria-expanded={open}
        aria-label={`Source ${n}: ${it ? `${it.fileName}, Section ${it.num}` : shortRef(id)}`}
        onClick={(ev) => {
          ev.stopPropagation();
          setShift(0);
          setOpen((o) => !o);
        }}
      >
        {n}
      </button>
      {open && (
        <span
          ref={menu}
          className={styles.menu}
          role="dialog"
          aria-label={`Source ${n}`}
          style={{ ["--shift" as string]: `${shift}px` }}
          onClick={(ev) => ev.stopPropagation()}
        >
          <span className={styles.head}>
            <span className={styles.num}>{n}</span>
            <span className={styles.ref}>
              <span className={styles.file}>{it?.fileName ?? `File ${file}`}</span>
              <span className={styles.sec}>
                Section {section}
                {it?.sectionTitle ? `, ${it.sectionTitle}` : ""}
              </span>
            </span>
          </span>
          {excerpt && <span className={styles.excerpt}>{excerpt}</span>}
          <span className={styles.actions}>
            {onShow && (
              <button
                type="button"
                onClick={() => {
                  onShow(id);
                  setOpen(false);
                }}
              >
                Show in evidence
              </button>
            )}
            <Link href={`/app/policies/${file}${section ? `#s${section}` : ""}`}>Read the full policy</Link>
          </span>
        </span>
      )}
    </span>
  );
}
