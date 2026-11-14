/* Client-safe helpers for citations and the version check (file 00, Sections 3 and 4). */

export type Segment = { kind: "text"; text: string } | { kind: "ref"; file: string; section?: string; raw: string };

// "[file 06, Section 2.2]" (the files' own form) or "[Source: 06_shipping_fees_and_free_shipping.md,
// Section 2.2]" (the answer service's form, which names the actual file; "Source: " is optional).
const REF = /\[(?:Source:\s*)?file (\d{2})(?:, Section ([\d.]+))?\]|\[(?:Source:\s*)?(\d{2})_[a-z0-9_]+\.md, Section ([\d.]+)\]/g;

/** Splits text on any of the citation forms. */
export function splitCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "ref", file: m[1] ?? m[3], section: m[2] ?? m[4], raw: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export type AnswerPart =
  | { kind: "text"; text: string }
  /** A numbered source marker. `id` is null while the answer is still arriving. */
  | { kind: "marker"; n: number; id: string | null };

// A marker "[1]" (the answer service's form), or one of the long forms above.
const MARK = /\[(\d{1,2})\]|\[(?:Source:\s*)?file (\d{2})(?:, Section ([\d.]+))?\]|\[(?:Source:\s*)?(\d{2})_[a-z0-9_]+\.md, Section ([\d.]+)\]/g;

/**
 * Splits an answer into lines of text and numbered markers. "[n]" is sources[n - 1];
 * long citations (the hand-checked samples) are numbered in order of first appearance.
 * Also returns the ids in marker order, so a source list can carry the same numbers.
 */
export function parseAnswer(text: string, sources?: SourceRefLike[]): { lines: AnswerPart[][]; refs: string[] } {
  const refs: string[] = [];
  const lines = text
    .split(/\n+/)
    .filter((l) => l.trim())
    .map((line) => {
      const out: AnswerPart[] = [];
      let last = 0;
      for (const m of line.matchAll(MARK)) {
        if (m.index! > last) out.push({ kind: "text", text: line.slice(last, m.index) });
        last = m.index! + m[0].length;
        if (m[1]) {
          const n = Number(m[1]);
          const src = sources?.[n - 1];
          const id = src ? refId(src.file, src.section) : null;
          if (id && !refs.includes(id)) refs[n - 1] = id;
          out.push({ kind: "marker", n, id });
        } else {
          const id = refId(m[2] ?? m[4], m[3] ?? m[5]);
          if (!refs.includes(id)) refs.push(id);
          out.push({ kind: "marker", n: refs.indexOf(id) + 1, id });
        }
      }
      if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
      return out;
    });
  return { lines, refs: refs.filter(Boolean) };
}

type SourceRefLike = { file: string; section?: string };

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
