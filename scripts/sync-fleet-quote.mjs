#!/usr/bin/env node
/**
 * sync-fleet-quote.mjs
 * ---------------------------------------------------------------------------
 * The fleet-quote logic has to run in two runtimes that cannot import from each
 * other: apps/portal (Next.js/TypeScript) and supabase/functions (Deno). The
 * portal copy is the ONLY source of truth — it is the one with 603 lines of
 * tests behind it and the one the operator's Fleet Quotes page renders from.
 *
 * This generator copies it into supabase/functions/_shared/, rewriting only the
 * import prologue (bare-specifier "@/lib/..." -> relative "./....ts", which Deno
 * requires) and leaving every line of logic BYTE-IDENTICAL.
 *
 * Why a generator rather than a hand-copy: this repo already carries
 * calculate-rental-price.ts duplicated between apps, and that is exactly how two
 * copies silently drift into disagreeing about money. `--check` turns drift into
 * a failing test instead of a support ticket. There is no CI in this repo
 * (.github/ does not exist), so the gate is a vitest test inside apps/portal —
 * the only harness that actually runs.
 *
 *   node scripts/sync-fleet-quote.mjs           regenerate
 *   node scripts/sync-fleet-quote.mjs --check    exit 1 if the copies have drifted
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => resolve(ROOT, ...s);

const SRC_QUOTE = p("apps/portal/src/lib/fleet-quote.ts");
const SRC_PRICE = p("apps/portal/src/lib/calculate-rental-price.ts");
const OUT_QUOTE = p("supabase/functions/_shared/fleet-quote.ts");
const OUT_PRICE = p("supabase/functions/_shared/calculate-rental-price.ts");

const PORTAL_FORMAT_UTILS = p("apps/portal/src/lib/format-utils.ts");
const SHARED_FORMAT_UTILS = p("supabase/functions/_shared/format-utils.ts");

/**
 * The exact prologue we expect at the top of the portal's fleet-quote.ts. If it
 * changes — a new import, a reordering — the rewrite below is no longer valid
 * and we must fail loudly rather than emit a file that compiles but imports the
 * wrong thing.
 */
const EXPECTED_PROLOGUE = `import {
  calculateRentalPriceBreakdown,
  type Holiday,
  type TenantWeekendConfig,
  type VehicleDailyPrice,
  type VehicleOverride,
} from "@/lib/calculate-rental-price";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { formatCurrency } from "@/lib/format-utils";
`;

const DENO_PROLOGUE = `// ============================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Produced by scripts/sync-fleet-quote.mjs from
//   apps/portal/src/lib/fleet-quote.ts
// Everything below the prologue is byte-identical to that file. Edit the portal
// copy and re-run the generator; a hand-edit here will be silently overwritten
// and will make the API disagree with the operator's Fleet Quotes screen.
// ============================================================================
import {
  calculateRentalPriceBreakdown,
  type Holiday,
  type TenantWeekendConfig,
  type VehicleDailyPrice,
  type VehicleOverride,
} from "./calculate-rental-price.ts";
import { formatInTimeZone, fromZonedTime } from "npm:date-fns-tz@3.2.0";
import { formatCurrency } from "./format-utils.ts";
`;

const PRICE_PROLOGUE = `// ============================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Produced by scripts/sync-fleet-quote.mjs from
//   apps/portal/src/lib/calculate-rental-price.ts
// Byte-identical to that file (it has no imports of its own, so nothing is
// rewritten). Edit the portal copy and re-run the generator.
// ============================================================================
`;

function fail(msg) {
  console.error(`\n  sync-fleet-quote: ${msg}\n`);
  process.exit(1);
}

function build() {
  for (const f of [SRC_QUOTE, SRC_PRICE, PORTAL_FORMAT_UTILS, SHARED_FORMAT_UTILS]) {
    if (!existsSync(f)) fail(`missing required file: ${f.replace(ROOT + "/", "")}`);
  }

  const quote = readFileSync(SRC_QUOTE, "utf8");
  const price = readFileSync(SRC_PRICE, "utf8");

  // PRECONDITION 1 — the prologue we rewrite must be exactly what we expect.
  if (!quote.startsWith(EXPECTED_PROLOGUE)) {
    fail(
      "the import prologue of apps/portal/src/lib/fleet-quote.ts has changed.\n" +
      "  The generator rewrites those imports for Deno and can no longer do so safely.\n" +
      "  Update EXPECTED_PROLOGUE and DENO_PROLOGUE in this script, then re-run.",
    );
  }
  const body = quote.slice(EXPECTED_PROLOGUE.length);

  // PRECONDITION 2 — no import may appear below the prologue. Deno would need it
  // rewritten too, and we would emit a file that fails at runtime, not build time.
  const strayImport = body.match(/^\s*import\s.+\sfrom\s+["'].+["']/m);
  if (strayImport) {
    fail(
      `a new import appeared below the prologue in fleet-quote.ts:\n    ${strayImport[0].trim()}\n` +
      "  Move it into the prologue and teach the generator how to rewrite it.",
    );
  }

  // PRECONDITION 3 — calculate-rental-price.ts must stay import-free, otherwise
  // it cannot be copied verbatim into Deno.
  const priceImport = price.match(/^\s*import\s.+\sfrom\s+["'].+["']/m);
  if (priceImport) {
    fail(
      `calculate-rental-price.ts gained an import:\n    ${priceImport[0].trim()}\n` +
      "  It is copied verbatim for Deno and must remain dependency-free.",
    );
  }

  // PRECONDITION 4 — formatCurrency is imported from _shared rather than copied,
  // so the two definitions must still agree or the API will format money
  // differently from the portal.
  const grab = (src) => {
    const m = readFileSync(src, "utf8").match(
      /export function formatCurrency[\s\S]*?\n}\n/,
    );
    return m ? m[0] : null;
  };
  const portalFc = grab(PORTAL_FORMAT_UTILS);
  const sharedFc = grab(SHARED_FORMAT_UTILS);
  if (!portalFc || !sharedFc) fail("could not locate formatCurrency in one of the format-utils files");
  if (portalFc !== sharedFc) {
    fail(
      "formatCurrency has diverged between\n" +
      "    apps/portal/src/lib/format-utils.ts\n" +
      "    supabase/functions/_shared/format-utils.ts\n" +
      "  The API would format currency differently from the portal. Reconcile them.",
    );
  }

  return {
    quote: DENO_PROLOGUE + body,
    price: PRICE_PROLOGUE + price,
  };
}

const out = build();
const check = process.argv.includes("--check");

if (check) {
  const drift = [];
  for (const [label, file, expected] of [
    ["fleet-quote.ts", OUT_QUOTE, out.quote],
    ["calculate-rental-price.ts", OUT_PRICE, out.price],
  ]) {
    if (!existsSync(file)) drift.push(`${label}: generated copy is missing`);
    else if (readFileSync(file, "utf8") !== expected) drift.push(`${label}: generated copy is stale`);
  }
  if (drift.length) {
    console.error(
      `\n  supabase/functions/_shared has drifted from apps/portal/src/lib:\n` +
      drift.map((d) => `    - ${d}`).join("\n") +
      `\n\n  Run:  node scripts/sync-fleet-quote.mjs\n`,
    );
    process.exit(1);
  }
  console.log("  fleet-quote shared copies are in sync");
  process.exit(0);
}

writeFileSync(OUT_QUOTE, out.quote);
writeFileSync(OUT_PRICE, out.price);
console.log("  wrote supabase/functions/_shared/fleet-quote.ts");
console.log("  wrote supabase/functions/_shared/calculate-rental-price.ts");
