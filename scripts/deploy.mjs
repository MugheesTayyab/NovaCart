#!/usr/bin/env node
// One-command deploy to Vercel for the answer API and the web UI.
//
//   node scripts/deploy.mjs              deploy web + api, then check them
//   node scripts/deploy.mjs --api-only   only the api project
//   node scripts/deploy.mjs --dry-run    read and check everything, change nothing
//
// It talks to the Vercel REST API with plain fetch (Node 18+), so it does not
// depend on the Vercel CLI being installed or working. Steps:
//   1. read .env (keys stay on this machine and in Vercel, never printed)
//   2. make sure the web project exists with Root Directory "web"
//   3. set NEXT_PUBLIC_API_URL on web, deploy web from GitHub main, wait
//   4. copy .env to the api project (ALLOWED_ORIGINS gets the web URL), deploy, wait
//   5. check /health says chat is enabled, CORS allows the web origin, the UI loads
// On a failed build it prints the end of the build log. Exit code 0 only if all pass.
//
// Token: VERCEL_TOKEN in the environment or in .env (create one at
// https://vercel.com/account/tokens). Falls back to a non-expired Vercel CLI login.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---- project settings (not secrets) ----
const TEAM_SLUG = process.env.VERCEL_SCOPE || "mugheestayyabs-projects";
const GIT = { org: "MugheesTayyab", repo: "NovaCart", ref: "main" };
const API_PROJECT = process.env.VERCEL_API_PROJECT || "api";
const WEB_PROJECT = process.env.VERCEL_WEB_PROJECT || "novacart-web";
// .env keys that are never copied to Vercel (handled there, or deploy-only).
const SKIP_KEYS = new Set(["POLICY_DIR", "INDEX_CACHE_DIR"]);
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const API_ONLY = args.has("--api-only");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const log = (m = "") => console.log(m);
const step = (m) => console.log(`\n== ${m}`);
const warn = (m) => console.log(`   ! ${m}`);
const ok = (m) => console.log(`   ok ${m}`);
function fail(m) {
  console.log(`   FAIL ${m}`);
  failures.push(m);
}
// Never call process.exit with fetches open: on Windows that crashes libuv.
class Stop extends Error {}
function die(m) {
  throw new Stop(m);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- .env ----------
function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (let line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) {
      v = v.slice(1, v.indexOf(q, 1));
    } else {
      v = v.replace(/(^|\s+)#.*$/, "").trim(); // inline comment, as python-dotenv does
    }
    out[m[1]] = v;
  }
  return out;
}

// ---------- token ----------
function cliToken() {
  const home = os.homedir();
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "com.vercel.cli", "Data", "auth.json"),
    path.join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
    path.join(home, ".local", "share", "com.vercel.cli", "auth.json"),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const a = JSON.parse(fs.readFileSync(f, "utf8"));
      if (a.token && (!a.expiresAt || a.expiresAt * 1000 > Date.now() + 60_000)) return a.token;
    } catch {}
  }
  return null;
}

// ---------- Vercel REST ----------
let TOKEN = null;
let TEAM_ID = null;

async function vercel(method, p, body, { allow404 = false } = {}) {
  const url = new URL("https://api.vercel.com" + p);
  if (TEAM_ID) url.searchParams.set("teamId", TEAM_ID);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      throw new Error(`${method} ${p}: network error ${e.message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      const msg = data?.error?.message || data?.raw || res.statusText;
      throw new Error(`${method} ${p} -> ${res.status}: ${msg}`);
    }
    return data;
  }
}

// ---------- git ----------
function git(...a) {
  const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function checkGit() {
  step("Git (Vercel builds what is on GitHub main, not your local files)");
  if (git("fetch", "-q", "origin", GIT.ref) === null) warn("could not fetch origin; using last known origin/main");
  const head = git("rev-parse", "HEAD");
  const remote = git("rev-parse", `origin/${GIT.ref}`);
  const dirty = git("status", "--porcelain");
  if (!remote) { warn("no origin/main found"); return; }
  ok(`will deploy origin/${GIT.ref} @ ${remote.slice(0, 7)}: ${git("log", "-1", "--format=%s", remote) || ""}`);
  if (head && head !== remote) {
    const ahead = git("rev-list", "--count", `origin/${GIT.ref}..HEAD`);
    if (ahead && ahead !== "0") warn(`${ahead} local commit(s) are NOT pushed and will NOT be deployed. Run: git push`);
  }
  if (dirty) warn("uncommitted changes exist locally; they will NOT be deployed");
}

// ---------- projects ----------
function prodHosts(project) {
  const aliases = project?.targets?.production?.alias || [];
  const clean = aliases.filter((a) => !a.includes("-git-") && !a.endsWith(`-${TEAM_SLUG}.vercel.app`));
  return (clean.length ? clean : aliases).map((a) => a.replace(/^https?:\/\//, ""));
}

async function ensureWebProject() {
  const want = { framework: "nextjs", rootDirectory: "web", sourceFilesOutsideRootDirectory: true };
  let p = await vercel("GET", `/v9/projects/${WEB_PROJECT}`, undefined, { allow404: true });
  if (!p) {
    if (DRY) { warn(`web project "${WEB_PROJECT}" does not exist; would create it`); return null; }
    p = await vercel("POST", "/v11/projects", {
      name: WEB_PROJECT,
      ...want,
      gitRepository: { type: "github", repo: `${GIT.org}/${GIT.repo}` },
    });
    ok(`created project ${WEB_PROJECT} (root: web)`);
    return p;
  }
  const drift = Object.keys(want).filter((k) => p[k] !== undefined && p[k] !== want[k]);
  if (p.rootDirectory !== "web") drift.push("rootDirectory");
  if (drift.length && !DRY) {
    p = await vercel("PATCH", `/v9/projects/${p.id}`, want);
    ok(`fixed project settings: ${[...new Set(drift)].join(", ")}`);
  } else ok(`project ${WEB_PROJECT} exists (root: ${p.rootDirectory || "/"})`);
  return p;
}

async function setEnv(project, vars) {
  const keys = Object.keys(vars);
  log(`   ${project.name}: ${keys.join(", ")}`);
  if (DRY) return;
  const body = keys.map((key) => ({
    key,
    value: vars[key],
    type: "encrypted",
    target: ["production", "preview"],
  }));
  await vercel("POST", `/v10/projects/${project.id}/env?upsert=true`, body);
  ok(`${keys.length} variable(s) set on ${project.name}`);
}

async function deploy(project) {
  if (DRY) { ok(`would deploy ${project.name} from ${GIT.repo}@${GIT.ref}`); return true; }
  const d = await vercel("POST", "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1", {
    name: project.name,
    project: project.id,
    target: "production",
    gitSource: { type: "github", org: GIT.org, repo: GIT.repo, ref: GIT.ref },
  });
  log(`   building ${project.name}: https://${d.url}`);
  const start = Date.now();
  let state = d.readyState;
  while (!["READY", "ERROR", "CANCELED"].includes(state)) {
    if (Date.now() - start > DEPLOY_TIMEOUT_MS) { fail(`${project.name}: build still ${state} after 15 min`); return false; }
    await sleep(5000);
    state = (await vercel("GET", `/v13/deployments/${d.id}`)).readyState;
    process.stdout.write(`   ... ${state} (${Math.round((Date.now() - start) / 1000)}s)\r`);
  }
  log("");
  if (state === "READY") { ok(`${project.name} deployed`); return true; }
  fail(`${project.name}: deployment ${state}`);
  try {
    const ev = await vercel("GET", `/v2/deployments/${d.id}/events?limit=-1`);
    const lines = (Array.isArray(ev) ? ev : []).map((e) => e.text || e.payload?.text).filter(Boolean);
    log("   --- last build log lines ---");
    for (const l of lines.slice(-40)) log("   | " + l);
  } catch (e) { warn(`could not read build log: ${e.message}`); }
  return false;
}

// ---------- live checks ----------
async function httpGet(url, init = {}) {
  for (let i = 1; i <= 6; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (r.status < 500 || i === 6) return r;
    } catch (e) { if (i === 6) throw e; }
    await sleep(3000 * i); // cold starts build the index on first request
  }
}

async function checkApi(apiUrl, webOrigin) {
  step(`Checking ${apiUrl}`);
  try {
    const r = await httpGet(`${apiUrl}/health`);
    const h = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) return fail(`/health returned ${r.status}: Deployment Protection is blocking public access`);
    if (h.chat_enabled === true) ok(`/health: chat enabled, ${h.policies?.loaded ?? "?"} policy files, index ready: ${h.policies?.index_ready}`);
    else fail(`/health: chat disabled. ${(h.config_problems || []).join("; ") || JSON.stringify(h).slice(0, 300)}`);
  } catch (e) { fail(`/health unreachable: ${e.message}`); }
  if (!webOrigin) return;
  try {
    const r = await httpGet(`${apiUrl}/ask`, {
      method: "OPTIONS",
      headers: { Origin: webOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    const allowed = r.headers.get("access-control-allow-origin");
    if (allowed === webOrigin || allowed === "*") ok(`CORS allows ${webOrigin}`);
    else fail(`CORS does not allow ${webOrigin} (got ${allowed || "nothing"})`);
  } catch (e) { fail(`CORS check failed: ${e.message}`); }
}

async function checkWeb(webUrl) {
  step(`Checking ${webUrl}`);
  try {
    const r = await httpGet(webUrl);
    if (r.ok) ok(`web UI loads (${r.status})`);
    else fail(`web UI returned ${r.status}`);
  } catch (e) { fail(`web UI unreachable: ${e.message}`); }
}

// ---------- main ----------
async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) die(`Node 18+ needed (you have ${process.version}).`);

  step("Reading .env");
  const env = parseEnv(path.join(ROOT, ".env"));
  if (!Object.keys(env).length) die(`no .env found at ${path.join(ROOT, ".env")}. Copy .env.example to .env and fill it in.`);
  const missing = ["PRIMARY_LLM_API_KEY", "PRIMARY_LLM_MODEL"].filter((k) => !env[k]);
  if (!env.PRIMARY_LLM_PROVIDER && !env.PRIMARY_LLM_BASE_URL) missing.push("PRIMARY_LLM_PROVIDER or PRIMARY_LLM_BASE_URL");
  if (missing.length) die(`.env is missing: ${missing.join(", ")}`);
  ok("LLM settings present");

  TOKEN = process.env.VERCEL_TOKEN || env.VERCEL_TOKEN || cliToken();
  if (!TOKEN) die(
    "no Vercel token. Create one at https://vercel.com/account/tokens (scope: your team),\n" +
    "then add a line to .env:  VERCEL_TOKEN=<the token>   (.env is git-ignored)"
  );

  step(`Vercel team "${TEAM_SLUG}"`);
  try {
    const t = await vercel("GET", `/v2/teams/${TEAM_SLUG}`);
    TEAM_ID = t.id;
    ok(`team id ${TEAM_ID}`);
  } catch (e) {
    try { await vercel("GET", "/v2/user"); } catch (e2) { die(`Vercel rejected the token (${e2.message}). Make a new one.`); }
    warn(`team lookup failed (${e.message}); using the personal account`);
  }

  checkGit();

  step("Projects");
  const api = await vercel("GET", `/v9/projects/${API_PROJECT}`, undefined, { allow404: true });
  if (!api) die(`api project "${API_PROJECT}" not found in ${TEAM_SLUG}.`);
  const apiUrl = process.env.API_PUBLIC_URL || `https://${prodHosts(api)[0] || `${API_PROJECT}.vercel.app`}`;
  ok(`api project ${api.name} -> ${apiUrl}`);
  if (api.rootDirectory !== "api") warn(`api Root Directory is "${api.rootDirectory || "/"}", expected "api"`);

  let webOrigins = [];
  if (!API_ONLY) {
    step("Web UI");
    let web = await ensureWebProject();
    if (web) {
      await setEnv(web, { NEXT_PUBLIC_API_URL: apiUrl });
      await deploy(web);
      web = await vercel("GET", `/v9/projects/${web.id}`);
      webOrigins = prodHosts(web).map((h) => `https://${h}`);
      if (webOrigins.length) ok(`web URL ${webOrigins[0]}`);
      else warn("web project has no production URL yet");
    }
  }

  step("API");
  const apiVars = {};
  for (const [k, v] of Object.entries(env)) {
    if (!v || k.startsWith("VERCEL") || SKIP_KEYS.has(k)) continue;
    apiVars[k] = v;
  }
  const origins = new Set((env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean));
  for (const o of webOrigins) origins.add(o);
  apiVars.ALLOWED_ORIGINS = [...origins].join(",");
  await setEnv(api, apiVars);
  const apiOk = await deploy(api);

  if (!DRY) {
    if (apiOk) await checkApi(apiUrl, webOrigins[0]);
    if (webOrigins[0]) await checkWeb(webOrigins[0]);
  }

  log("\n================================");
  if (failures.length) {
    log(`NOT OK: ${failures.length} problem(s)`);
    for (const f of failures) log(` - ${f}`);
    process.exitCode = 1;
    return;
  }
  log(DRY ? "Dry run passed. Nothing was changed." : "ALL OK");
  log(`API: ${apiUrl}`);
  if (webOrigins[0]) log(`Web: ${webOrigins[0]}`);
}

main().catch((e) => {
  console.error(`\nSTOPPED: ${e.message}`);
  if (!(e instanceof Stop) && failures.length) console.error(`Earlier problems: ${failures.join("; ")}`);
  process.exitCode = 1;
});
