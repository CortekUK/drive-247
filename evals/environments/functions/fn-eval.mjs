#!/usr/bin/env node
/**
 * fn-eval.mjs — are staging's edge functions the same as prod's?
 *
 *   SUPABASE_ACCESS_TOKEN=… node evals/environments/functions/fn-eval.mjs
 *   --only same_list,same_lock     run some checks
 *   --no-knock                     skip the same_answer check
 *   --no-cache                     download every function again (slow: about 10 minutes)
 *
 * The target is "what prod actually runs", not "what is in git": the code is
 * compared by downloading the deployed bundle from both projects.
 *
 * It never writes anywhere. The only thing it sends to a function is an
 * OPTIONS request, the browser's "may I call you?" question. A real request,
 * even an empty one, could start a payment or email job, so none is ever sent.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROD_REF, TARGET, arg, flag, mgmtGet, mgmtBytes, compare, blankResult, applyExceptions, report, requireSetup, isMain } from "../database/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Fewest functions prod must report before any comparison is believed.
const FLOOR = 300;
const CACHE = join(HERE, ".fingerprints.json");
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Run `fn` over `items`, a few at a time. */
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const claims = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()); } catch { return {}; } };

/**
 * Where a bundle still points at production. The bundle records the folder it
 * was built in, which carries the project ref (/tmp/user_fn_<ref>_…). That is a
 * label, not an address anything calls, so it is not counted.
 */
function prodPointers(buf) {
  const text = buf.toString("latin1");
  const hits = [];
  let refs = 0;
  for (let i = text.indexOf(PROD_REF); i !== -1; i = text.indexOf(PROD_REF, i + 1)) {
    if (text.slice(Math.max(0, i - 8), i) !== "user_fn_") refs++;
  }
  if (refs) hits.push(`prod address x${refs}`);
  const keys = [...text.matchAll(JWT)].filter((m) => claims(m[0]).ref === PROD_REF).length;
  if (keys) hits.push(`prod key x${keys}`);
  return hits;
}

async function knock(ref, slug) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://${ref}.supabase.co/functions/v1/${slug}`, { method: "OPTIONS", headers: { Origin: "https://eval.invalid", "Access-Control-Request-Method": "POST" } });
      await res.arrayBuffer();
      if (attempt < 4 && (res.status === 429 || res.status === 502 || res.status === 504)) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      return String(res.status);
    } catch (e) {
      if (attempt < 4) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      return `no answer (${e.message})`;
    }
  }
}

export const CHECK_NAMES = ["same_list", "same_lock", "same_code", "same_answer", "no_prod_pointers"];

export async function runFnEval(only) {
  const want = (n) => !only || only.includes(n);
  const [prod, stag] = await Promise.all([mgmtGet(PROD_REF, "/functions"), mgmtGet(TARGET, "/functions")]);
  const results = [];
  const floor = (r) => { if (r.prod < FLOOR) r.problems.push(`prod reports ${r.prod} functions, floor is ${FLOOR}: too few to trust`); return r; };

  if (want("same_list")) results.push(floor(compare("same_list", prod.map((f) => ({ k: f.slug, d: f.status })), stag.map((f) => ({ k: f.slug, d: f.status })))));
  if (want("same_lock")) {
    const row = (f) => ({ k: f.slug, d: `verify_jwt=${f.verify_jwt} import_map=${!!f.import_map}` });
    results.push(floor(compare("same_lock", prod.map(row), stag.map(row))));
  }

  if (want("same_code") || want("no_prod_pointers")) {
    const pointers = [];
    // A function's code only changes when it is deployed, and every deploy bumps its
    // version. So a fingerprint taken once stays true for that version, and a later
    // run downloads only what has been deployed since.
    const cache = existsSync(CACHE) && !flag("no-cache") ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    const digest = async (ref, list, scan) =>
      pool(list, 6, async (f) => {
        const id = `${ref}/${f.slug}/v${f.version}/${f.updated_at}`;
        let hit = cache[id];
        if (!hit) {
          const body = await mgmtBytes(ref, `/functions/${f.slug}/body`);
          hit = body ? { d: `${sha(body)} ${body.length} bytes`, pointers: prodPointers(body) } : { d: "no code", pointers: [] };
          cache[id] = hit;
        }
        if (scan && hit.pointers.length) pointers.push(`${f.slug}: ${hit.pointers.join(", ")}`);
        return { k: f.slug, d: hit.d };
      });
    const [p, s] = await Promise.all([digest(PROD_REF, prod, false), digest(TARGET, stag, true)]);
    // Keep only the entries for versions that are deployed right now.
    const live = new Set([...prod.map((f) => `${PROD_REF}/${f.slug}/v${f.version}/${f.updated_at}`), ...stag.map((f) => `${TARGET}/${f.slug}/v${f.version}/${f.updated_at}`)]);
    writeFileSync(CACHE, JSON.stringify(Object.fromEntries(Object.entries(cache).filter(([k]) => live.has(k)))));
    if (want("same_code")) results.push(floor(compare("same_code", p, s)));
    if (want("no_prod_pointers")) {
      const r = blankResult("no_prod_pointers", "safety");
      r.staging = stag.length;
      r.extra = pointers.sort();
      results.push(r);
    }
  }

  if (want("same_answer") && !flag("no-knock")) {
    const ask = (ref, list) => pool(list, 8, async (f) => ({ k: f.slug, d: `OPTIONS -> ${await knock(ref, f.slug)}` }));
    const [p, s] = await Promise.all([ask(PROD_REF, prod), ask(TARGET, stag)]);
    results.push(floor(compare("same_answer", p, s)));
  }
  return results;
}

export const fnReport = (script, results) =>
  report(script, applyExceptions(results, join(HERE, "accepted-differences.json")), { home: HERE, title: "Drive247 edge functions eval" });

if (isMain(import.meta.url)) {
  requireSetup();
  const only = arg("only")?.split(",").map((s) => s.trim());
  const { ok } = await fnReport("fn-eval", await runFnEval(only));
  process.exit(ok ? 0 : 1);
}
