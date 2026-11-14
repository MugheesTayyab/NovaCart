"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./ChatWidget.module.css";
import { AskWorkspace } from "@/components/app/AskWorkspace";
import type { FileMeta } from "@/lib/cite";
import type { IndexedItem } from "@/lib/policies";
import { API_URL } from "@/lib/site";

/** Other parts of the site open the window by dispatching this event. */
export const OPEN_CHAT_EVENT = "policy-desk:open";

type Phase = "closed" | "pop" | "restore" | "closing" | "expanding";

/*
 * The chat on the site. A launcher in the corner (its ring of text turns slowly) opens
 * the desk as a window over the page. Maximize grows the window to the full screen and
 * hands over to /app; the desk's "Window" button comes back here with ?chat=open.
 * The conversation is the same in both, kept for this browser tab.
 */
export function ChatWidget({ items, files }: { items: Record<string, IndexedItem>; files: FileMeta[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("closed");
  const [mounted, setMounted] = useState(false);
  const [request, setRequest] = useState<{ sampleId: string; n: number } | undefined>();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = phase !== "closed";

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const show = useCallback((from: "pop" | "restore") => {
    setMounted(true);
    setPhase(from);
  }, []);

  const close = useCallback(() => {
    setPhase("closing");
    window.setTimeout(
      () => {
        setPhase("closed");
        launcherRef.current?.focus();
      },
      reduced() ? 0 : 200,
    );
  }, []);

  function maximize() {
    router.prefetch("/app");
    setPhase("expanding");
    window.setTimeout(() => router.push("/app"), reduced() ? 0 : 300);
  }

  // Coming back from the full page (/?chat=open) reopens the window, shrinking from full screen.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("chat") === "open") {
      url.searchParams.delete("chat");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      show("restore");
    }
    const onOpen = (ev: Event) => {
      const sample = (ev as CustomEvent<{ sample?: string }>).detail?.sample;
      if (sample) setRequest((r) => ({ sampleId: sample, n: (r?.n ?? 0) + 1 }));
      show("pop");
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, [show]);

  // While open: the page behind does not scroll, Escape closes, Tab stays inside the window.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 60);
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      } else if (ev.key === "Tab" && dialogRef.current) {
        const nodes = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((n) => n.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        data-hidden={open || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open the Policy Desk chat"
        onClick={() => show("pop")}
      >
        <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <path id="chat-ring" d="M50,50 m-40,0 a40,40 0 1,1 80,0 a40,40 0 1,1 -80,0" />
          </defs>
          <text>
            <textPath href="#chat-ring" textLength="249" lengthAdjust="spacing">
              Ask about returns · refunds · shipping · warranty ·
            </textPath>
          </text>
        </svg>
        <span className={styles.core} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path
              d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0.5A2.5 2.5 0 0 1 5 12.5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="9.5" cy="9.5" r="1" fill="currentColor" />
            <circle cx="12" cy="9.5" r="1" fill="currentColor" />
            <circle cx="14.5" cy="9.5" r="1" fill="currentColor" />
          </svg>
        </span>
        <span className={styles.live} aria-hidden="true" />
      </button>

      {mounted && (
        <div className={styles.layer} data-phase={phase} hidden={!open}>
          <div className={styles.backdrop} onClick={close} aria-hidden="true" />
          <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Policy Desk chat"
          >
            <AskWorkspace
              items={items}
              files={files}
              variant="widget"
              request={request}
              title={
                <div className={styles.title}>
                  <span className={styles.titleMark} aria-hidden="true" />
                  <div>
                    <h2>Policy Desk</h2>
                    <p>
                      <span className={styles.dot} data-live={API_URL ? "yes" : "no"} aria-hidden="true" />
                      {API_URL ? "Answers from the 22 NovaCart policy files" : "Preview: sample questions only"}
                    </p>
                  </div>
                </div>
              }
              actions={(busy) => (
                <>
                  <button
                    type="button"
                    className={styles.winBtn}
                    onClick={maximize}
                    disabled={busy}
                    title={busy ? "Available when the answer finishes" : "Open on its own page"}
                    aria-label="Open on its own page"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path
                        d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button type="button" className={styles.winBtn} onClick={close} aria-label="Close the chat">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              )}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** A button anywhere on the site that opens the chat window, optionally asking a sample question. */
export function OpenChatButton({
  className,
  sample,
  children,
}: {
  className?: string;
  sample?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { sample } }))}
    >
      {children}
    </button>
  );
}
