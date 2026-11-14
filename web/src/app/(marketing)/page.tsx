import Link from "next/link";
import styles from "./marketing.module.css";
import { HalftoneHands } from "@/components/HalftoneHands";
import { Receipt } from "@/components/Receipt";
import { AnswerText } from "@/components/AnswerText";
import { VersionStrip } from "@/components/marketing/VersionStrip";
import { SAMPLES } from "@/lib/samples";
import { corpusStats, getPolicies } from "@/lib/policies";
import { shortRef } from "@/lib/cite";

const STEPS: { name: string; by: string; text: string }[] = [
  {
    name: "Read the question",
    by: "model",
    text: "Splits it into parts and copies out dates, region, items, prices and codes exactly as the customer wrote them.",
  },
  {
    name: "Pick the files in force",
    by: "code",
    text: "Drops files whose effective date is after the contact date, and applies file 00's rules when two versions overlap.",
  },
  {
    name: "Find the sections",
    by: "code",
    text: "Searches the numbered sections and follows their cross-references, so a regional override arrives with the general rule.",
  },
  {
    name: "Check the evidence",
    by: "model",
    text: "Marks each part of the question as covered, partly covered, not covered, or in conflict between two files.",
  },
  {
    name: "Ask only if it matters",
    by: "code",
    text: "Runs the rules once for every value a missing detail could take. If the outcome changes, it asks one question.",
  },
  {
    name: "Apply the rules, do the math",
    by: "code",
    text: "Applies rules in the order the files set and works in whole rupees, rounding half up at each step.",
  },
  {
    name: "Write, then verify",
    by: "model, then code",
    text: "Writes the reply from that trace, then rechecks every figure and citation before it is sent.",
  },
];

export default function Home() {
  const refund = SAMPLES[0];
  const ask = SAMPLES[1];
  const partial = SAMPLES[2];
  const conflict = SAMPLES[3];
  const stats = corpusStats();
  const files = getPolicies().map((f) => ({
    num: f.num,
    title: f.title,
    effectiveDate: f.effectiveDate,
    scope: f.scope,
    version: f.version,
  }));

  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.headline}>
          <span className={styles.lead}>Refunds, fees, promo codes.</span>
          <span className={styles.big}>Answered with</span>
          <span className={styles.big}>
            receipts<span className={styles.dot} aria-hidden="true" />
          </span>
        </h1>
        <p className={styles.sub}>
          Policy Desk answers NovaCart customers from the store&apos;s own policy files. Each line names the section it
          came from, the money is worked out in code, and when the files are silent the reply says so.
        </p>
        <div className={styles.actions}>
          <Link href="/app" className={styles.primary}>
            Ask a question
          </Link>
          <a href="#answer" className={styles.secondary}>
            See a full answer
          </a>
        </div>
      </section>

      <div className={styles.art}>
        <HalftoneHands cardWidth={264}>
          <Receipt
            compact
            title="Return: shirt, change of mind"
            steps={[
              { label: "Paid price", result: "2,040" },
              { label: "Restocking fee", result: "0" },
              { label: "Return label fee", result: "−200" },
              { label: "Refund to card", result: "1,840" },
            ]}
          />
          <p className={styles.artCite}>01_returns_policy.md, Section 5.3</p>
        </HalftoneHands>
      </div>

      <section id="answer" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>One answer, taken apart</h2>
          <p>
            A customer returns one of two items bought with a promo code. This is the reply the desk gives, with what
            each part is there for.
          </p>
        </div>
        <div className={styles.anatomy}>
          <article className={styles.answerCard}>
            <p className={styles.question}>{refund.question}</p>
            <div className={styles.marked}>
              <Marker n={1} />
              <AnswerText text={refund.response.answer} />
            </div>
            <div className={`${styles.marked} ${styles.notice}`}>
              <Marker n={2} />
              <p>{refund.response.meta.notices?.[0].replace(/ \[file 00, Section 4\.2\]$/, "")}</p>
            </div>
            <div className={styles.marked}>
              <Marker n={3} />
              <Receipt title="How Rs. 1,840 was reached" steps={refund.response.calculation} />
            </div>
            <div className={styles.marked}>
              <Marker n={4} />
              <ol className={styles.ruleOrder}>
                {refund.response.rule_order.slice(2, 5).map((r) => (
                  <li key={r.rule}>
                    <span className="mono">{shortRef(r.rule)}</span> {r.reason}
                  </li>
                ))}
              </ol>
            </div>
          </article>
          <ol className={styles.notes}>
            <li>
              <h3>A source on every line</h3>
              <p>Each sentence ends with the file and section it came from. Open one and the clause is there to read.</p>
            </li>
            <li>
              <h3>The version it used</h3>
              <p>
                NovaCart has two returns policies. On 2026-07-10 version 3 is in force, and the reply says it chose that
                one, as file 00 requires.
              </p>
            </li>
            <li>
              <h3>Math done in code</h3>
              <p>
                The discount split, fees and rounding are computed in whole rupees, then recomputed before the reply goes
                out. The language model never adds up money.
              </p>
            </li>
            <li>
              <h3>Rules in the right order</h3>
              <p>The promo discount is split across items before the return fee is taken, because the refund starts from each item&apos;s paid price.</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="limits" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>When the files say less</h2>
          <p>A support bot earns trust in the cases it cannot answer outright. These replies come from the same policy files.</p>
        </div>
        <div className={styles.cases}>
          <div className={styles.caseRow}>
            <h3>It asks one question</h3>
            <p className={styles.caseQ}>{ask.question}</p>
            <div className={styles.caseA}>
              <p>{ask.response.clarifying_question}</p>
              <table className={styles.outcomes}>
                <caption>Why it asks: the window depends on the region</caption>
                <tbody>
                  {ask.response.meta.slot_test?.outcomes.map((o) => (
                    <tr key={o.value}>
                      <th scope="row">{o.value}</th>
                      <td>{o.outcome}</td>
                      <td className="mono">{o.rule && shortRef(o.rule)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={styles.caseRow}>
            <h3>It says what is not covered</h3>
            <p className={styles.caseQ}>{partial.question}</p>
            <div className={styles.caseA}>
              <AnswerText text={partial.response.answer} />
            </div>
          </div>
          <div className={styles.caseRow}>
            <h3>It shows both sides</h3>
            <p className={styles.caseQ}>{conflict.question}</p>
            <div className={styles.caseA}>
              <AnswerText text={conflict.response.answer.split("\n\n").slice(0, 2).join("\n\n")} />
            </div>
          </div>
        </div>
      </section>

      <section id="decides" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>How it decides</h2>
          <p>
            Seven steps, and the language model handles three of them. Anything that has to be exact, from dates to
            rupees, is done by code that gives the same result every time.
          </p>
        </div>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.name} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <div>
                <h3>
                  {s.name} <span className={s.by === "code" ? styles.byCode : styles.byModel}>{s.by}</span>
                </h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="policies" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>The policy set</h2>
          <p>
            Everything the desk knows is in these files. They are read as they are, and nothing is added from outside
            them.
          </p>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Policy files</dt>
            <dd>{stats.files}</dd>
          </div>
          <div>
            <dt>Numbered sections</dt>
            <dd>{stats.items}</dd>
          </div>
          <div>
            <dt>Cross-references</dt>
            <dd>{stats.crossRefs}</dd>
          </div>
          <div>
            <dt>Regional addenda</dt>
            <dd>{stats.regional}</dd>
          </div>
        </dl>
        <VersionStrip files={files} />
        <p className={styles.more}>
          <Link href="/app/policies">Browse every file and section</Link>
        </p>
      </section>
    </>
  );
}

function Marker({ n }: { n: number }) {
  return (
    <span className={styles.marker} aria-label={`Note ${n}`}>
      {n}
    </span>
  );
}
