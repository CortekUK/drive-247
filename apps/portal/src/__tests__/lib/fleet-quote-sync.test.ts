import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Drift gate for the Deno copy of the fleet-quote logic.
 *
 * The fleet-quote API (supabase/functions/fleet-quote-api) cannot import from
 * apps/portal — different runtimes — so supabase/functions/_shared/ holds a
 * generated copy. If the two drift, the chatbot starts quoting different prices
 * from the ones the operator sees on the Fleet Quotes screen, and nothing would
 * otherwise catch it: this repo has no CI (.github/ does not exist), so the
 * portal's vitest run is the only gate that actually executes.
 *
 * If this test fails, run:  node scripts/sync-fleet-quote.mjs
 */

const ROOT = resolve(__dirname, "../../../../..");

describe("fleet-quote shared copy", () => {
  it("has not drifted from the portal source", () => {
    // The generator's own --check does the comparison, and additionally enforces
    // the four preconditions (prologue shape, no stray imports, price file stays
    // import-free, formatCurrency still agreeing) that make the copy valid at all.
    expect(() =>
      execFileSync("node", ["scripts/sync-fleet-quote.mjs", "--check"], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("keeps the generated body byte-identical to the portal source", () => {
    // Belt and braces: assert the byte-identity directly rather than trusting the
    // generator to be checking what it claims. A generator bug that silently
    // emitted a truncated file would pass --check but fail here.
    const src = readFileSync(resolve(ROOT, "apps/portal/src/lib/fleet-quote.ts"), "utf8");
    const genPath = resolve(ROOT, "supabase/functions/_shared/fleet-quote.ts");
    expect(existsSync(genPath)).toBe(true);
    const gen = readFileSync(genPath, "utf8");

    const srcMarker = 'import { formatCurrency } from "@/lib/format-utils";\n';
    const genMarker = 'import { formatCurrency } from "./format-utils.ts";\n';
    const srcBody = src.slice(src.indexOf(srcMarker) + srcMarker.length);
    const genBody = gen.slice(gen.indexOf(genMarker) + genMarker.length);

    expect(genBody).toBe(srcBody);
    expect(srcBody.length).toBeGreaterThan(1000); // guard against both being empty
  });

  it("never lets the generated copy carry an unrewritten bare import", () => {
    // "@/lib/..." resolves under Next.js and not under Deno. If one survives the
    // rewrite the function 500s on cold start, which is the worst place to find out.
    const gen = readFileSync(
      resolve(ROOT, "supabase/functions/_shared/fleet-quote.ts"),
      "utf8",
    );
    expect(gen).not.toMatch(/from\s+["']@\//);
  });
});
