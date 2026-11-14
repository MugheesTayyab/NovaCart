/* Client-safe helpers for citations and the version check (file 00, Sections 3 and 4). */

export type Segment = { kind: "text"; text: string } | { kind: "ref"; file: string; section?: string; raw: string };

const REF = /\[file (\d{2})(?:, Section ([\d.]+))?\]/g;

/** Splits text on the corpus citation form "[file NN, Section X]". */
export function splitCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "ref", file: m[1], section: m[2], raw: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function refId(file: string, section?: string) {
  return section ? `${file}#${section}` : file;
}

/** "01#5.3" -> "01 §5.3" */
export function shortRef(id: string) {
  const [f, s] = id.split("#");
  return s ? `${f} §${s}` : `File ${f}`;
}

export type FileMeta = { num: string; title: string; effectiveDate: string; scope: string; version: string };

export type FileState = "in-force" | "superseded" | "not-yet";

/**
 * Applies file 00 Section 3.1 (in force when effective_date <= contact date) and
 * marks a general file as superseded when a later general file on the same topic is
 * in force (Section 4.2). Topic pairs come from the policy titles and are listed
 * explicitly, so nothing here is guessed from wording.
 */
const SAME_TOPIC: [older: string, newer: string, note: string][] = [
  ["02", "01", "Returns policy version 2 is replaced by version 3 (file 01)."],
  ["06", "21", "Fees for Metro cities and Rest of Pakistan in file 06 are replaced by file 21."],
];

export function fileStates(files: FileMeta[], contactDate: string) {
  const inForce = new Set(files.filter((f) => f.effectiveDate <= contactDate).map((f) => f.num));
  const states: Record<string, { state: FileState; note?: string }> = {};
  for (const f of files) states[f.num] = { state: inForce.has(f.num) ? "in-force" : "not-yet" };
  for (const [older, newer, note] of SAME_TOPIC) {
    if (inForce.has(older) && inForce.has(newer)) {
      // File 21 replaces only the fee table of file 06; the rest of 06 stays in force.
      states[older] = older === "06" ? { state: "in-force", note: "Fee table replaced by file 21." } : { state: "superseded", note };
    }
  }
  return states;
}
