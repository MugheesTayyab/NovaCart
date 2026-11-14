import styles from "./Receipt.module.css";
import { shortRef } from "@/lib/cite";
import type { CalcStep } from "@/lib/contract";

/*
 * The calculation, set like a shop receipt: one line per step, the rule that
 * produced it on the right, the total under a rule line.
 */
export function Receipt({
  title,
  steps,
  onRule,
  compact = false,
}: {
  title?: string;
  steps: CalcStep[];
  onRule?: (rule: string) => void;
  compact?: boolean;
}) {
  const total = steps[steps.length - 1];
  const body = steps.slice(0, -1);
  return (
    <div className={`${styles.receipt} ${compact ? styles.compact : ""}`}>
      {title && <p className={styles.title}>{title}</p>}
      <ol className={styles.lines}>
        {body.map((s) => (
          <li key={s.label} className={styles.line}>
            <span className={styles.label}>
              {s.label}
              {s.formula && !compact && <span className={styles.formula}>{s.formula}</span>}
            </span>
            <span className={styles.leader} aria-hidden="true" />
            <span className={styles.value}>{s.result}</span>
            {!compact && s.rule && <RuleTag rule={s.rule} onRule={onRule} />}
          </li>
        ))}
      </ol>
      {total && (
        <div className={styles.total}>
          <span>{total.label}</span>
          <span className={styles.totalValue}>Rs. {total.result}</span>
          {!compact && total.rule && <RuleTag rule={total.rule} onRule={onRule} />}
        </div>
      )}
    </div>
  );
}

function RuleTag({ rule, onRule }: { rule: string; onRule?: (r: string) => void }) {
  if (!onRule) return <span className={styles.rule}>{shortRef(rule)}</span>;
  return (
    <button type="button" className={`${styles.rule} ${styles.ruleButton}`} onClick={() => onRule(rule)}>
      {shortRef(rule)}
    </button>
  );
}
