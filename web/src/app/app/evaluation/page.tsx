import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import shell from "../app.module.css";
import styles from "./evaluation.module.css";

export const metadata: Metadata = { title: "Evaluation" };

/*
 * Reads the latest run written by eval/run_eval.py (eval/results/latest.json).
 * Until a run exists the page says so; it never shows placeholder numbers.
 */

type EvalRun = {
  run_at: string;
  cases: number;
  held_out: number;
  categories: { name: string; total: number; passed: number }[];
  metrics: {
    status_accuracy?: number;
    citation_precision?: number;
    citation_recall?: number;
    math_exact?: number;
    over_refusal?: number;
    pass_k?: { k: number; rate: number };
    latency_p50_ms?: number;
    latency_p95_ms?: number;
    tokens_per_question?: number;
    cost_per_1000_usd?: number;
  };
};

function loadRun(): EvalRun | null {
  const file = path.join(process.cwd(), "..", "eval", "results", "latest.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as EvalRun;
  } catch {
    return null;
  }
}

const pct = (x?: number) => (x === undefined ? "Not measured" : `${Math.round(x * 1000) / 10}%`);

const CATEGORIES = [
  ["Covered, one file", "Basic grounding and the citation format"],
  ["Several files", "A refund that needs returns, promo and shipping rules together"],
  ["Math", "Discount shares, fees, rounding and totals to the rupee"],
  ["Missing detail that matters", "Must ask one question"],
  ["Missing detail that does not matter", "Must answer without asking"],
  ["Partly covered", "Answers the covered part, names the rest"],
  ["Not covered", "Says “this is not covered”"],
  ["Near miss", "A similar rule exists for something else; must not stretch it"],
  ["Version and date", "Which file is in force on the contact date"],
  ["Same-date conflict", "Shows both files and says support must confirm"],
  ["Regional override", "Remote areas and international orders"],
  ["Boundary", "The last day of a window, exact thresholds"],
  ["False premise", "Corrects a wrong assumption with the source"],
  ["Instructions in the question", "Asks to ignore the policies; must stay grounded"],
  ["Messy input", "Typos, several questions at once, mixed English and Urdu"],
];

export default function EvaluationPage() {
  const run = loadRun();
  return (
    <div className={shell.page}>
      <header className={shell.pageHead}>
        <h1>Evaluation</h1>
        <p>
          Results from the team&apos;s red-team set, run against the answer service. About 30% of the cases are held
          out and never used for tuning, so their score is the closest estimate of the unseen test set.
        </p>
      </header>

      {run ? (
        <>
          <p className={styles.runMeta}>
            Last run <span className="mono">{run.run_at}</span>, {run.cases} cases, {run.held_out} held out.
          </p>
          <dl className={styles.metrics}>
            <Metric label="Status accuracy" value={pct(run.metrics.status_accuracy)} />
            <Metric label="Citation precision" value={pct(run.metrics.citation_precision)} />
            <Metric label="Citation recall" value={pct(run.metrics.citation_recall)} />
            <Metric label="Math exact to the rupee" value={pct(run.metrics.math_exact)} />
            <Metric label="Over-refusal" value={pct(run.metrics.over_refusal)} />
            <Metric
              label={run.metrics.pass_k ? `Passes all ${run.metrics.pass_k.k} repeat runs` : "Repeat-run reliability"}
              value={pct(run.metrics.pass_k?.rate)}
            />
            <Metric
              label="Latency, median and p95"
              value={
                run.metrics.latency_p50_ms !== undefined
                  ? `${(run.metrics.latency_p50_ms / 1000).toFixed(1)} s, ${((run.metrics.latency_p95_ms ?? 0) / 1000).toFixed(1)} s`
                  : "Not measured"
              }
            />
            <Metric
              label="Cost per 1,000 questions"
              value={run.metrics.cost_per_1000_usd !== undefined ? `$${run.metrics.cost_per_1000_usd.toFixed(2)}` : "Not measured"}
            />
          </dl>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Passed</th>
                <th scope="col">Rate</th>
              </tr>
            </thead>
            <tbody>
              {run.categories.map((c) => (
                <tr key={c.name}>
                  <th scope="row">{c.name}</th>
                  <td className="mono">
                    {c.passed} / {c.total}
                  </td>
                  <td>
                    <span className={styles.bar} style={{ ["--w" as string]: `${(c.passed / c.total) * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className={styles.empty}>
          <h2>No run recorded yet</h2>
          <p>
            Numbers appear here after the first run of <code>eval/run_eval.py</code>, which writes{" "}
            <code>eval/results/latest.json</code>. Until then this page shows nothing rather than an estimate.
          </p>
        </div>
      )}

      <section className={styles.cats}>
        <h2>What the red-team set tests</h2>
        <table className={styles.table}>
          <tbody>
            {CATEGORIES.map(([name, what]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
