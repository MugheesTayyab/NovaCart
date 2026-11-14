import fs from "node:fs";
import path from "node:path";

/*
 * Reads /policies/*.md at build time and turns each file into numbered items.
 *
 * Format (organizer README): YAML-ish front matter, "## N. Heading" sections,
 * and items that start with "**N.M**". A table or list belongs to the item that
 * introduces it. Text that is not part of an item (blockquotes, HTML comments,
 * loose paragraphs) is kept out of items and reported as unattached text.
 */

export type Scope = "general" | "specific" | "regional";

export type Block =
  | { kind: "text"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; items: string[] };

export type PolicyItem = {
  id: string; // "06#2.2"
  num: string; // "2.2"
  blocks: Block[];
};

export type PolicySection = { num: string; title: string; items: PolicyItem[] };

export type PolicyFile = {
  num: string; // "06"
  fileName: string; // "06_shipping_fees_and_free_shipping.md"
  docId: string;
  title: string;
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  scope: Scope;
  intro: string[];
  sections: PolicySection[];
  itemCount: number;
  crossRefs: { from: string; toFile: string; toSection?: string }[];
  unattached: string[];
};

const POLICY_DIR = path.join(process.cwd(), "..", "policies");

export const CROSS_REF = /\[file (\d{2})(?:, Section ([\d.]+))?\]/g;

function parseFrontMatter(src: string) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) throw new Error("policy file without front matter");
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseFile(fileName: string): PolicyFile {
  const raw = fs.readFileSync(path.join(POLICY_DIR, fileName), "utf8");
  const { meta, body } = parseFrontMatter(raw);
  const num = fileName.slice(0, 2);

  // Drop HTML comments before parsing; they are never policy text.
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);

  const intro: string[] = [];
  const sections: PolicySection[] = [];
  const unattached: string[] = [];
  let section: PolicySection | null = null;
  let item: PolicyItem | null = null;
  // An item stays open only until a loose paragraph appears.
  let itemOpen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("# ")) continue; // document title, already in front matter

    const h2 = t.match(/^##\s+(\d+)\.\s+(.*)$/);
    if (h2) {
      section = { num: h2[1], title: h2[2], items: [] };
      sections.push(section);
      item = null;
      itemOpen = false;
      continue;
    }

    const it = t.match(/^\*\*(\d+\.\d+)\*\*\s*(.*)$/);
    if (it && section) {
      item = { id: `${num}#${it[1]}`, num: it[1], blocks: [] };
      if (it[2]) item.blocks.push({ kind: "text", text: it[2] });
      section.items.push(item);
      itemOpen = true;
      continue;
    }

    if (t.startsWith("|") && item && itemOpen) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const r = lines[i].trim();
        if (!/^\|[\s|:-]+\|$/.test(r)) rows.push(splitRow(r));
        i++;
      }
      i--;
      const [head, ...rest] = rows;
      item.blocks.push({ kind: "table", head, rows: rest });
      continue;
    }

    const li = t.match(/^(\d+\.|-)\s+(.*)$/);
    if (li && item && itemOpen) {
      const ordered = li[1] !== "-";
      const last = item.blocks[item.blocks.length - 1];
      if (last && last.kind === "list" && last.ordered === ordered) last.items.push(li[2]);
      else item.blocks.push({ kind: "list", ordered, items: [li[2]] });
      continue;
    }

    // Anything else is a loose paragraph: intro text before the first section,
    // otherwise text that no numbered item owns.
    if (!section) intro.push(t);
    else unattached.push(t);
    itemOpen = false;
  }

  const crossRefs: PolicyFile["crossRefs"] = [];
  for (const s of sections)
    for (const itm of s.items)
      for (const b of itm.blocks) {
        const texts =
          b.kind === "text" ? [b.text] : b.kind === "list" ? b.items : b.rows.flat();
        for (const tx of texts)
          for (const m of tx.matchAll(CROSS_REF))
            crossRefs.push({ from: itm.id, toFile: m[1], toSection: m[2] });
      }

  return {
    num,
    fileName,
    docId: meta.doc_id,
    title: meta.title,
    version: meta.version,
    effectiveDate: meta.effective_date,
    lastUpdated: meta.last_updated,
    scope: meta.scope as Scope,
    intro,
    sections,
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
    crossRefs,
    unattached,
  };
}

let cache: PolicyFile[] | null = null;

export function getPolicies(): PolicyFile[] {
  if (!cache) {
    cache = fs
      .readdirSync(POLICY_DIR)
      .filter((f) => /^\d{2}_.*\.md$/.test(f))
      .sort()
      .map(parseFile);
  }
  return cache;
}

export function getPolicy(num: string) {
  return getPolicies().find((p) => p.num === num);
}

/** Look up an item by "06#2.2". Section-level refs ("06#2") return the first item. */
export function getItem(ref: string) {
  const [num, sec] = ref.split("#");
  const file = getPolicy(num);
  if (!file) return undefined;
  for (const s of file.sections)
    for (const it of s.items)
      if (it.num === sec || (!sec.includes(".") && it.num.startsWith(sec + ".")))
        return { file, section: s, item: it };
  return undefined;
}

export function corpusStats() {
  const files = getPolicies();
  return {
    files: files.length,
    items: files.reduce((n, f) => n + f.itemCount, 0),
    crossRefs: files.reduce((n, f) => n + f.crossRefs.length, 0),
    regional: files.filter((f) => f.scope === "regional").length,
  };
}

export type IndexedItem = {
  id: string;
  fileName: string;
  fileTitle: string;
  sectionTitle: string;
  num: string;
  blocks: Block[];
};

/** Flat id -> item map, small enough (about 50 KB) to hand to client components. */
export function itemIndex(): Record<string, IndexedItem> {
  const out: Record<string, IndexedItem> = {};
  for (const f of getPolicies())
    for (const s of f.sections)
      for (const it of s.items)
        out[it.id] = {
          id: it.id,
          fileName: f.fileName,
          fileTitle: f.title,
          sectionTitle: s.title,
          num: it.num,
          blocks: it.blocks,
        };
  return out;
}

export function fileMetas() {
  return getPolicies().map((f) => ({
    num: f.num,
    title: f.title,
    effectiveDate: f.effectiveDate,
    scope: f.scope,
    version: f.version,
  }));
}
