#!/usr/bin/env node
/**
 * copy-from-prod.mjs — put on staging exactly the edge functions prod is running.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/evals/environments/functions/copy-from-prod.mjs
 *   --dry-run            show what would be copied, change nothing
 *   --only a,b           copy just these functions
 *   --prune              also delete staging functions that prod does not have
 *
 * How: it downloads each function's deployed bundle from prod and uploads those
 * same bytes to staging, with the same verify_jwt setting. Nothing is rebuilt,
 * so staging cannot end up with different code. Each function is copied on its
 * own and then downloaded back from staging to prove the bytes landed: a deploy
 * that "succeeded" is not trusted until that check passes.
 *
 * Prod is only read. A function that is already identical is skipped, so it is
 * safe to run again at any time. It ends by running fn-eval.
 */
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { PROD_REF, TARGET, TOKEN, arg, flag, mgmtGet, mgmtBytes, requireSetup, die } from "../database/lib.mjs";
import { runFnEval, fnReport } from "./fn-eval.mjs";

requireSetup();
const DRY = flag("dry-run");
const only = arg("only")?.split(",").map((s) => s.trim());
const sha = (b) => createHash("sha256").update(b).digest("hex");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

/** The one place this script writes. It can only ever address staging. */
async function writeStaging(method, path, body, type) {
  if (TARGET === PROD_REF) die("Target is production. Refusing.");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${TARGET}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": UA, ...(type ? { "Content-Type": type } : {}) },
      body,
    }).catch(() => null);
    if (res?.ok) return;
    if (attempt < 5 && (!res || res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
    throw new Error(`HTTP ${res?.status ?? "no answer"} ${res ? (await res.text()).slice(0, 200) : ""}`);
  }
}

const [prodAll, stag] = await Promise.all([mgmtGet(PROD_REF, "/functions"), mgmtGet(TARGET, "/functions")]);
const prod = only ? prodAll.filter((f) => only.includes(f.slug)) : prodAll;
if (only && prod.length !== only.length) die(`Not on prod: ${only.filter((s) => !prodAll.some((f) => f.slug === s)).join(", ")}`);
const onStaging = new Map(stag.map((f) => [f.slug, f]));
const extras = stag.filter((f) => !prodAll.some((p) => p.slug === f.slug));
console.log(`prod runs ${prodAll.length} functions, staging has ${stag.length}. Checking ${prod.length}.`);

let copied = 0, same = 0, done = 0;
const failed = [];
let next = 0;
async function worker() {
  while (next < prod.length) {
    const f = prod[next++];
    try {
      const body = await mgmtBytes(PROD_REF, `/functions/${f.slug}/body`);
      if (!body) throw new Error("prod has no code for it");
      const there = onStaging.get(f.slug);
      const current = there ? await mgmtBytes(TARGET, `/functions/${f.slug}/body`) : null;
      if (current && sha(current) === sha(body) && there.verify_jwt === f.verify_jwt) { same++; continue; }
      if (DRY) { copied++; continue; }
      // The upload format is "EZBR" followed by the bundle, brotli-compressed.
      const upload = Buffer.concat([Buffer.from("EZBR"), brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })]);
      const q = new URLSearchParams({ slug: f.slug, name: f.name, verify_jwt: String(f.verify_jwt), entrypoint_path: f.entrypoint_path, import_map: String(!!f.import_map) });
      if (f.import_map_path) q.set("import_map_path", f.import_map_path);
      await writeStaging(there ? "PATCH" : "POST", there ? `/functions/${f.slug}?${q}` : `/functions?${q}`, upload, "application/vnd.denoland.eszip");
      // Do not believe the upload. Read it back.
      const back = await mgmtBytes(TARGET, `/functions/${f.slug}/body`);
      if (!back || sha(back) !== sha(body)) throw new Error("uploaded, but staging does not hold the same bytes");
      copied++;
    } catch (e) {
      failed.push(`${f.slug}: ${e.message}`);
    } finally {
      done++;
      if (done % 20 === 0 || done === prod.length) process.stdout.write(`\r  ${done}/${prod.length}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`\n${DRY ? "would copy" : "copied"} ${copied}, already identical ${same}, failed ${failed.length}`);
failed.forEach((f) => console.log(`  ! ${f}`));

if (extras.length) {
  console.log(`on staging but not on prod (${extras.length}): ${extras.map((f) => f.slug).join(", ")}`);
  if (flag("prune") && !DRY) {
    for (const f of extras) await writeStaging("DELETE", `/functions/${f.slug}`);
    console.log("  deleted from staging.");
  }
}
if (DRY) { console.log("Dry run: nothing was changed."); process.exit(0); }

console.log("\nRunning fn-eval to prove it ...");
const { ok } = await fnReport("copy-from-prod", await runFnEval(only ? ["same_code", "same_lock", "no_prod_pointers"] : undefined));
process.exit(ok && !failed.length ? 0 : 1);
