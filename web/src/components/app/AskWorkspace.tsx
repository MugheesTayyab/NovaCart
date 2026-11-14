"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./AskWorkspace.module.css";
import { AnswerText } from "@/components/AnswerText";
import { Receipt } from "@/components/Receipt";
import { PolicyBlocks } from "@/components/PolicyBlocks";
import { ask, type AskResult, type StreamMeta } from "@/lib/api";
import { fileStates, parseAnswer, refId, shortRef, type FileMeta } from "@/lib/cite";
import { PolicyItemsProvider } from "@/components/SourceMenu";
import { STATUS_LABEL, type AskResponse } from "@/lib/contract";
import { SAMPLES } from "@/lib/samples";
import type { IndexedItem } from "@/lib/policies";

type Exchange = {
  id: number;
  question: string;
  result: AskResult | null;
  sampleId?: string;
  streamed?: string;
  meta?: StreamMeta;
  startedAt: number;
};
type Tab = "sources" | "rules" | "math" | "run";

/** The conversation is kept for this browser tab, so the window and the full page share it. */
const THREAD_KEY = "policy-desk-thread";

function loadThread(): Exchange[] {
  try {
    const raw = window.sessionStorage.getItem(THREAD_KEY);
    const saved = raw ? (JSON.parse(raw) as Exchange[]) : [];
    return Array.isArray(saved) ? saved.filter((e) => e && e.result) : [];
  } catch {
    return [];
  }
}

function saveThread(thread: Exchange[]) {
  try {
    const done = thread.filter((e) => e.result).map((e) => ({ ...e, streamed: undefined, meta: undefined }));
    window.sessionStorage.setItem(THREAD_KEY, JSON.stringify(done.slice(-30)));
  } catch {
    /* Storage full or disabled: the conversation is simply not carried over. */
  }
}

export function AskWorkspace({
  items,
  files,
  variant = "desk",
  title,
  actions,
  request,
}: {
  /** Asks a sample question when it changes (the site's "Ask this in the chat" links). */
  request?: { sampleId: string; n: number };
  items: Record<string, IndexedItem>;
  files: FileMeta[];
  /** "desk" is the full page; "widget" is the chat window on the site. */
  variant?: "desk" | "widget";
  title?: ReactNode;
  /** Header buttons, told whether an answer is still arriving. */
  actions?: (busy: boolean) => ReactNode;
}) {
  const widget = variant === "widget";
  const router = useRouter();
  const [thread, setThread] = useState<Exchange[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState(!widget);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("sources");
  const [active, setActive] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = thread.some((e) => e.result === null);
  const last = thread[thread.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length, last?.streamed?.length, last?.result]);

  // Picks up the conversation from the other view, then /app?sample=<id> opens a sample
  // answer directly (used by links from the site and the demo video).
  const opened = useRef(false);
  const restored = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const saved = loadThread();
    if (saved.length) {
      nextId.current = Math.max(...saved.map((e) => e.id)) + 1;
      setThread(saved);
      setSelected(saved[saved.length - 1].id);
    }
    restored.current = true;
    const id = new URLSearchParams(window.location.search).get("sample");
    const sample = SAMPLES.find((s) => s.id === id);
    if (sample) send(sample.question, { sampleId: sample.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restored.current) saveThread(thread);
  }, [thread]);

  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === request?.sampleId);
    if (sample) send(sample.question, { sampleId: sample.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  function clear() {
    setThread([]);
    setSelected(null);
    setActive(null);
  }

  function patch(id: number, fn: (e: Exchange) => Exchange) {
    setThread((t) => t.map((e) => (e.id === id ? fn(e) : e)));
  }

  async function send(question: string, opts?: { preset?: AskResponse; sampleId?: string }) {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    setThread((t) => [...t, { id, question: q, result: null, sampleId: opts?.sampleId, startedAt: Date.now() }]);
    setSelected(id);
    setActive(null);
    setTab("sources");
    setDraft("");
    // The answer service keeps this tab's conversation by session id, so no history is sent.
    const result: AskResult = opts?.preset
      ? { ok: true, response: opts.preset, ms: 0 }
      : await ask(q, {
          onMeta: (meta) => patch(id, (e) => ({ ...e, meta })),
          onToken: (text) => patch(id, (e) => ({ ...e, streamed: (e.streamed ?? "") + text })),
        });
    patch(id, (e) => ({ ...e, result }));
  }

  function cite(id: string) {
    setActive(id);
    setTab("sources");
    setEvidenceOpen(true);
  }

  const current = thread.find((e) => e.id === selected) ?? null;
  const response = current?.result?.ok ? current.result.response : null;

  return (
    <PolicyItemsProvider items={items}>
    <div className={styles.workspace} data-variant={variant} data-evidence={evidenceOpen ? "open" : "closed"}>
      <section className={styles.convo} aria-label="Conversation">
        <header className={styles.head}>
          {title ?? (
            <>
              <h1>Ask</h1>
              <p>Paste the customer&apos;s message as written, with any dates they mention.</p>
            </>
          )}
          <div className={styles.headActions}>
            {thread.length > 0 && (
              <button type="button" className={styles.textBtn} onClick={clear} disabled={busy}>
                New chat
              </button>
            )}
            {widget && (
              <button
                type="button"
                className={styles.textBtn}
                aria-pressed={evidenceOpen}
                onClick={() => setEvidenceOpen((o) => !o)}
              >
                {evidenceOpen ? "Hide evidence" : "Show evidence"}
              </button>
            )}
            {actions?.(busy)}
            {!widget && (
              <button
                type="button"
                className={styles.iconBtn}
                disabled={busy}
                onClick={() => router.push("/?chat=open")}
                title={busy ? "Available when the answer finishes" : "Open as a window on the site"}
                aria-label="Open as a window on the site"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect x="2.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M5.5 3.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                <span>Open as window</span>
              </button>
            )}
          </div>
        </header>

        <div className={styles.thread}>
          <div className={styles.column}>
            {thread.length === 0 && widget && (
              <div className={styles.hello}>
                <span className={styles.avatar} aria-hidden="true" />
                <p>
                  Hi. Ask about a return, refund, delivery fee, payment or warranty. Mention your city and the dates if
                  you know them, and the answer can be exact. Every answer cites the policy section it comes from.
                </p>
              </div>
            )}
            {thread.length === 0 && (
              <div className={styles.samples}>
                <h2>{widget ? "Or start from one of these" : "Sample questions"}</h2>
                <ul>
                  {SAMPLES.map((s, i) => (
                    <li key={s.id} style={{ ["--i" as string]: i }}>
                      <button type="button" onClick={() => send(s.question, { sampleId: s.id })}>
                        <span className={styles.sampleLabel}>{s.label}</span>
                        <span className={styles.sampleQ}>{s.question}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {thread.map((e) => (
              <article
                key={e.id}
                className={`${styles.exchange} ${e.id === selected ? styles.selected : ""}`}
                onClick={() => setSelected(e.id)}
              >
                <div className={styles.customer}>
                  <p className={styles.who}>{widget ? "You" : "Customer"}</p>
                  <p>{e.question}</p>
                </div>
                <div className={styles.deskRow}>
                <span className={styles.avatar} aria-hidden="true" />
                <div className={styles.desk} data-state={e.result ? "done" : e.streamed ? "streaming" : "thinking"}>
                  <p className={styles.who}>Policy Desk</p>
                  {e.result === null && !e.streamed && <FileScan files={files} meta={e.meta} startedAt={e.startedAt} />}
                  {e.result === null && e.streamed && (
                    <div className={styles.streaming}>
                      <AnswerText text={e.streamed} />
                    </div>
                  )}
                  {e.result && !e.result.ok && (
                    <div className={styles.error} role="status">
                      <p>{e.result.message}</p>
                      {e.result.kind !== "preview-miss" && (
                        <button type="button" onClick={() => send(e.question)}>
                          Try again
                        </button>
                      )}
                    </div>
                  )}
                  {e.result?.ok && (
                    <>
                      <AnswerText
                        text={e.result.response.answer}
                        sources={e.result.response.sources}
                        onCite={(id) => {
                          setSelected(e.id);
                          cite(id);
                        }}
                        active={e.id === selected ? active : null}
                      />
                      {e.result.response.calculation.length > 0 && (
                        <button
                          type="button"
                          className={styles.working}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelected(e.id);
                            setTab("math");
                            setEvidenceOpen(true);
                          }}
                        >
                          See the working, {e.result.response.calculation.length} steps
                        </button>
                      )}
                      {e.result.response.status === "needs_info" && (
                        <QuickReplies
                          exchange={e}
                          response={e.result.response}
                          onPick={(value, preset) => send(value, { preset })}
                          disabled={busy || e.id !== last?.id}
                        />
                      )}
                    </>
                  )}
                </div>
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <form
          className={styles.composer}
          onSubmit={(ev) => {
            ev.preventDefault();
            send(draft);
          }}
        >
          <div className={styles.column}>
            <label htmlFor="q" className="visually-hidden">
              Customer message
            </label>
            <div className={styles.field}>
              <textarea
                id="q"
                rows={1}
                value={draft}
                placeholder={
                  widget
                    ? "Ask about a return, refund, delivery or warranty"
                    : "e.g. Today is 2026-09-01. I live in Multan. Is shipping free on a Rs. 6,000 order?"
                }
                onChange={(ev) => setDraft(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && !ev.shiftKey) {
                    ev.preventDefault();
                    send(draft);
                  }
                }}
              />
              <button type="submit" disabled={busy || !draft.trim()}>
                Send
              </button>
            </div>
          </div>
        </form>
      </section>

      <Evidence
        response={response}
        ms={current?.result?.ok ? current.result.ms : undefined}
        items={items}
        files={files}
        tab={tab}
        setTab={setTab}
        active={active}
        onCite={cite}
        onClose={widget ? () => setEvidenceOpen(false) : undefined}
      />
    </div>
    </PolicyItemsProvider>
  );
}

function EvidenceClose({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null;
  return (
    <button type="button" className={styles.evClose} onClick={onClose} aria-label="Hide evidence">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/*
 * What the desk is doing while it thinks, drawn from what it is really doing: one
 * mark per policy file. The marks scan while the service retrieves; when it reports
 * the evidence, the files it is reading from light up.
 */
function FileScan({ files, meta, startedAt }: { files: FileMeta[]; meta?: StreamMeta; startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(t);
  }, [startedAt]);
  const used = new Set((meta?.evidence ?? []).map((e) => e.id.slice(0, 2)));
  const sections = meta?.evidence?.length ?? 0;
  return (
    <div className={styles.scan} data-phase={meta ? "found" : "reading"} role="status" aria-live="polite">
      <ol className={styles.ticks} aria-hidden="true">
        {files.map((f, i) => (
          <li key={f.num} style={{ ["--i" as string]: i }} data-used={used.has(f.num) || undefined} title={`${f.num} ${f.title}`}>
            <span>{f.num}</span>
          </li>
        ))}
      </ol>
      <p>
        {meta
          ? `Found ${sections} sections in ${used.size} files. Checking which rules apply and writing the answer.`
          : `Reading the question and searching ${files.length} policy files.`}
        <span className={styles.elapsed}>{(elapsed / 1000).toFixed(1)} s</span>
      </p>
    </div>
  );
}

function StatusLabel({ status }: { status: AskResponse["status"] }) {
  if (!STATUS_LABEL[status]) return null;
  return (
    <span className={styles.status} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function QuickReplies({
  exchange,
  response,
  onPick,
  disabled,
}: {
  exchange: Exchange;
  response: AskResponse;
  onPick: (value: string, preset?: AskResponse) => void;
  disabled: boolean;
}) {
  const outcomes = response.meta.slot_test?.outcomes ?? [];
  if (!outcomes.length) return null;
  const sample = SAMPLES.find((s) => s.id === exchange.sampleId);
  return (
    <div className={styles.quick}>
      <p>Reply with</p>
      <div>
        {outcomes.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={(ev) => {
              ev.stopPropagation();
              onPick(o.value, sample?.followUps?.find((f) => f.value === o.value)?.response);
            }}
          >
            {o.value}
          </button>
        ))}
      </div>
    </div>
  );
}

function Evidence({
  response,
  ms,
  items,
  files,
  tab,
  setTab,
  active,
  onCite,
  onClose,
}: {
  onClose?: () => void;
  response: AskResponse | null;
  ms?: number;
  items: Record<string, IndexedItem>;
  files: FileMeta[];
  tab: Tab;
  setTab: (t: Tab) => void;
  active: string | null;
  onCite: (id: string) => void;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, tab]);

  if (!response) {
    return (
      <aside className={styles.evidence} aria-label="Evidence">
        <div className={styles.evHead}>
          <h2>Evidence</h2>
          <EvidenceClose onClose={onClose} />
        </div>
        <div className={styles.evEmpty}>
          <p>
            Each answer shows its work here: the details read from the question, the policy versions in force on that
            date, the sections it cites, the order rules were applied in, and the calculation.
          </p>
        </div>
      </aside>
    );
  }

  const m = response.meta;
  const states = m.contact_date ? fileStates(files, m.contact_date) : null;
  const count = (st: string) => (states ? Object.values(states).filter((s) => s.state === st).length : 0);
  // The same numbers as the markers in the answer; any other listed source follows unnumbered.
  const numbered = parseAnswer(response.answer, response.sources).refs;
  const sourceIds = [...new Set([...numbered, ...response.sources.map((s) => refId(s.file, s.section))])];
  const slots = Object.entries(m.slots ?? {});
  const tabs: [Tab, string, number | null][] = [
    ["sources", "Sources", sourceIds.length],
    ["rules", "Rule order", response.rule_order.length],
    ["math", "Calculation", response.calculation.length],
    ["run", "Run", null],
  ];

  return (
    <aside className={styles.evidence} aria-label="Evidence" key={m.request_id ?? response.answer.slice(0, 40)}>
      <div className={styles.evHead}>
        <h2>Evidence</h2>
        <StatusLabel status={response.status} />
        <EvidenceClose onClose={onClose} />
      </div>

      {slots.length > 0 && (
        <div className={styles.evBlock}>
          <h3>Read from the question</h3>
          <dl className={styles.slots}>
            {slots.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={v ? undefined : styles.missing}>{v ?? "Not given"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {m.contact_date && (
        <div className={styles.evBlock}>
          <h3>Version check</h3>
          <p className={styles.small}>
            Contact date {m.contact_date}. {count("in-force")} of {files.length} files apply
            {count("superseded") ? `, ${count("superseded")} replaced by a later version` : ""}
            {count("not-yet") ? `, ${count("not-yet")} not yet in force` : ""}.
          </p>
          {m.notices?.map((n) => (
            <div key={n} className={styles.notice}>
              <AnswerText text={n} onCite={onCite} active={active} chips />
            </div>
          ))}
        </div>
      )}

      {m.slot_test && (
        <div className={styles.evBlock}>
          <h3>Why it asked</h3>
          <p className={styles.small}>
            The {m.slot_test.slot} was missing. The rules give a different result for each value, so the desk asks
            instead of assuming.
          </p>
          <table className={styles.outcomes}>
            <tbody>
              {m.slot_test.outcomes.map((o) => (
                <tr key={o.value}>
                  <th scope="row">{o.value}</th>
                  <td>{o.outcome}</td>
                  <td>
                    {o.rule && (
                      <button type="button" className={styles.ruleLink} onClick={() => onCite(o.rule!)}>
                        {shortRef(o.rule)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Evidence detail">
        {tabs.map(([t, label, n]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
            {n !== null && <span className={styles.count}>{n}</span>}
          </button>
        ))}
      </div>

      <div className={styles.panel} role="tabpanel" key={tab}>
        {tab === "sources" &&
          (sourceIds.length ? (
            <ul className={styles.sources}>
              {sourceIds.map((id) => {
                const it = items[id];
                return (
                  <li key={id} ref={active === id ? activeRef : undefined} className={active === id ? styles.on : undefined}>
                    <button type="button" className={styles.sourceHead} onClick={() => onCite(id)}>
                      {numbered.includes(id) && <span className={styles.sourceNum}>{numbered.indexOf(id) + 1}</span>}
                      <span className={styles.sourceName}>{it ? `${it.fileName}, Section ${it.num}` : shortRef(id)}</span>
                      {it && <span className={styles.sectionTitle}>{it.sectionTitle}</span>}
                    </button>
                    {it ? <PolicyBlocks blocks={it.blocks} /> : <p className={styles.small}>Section not found in the files.</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.small}>This answer cites no policy section.</p>
          ))}
        {tab === "rules" &&
          (response.rule_order.length ? (
            <ol className={styles.rules}>
              {response.rule_order.map((r, i) => (
                <li key={i}>
                  <button type="button" className={styles.ruleLink} onClick={() => onCite(r.rule)}>
                    {shortRef(r.rule)}
                  </button>
                  <p>{r.reason}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.small}>No competing rules, so there was no order to decide.</p>
          ))}
        {tab === "math" &&
          (response.calculation.length ? (
            <Receipt steps={response.calculation} onRule={onCite} />
          ) : (
            <p className={styles.small}>This answer has no amounts to work out.</p>
          ))}
        {tab === "run" && (
          <div className={styles.run}>
            {m.preview ? (
              <p className={styles.small}>
                Preview answer, checked by hand against the files. Latency, tokens and the model route are recorded
                once the answer service is connected.
              </p>
            ) : (
              <dl>
                <div>
                  <dt>Round trip</dt>
                  <dd>{ms !== undefined ? `${ms} ms` : "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Server time</dt>
                  <dd>{m.latency_ms !== undefined ? `${m.latency_ms} ms` : "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{m.tokens ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Model route</dt>
                  <dd>{m.model_route?.join(", ") || "No model call"}</dd>
                </div>
                <div>
                  <dt>Fallback</dt>
                  <dd>{m.fallback_used ? "Used" : "Not used"}</dd>
                </div>
                <div>
                  <dt>Retrieval</dt>
                  <dd>{m.cache_hit ? "From cache" : "Fresh"}</dd>
                </div>
                {m.timings_ms && (
                  <div>
                    <dt>Stages</dt>
                    <dd>
                      {Object.entries(m.timings_ms)
                        .map(([k, v]) => `${k} ${v} ms`)
                        .join(", ")}
                    </dd>
                  </div>
                )}
                {!!m.flagged_citations?.length && (
                  <div>
                    <dt>Unverified</dt>
                    <dd>{m.flagged_citations.length} citation(s) removed: not in the supplied evidence</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
