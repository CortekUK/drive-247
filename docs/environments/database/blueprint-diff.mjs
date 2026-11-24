#!/usr/bin/env node
/**
 * blueprint-diff.mjs — a second opinion that shares no code with db-eval.
 *
 * db-eval describes each object with queries we wrote. If one of those queries
 * leaves a detail out, it leaves it out on both sides and the check passes.
 * So this script uses Postgres' own tool, pg_dump, to write out the full
 * blueprint of each database, and compares the two blueprints object by object.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/environments/database/blueprint-diff.mjs
 *   --keep    leave the two dump files in reports/blueprints/ for reading
 *
 * Needs pg_dump 17 (brew install postgresql@17, or set PG_DUMP to its path).
 *
 * How it connects: it asks Supabase for a login that expires after 5 minutes,
 * the same way `supabase db dump` does. The dump is schema-only and runs in a
 * read-only session, so no row is read and nothing can be changed. This is the
 * one place the evals ask production for anything other than a query result.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HERE, PROD_REF, TARGET, TOKEN, flag, compare, mgmtGet, applyExceptions, report, requireSetup, isMain, die } from "./lib.mjs";

const run = promisify(execFile);
export const SCHEMAS = ["public", "private", "turo_syntax_check"];
// Fewest objects prod's blueprint must contain before the comparison is believed.
const FLOOR = 5000;

export async function findPgDump() {
  const candidates = [process.env.PG_DUMP, "/opt/homebrew/opt/postgresql@17/bin/pg_dump", "/usr/local/opt/postgresql@17/bin/pg_dump", "pg_dump"].filter(Boolean);
  for (const bin of candidates) {
    try {
      const { stdout } = await run(bin, ["--version"]);
      if (Number(stdout.match(/(\d+)\./)?.[1]) >= 17) return bin;
    } catch { /* try the next one */ }
  }
  die("blueprint-diff: needs pg_dump 17 or newer. Run `brew install postgresql@17` or set PG_DUMP.");
}

async function temporaryLogin(ref) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/cli/login-role`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" },
      body: JSON.stringify({ read_only: false }),
    }).catch(() => null);
    if (res?.ok) return res.json();
    // Supabase sometimes answers 500 here for a moment. Wait and ask again.
    if (attempt < 5 && (!res || res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(`${ref}: could not get a temporary login (HTTP ${res?.status ?? "no answer"})`);
  }
}

export async function dump(pgDump, ref, file) {
  const pooler = await mgmtGet(ref, "/config/database/pooler");
  const host = (Array.isArray(pooler) ? pooler[0] : pooler).db_host;
  // A dump is two minutes over the network. A dropped connection gets a fresh login and another go.
  for (let attempt = 1; ; attempt++) {
    const login = await temporaryLogin(ref);
    try {
      await run(
        pgDump,
        ["-h", host, "-p", "5432", "-U", `${login.role}.${ref}`, "-d", "postgres", "--role=postgres", "--schema-only", ...SCHEMAS.map((s) => `--schema=${s}`), "-f", file],
        // Read-only session: even a bug in this script could not change the database it is reading.
        { env: { ...process.env, PGPASSWORD: login.password, PGSSLMODE: "require", PGOPTIONS: "-c default_transaction_read_only=on" }, maxBuffer: 1 << 26 },
      );
      break;
    } catch (e) {
      if (attempt === 3) throw new Error(`${ref}: pg_dump failed three times. ${String(e.stderr || e.message).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  return readFileSync(file, "utf8");
}

/** Split a dump into its objects: "TYPE schema name" -> definition text. */
function objects(text) {
  const rows = [];
  const seen = new Map();
  for (const block of text.split(/^--\n-- (?=Name: )/m).slice(1)) {
    const head = block.match(/^Name: (.*?); Type: (.*?); Schema: (.*?); Owner: ?(.*)$/m);
    if (!head) continue;
    const [, name, type, schema] = head;
    let k = `${type} ${schema} ${name}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) k += ` #${n}`;
    const lines = block
      .split("\n")
      .slice(1)
      // Comment lines and pg_dump's per-run random \restrict token are not part of the schema.
      .filter((l) => !l.startsWith("--") && !l.startsWith("\\restrict") && !l.startsWith("\\unrestrict") && l.trim() !== "")
      // Newer Supabase images stamp an internal `pg_attver` option on every column of every
      // schema, Postgres' own included. It is the platform's bookkeeping, not part of our schema.
      .filter((l) => !/^ALTER TABLE ONLY .* ALTER COLUMN .* SET \(pg_attver=\d+\);$/.test(l));
    // A permission block is a set of one-line GRANTs. Postgres stores them in the order
    // they were granted, which is history, not structure, so the order is not compared.
    const d = (/ACL$/.test(type) ? lines.sort() : lines).join("\n");
    rows.push({ k, d });
  }
  return rows;
}

export async function runBlueprintDiff() {
  const pgDump = await findPgDump();
  const dir = flag("keep") ? join(HERE, "reports", "blueprints") : join(tmpdir(), `d247-blueprints-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const prodFile = join(dir, "prod.sql");
  const stagFile = join(dir, "staging.sql");
  try {
    const [prodText, stagText] = await Promise.all([dump(pgDump, PROD_REF, prodFile), dump(pgDump, TARGET, stagFile)]);
    if (/^(COPY |INSERT INTO )/m.test(prodText)) die("blueprint-diff: the prod dump contains row data. Refusing to continue.");
    const r = compare("blueprint", objects(prodText), objects(stagText));
    if (r.prod < FLOOR) r.problems.push(`prod blueprint has ${r.prod} objects, floor is ${FLOOR}: too few to trust this comparison`);
    return [r];
  } finally {
    if (!flag("keep") && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  requireSetup();
  const { ok } = await report("blueprint-diff", applyExceptions(await runBlueprintDiff()));
  process.exit(ok ? 0 : 1);
}
