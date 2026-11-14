"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AskWorkspace.module.css";
import { AnswerText } from "@/components/AnswerText";
import { Receipt } from "@/components/Receipt";
import { PolicyBlocks } from "@/components/PolicyBlocks";
import { ask, type AskResult } from "@/lib/api";
import { fileStates, refId, shortRef, type FileMeta } from "@/lib/cite";
import { STATUS_LABEL, type AskResponse } from "@/lib/contract";
import { SAMPLES } from "@/lib/samples";
import type { IndexedItem } from "@/lib/policies";

type Exchange = { id: number; question: string; result: AskResult | null; sampleId?: string };
type Tab = "sources" | "rules" | "math" | "run";

export function AskWorkspace({ items, files }: { items: Record<string, IndexedItem>; files: FileMeta[] }) {
  const [thread, setThread] = useState<Exchange[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("sources");
  const [active, setActive] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = thread.some((e) => e.result === null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length]);

  async function send(question: string, opts?: { preset?: AskResponse; sampleId?: string }) {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    setThread((t) => [...t, { id, question: q, result: null, sampleId: opts?.sampleId }]);
    setSelected(id);
    setActive(null);
    setTab("sources");
    setDraft("");
    const history = thread.flatMap((e) =>
      e.result?.ok
        ? [
            { role: "customer" as const, text: e.question },
            { role: "desk" as const, text: e.result.response.answer },
          ]
        : [],
    );
    const result: AskResult = opts?.preset
      ? { ok: true, response: opts.preset, ms: 0 }
      : await ask({ question: q, history });
    setThread((t) => t.map((e) => (e.id === id ? { ...e, result } : e)));
  }

  function cite(id: string) {
    setActive(id);
    setTab("sources");
  }

  const current = thread.find((e) => e.id === selected) ?? null;
  const response = current?.result?.ok ? current.result.response : null;

  return (
    <div className={styles.workspace}>
      <section className={styles.convo} aria-label="Conversation">
        <header className={styles.head}>
          <h1>Ask</h1>
          <p>Paste the customer&apos;s message as they wrote it, including any dates they mention.</p>
        </header>

        <div className={styles.thread}>
          {thread.length === 0 && (
            <div className={styles.samples}>
              <h2>Sample questions</h2>
              <ul>
                {SAMPLES.map((s) => (
                  <li key={s.id}>
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
                <p className={styles.who}>Customer</p>
                <p>{e.question}</p>
              </div>
              <div className={styles.desk}>
                <p className={styles.who}>
                  Policy Desk
                  {e.result?.ok && <StatusLabel status={e.result.response.status} />}
                </p>
                {e.result === null && <p className={styles.pending}>Checking the policy files</p>}
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
                      onCite={(id) => {
                        setSelected(e.id);
                        cite(id);
                      }}
                      active={e.id === selected ? active : null}
                    />
                    {e.result.response.status === "needs_info" && (
                      <QuickReplies
                        exchange={e}
                        response={e.result.response}
                        onPick={(value, preset) => send(value, { preset })}
                        disabled={busy || e.id !== thread[thread.length - 1].id}
                      />
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
          <div ref={endRef} />
        </div>

        <form
          className={styles.composer}
          onSubmit={(ev) => {
            ev.preventDefault();
            send(draft);
          }}
        >
          <label htmlFor="q" className="visually-hidden">
            Customer message
          </label>
          <textarea
            id="q"
            rows={2}
            value={draft}
            placeholder="e.g. Today is 2026-09-01. I live in Multan. Is shipping free on a Rs. 6,000 order?"
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
      />
    </div>
  );
}

function StatusLabel({ status }: { status: AskResponse["status"] }) {
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
}: {
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
        <div className={styles.evEmpty}>
          <h2>Evidence</h2>
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
  const inForce = states ? Object.values(states).filter((s) => s.state !== "not-yet").length : null;
  const sourceIds = [...new Set(response.sources.map((s) => refId(s.file, s.section)))];
  const tabs: [Tab, string, number | null][] = [
    ["sources", "Sources", sourceIds.length],
    ["rules", "Rule order", response.rule_order.length],
    ["math", "Calculation", response.calculation.length],
    ["run", "Run", null],
  ];

  return (
    <aside className={styles.evidence} aria-label="Evidence">
      <div className={styles.evBlock}>
        <h2 className={styles.evTitle}>
          Evidence <StatusLabel status={response.status} />
        </h2>
      </div>

      {m.slots && (
        <div className={styles.evBlock}>
          <h3>Read from the question</h3>
          <dl className={styles.slots}>
            {Object.entries(m.slots).map(([k, v]) => (
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
          <p className={styles.version}>
            Contact date <span className="mono">{m.contact_date}</span>. {inForce} of {files.length} files in force.
          </p>
          {m.notices?.map((n) => (
            <div key={n} className={styles.notice}>
              <AnswerText text={n} onCite={onCite} active={active} />
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

      <div className={styles.panel} role="tabpanel">
        {tab === "sources" && (
          <ul className={styles.sources}>
            {sourceIds.map((id) => {
              const it = items[id];
              return (
                <li key={id} ref={active === id ? activeRef : undefined} className={active === id ? styles.on : undefined}>
                  <button type="button" className={styles.sourceHead} onClick={() => onCite(id)}>
                    <span className="mono">{it ? `${it.fileName}, Section ${it.num}` : shortRef(id)}</span>
                    {it && <span className={styles.sectionTitle}>{it.sectionTitle}</span>}
                  </button>
                  {it ? <PolicyBlocks blocks={it.blocks} /> : <p className={styles.small}>Section not found in the files.</p>}
                </li>
              );
            })}
          </ul>
        )}
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
            <p className={styles.small}>Only one rule applied, so there was no order to decide.</p>
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
                  <dt>Cache</dt>
                  <dd>{m.cache_hit ? "Served from cache" : "Fresh answer"}</dd>
                </div>
              </dl>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
