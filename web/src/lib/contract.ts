/*
 * The answer contract between the UI and the answer API (POST /ask).
 * Mirrors the blueprint's output contract. If the organizers' scorer needs a
 * different shape, the API adapts to it; the UI only reads these fields.
 */

export type AnswerStatus = "answered" | "partial" | "not_covered" | "needs_info" | "conflict" | "unavailable";

/** Citation as used in the policy files: file number plus item, e.g. { file: "01", section: "5.3" }. */
export type SourceRef = { file: string; section: string };

export type CalcStep = {
  label: string;
  formula?: string;
  result: string;
  rule?: string; // "01#5.3"
};

export type RuleStep = { rule: string; reason: string };

export type SlotOutcome = { value: string; outcome: string; rule?: string };

export type AskRequest = {
  question: string;
  history?: { role: "customer" | "desk"; text: string }[];
};

export type AskResponse = {
  status: AnswerStatus;
  /** Customer-facing text. Citations are inline as [NN_file.md, Section X] or [file NN, Section X]. */
  answer: string;
  sources: SourceRef[];
  calculation: CalcStep[];
  rule_order: RuleStep[];
  clarifying_question: string | null;
  not_covered_parts: string[];
  meta: {
    latency_ms?: number;
    tokens?: number;
    model_route?: string[];
    cache_hit?: boolean;
    /** Details the desk read from the question (region, dates, category...). */
    slots?: Record<string, string | null>;
    /** Contact date the version check used, and the files in force on it. */
    contact_date?: string;
    files_in_force?: string[];
    /** Required notices, e.g. when two versions of a policy differ (file 00, Section 4.2). */
    notices?: string[];
    /** When the desk asks a question: the outcomes that made the missing detail decisive. */
    slot_test?: { slot: string; outcomes: SlotOutcome[] };
    preview?: boolean;
    /** Set by the answer service. */
    request_id?: string;
    session_id?: string;
    fallback_used?: boolean;
    interrupted?: boolean;
    degraded?: boolean;
    flagged_citations?: string[];
    calc_status?: string | null;
    timings_ms?: Record<string, number>;
    evidence?: { id: string; status: string; why: string }[];
  };
};

export const STATUS_LABEL: Record<AnswerStatus, string> = {
  answered: "Covered",
  partial: "Partly covered",
  not_covered: "Not covered",
  needs_info: "Needs one detail",
  conflict: "Files disagree",
  unavailable: "Answer unavailable",
};
