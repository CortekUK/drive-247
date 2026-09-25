/**
 * Engine mechanics — scripts/sync-payment-plans.mjs refuses to mirror a file
 * that would not run in all three runtimes (Deno, Next/browser, Node), and the
 * canonical directory obeys those rules today.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error — a plain .mjs script, no type declarations
import { checkSource, CANONICAL_DIR } from "../../../scripts/sync-payment-plans.mjs";

const header = "/**\n * x\n *\n * Canonical copy: supabase/functions/_shared/payment-plans/. Edit here.\n */\n";

describe("sync-payment-plans rules", () => {
  it("accepts relative sibling imports and runtime-neutral code", () => {
    expect(checkSource("ok.ts", `${header}import { a } from "./a.ts";\nexport const b = a;\n`)).toEqual([]);
  });

  it("refuses npm:, URL, bare and alias imports, and dynamic import()", () => {
    for (const spec of ["npm:date-fns", "https://esm.sh/x", "stripe", "@/lib/x", "../outside.ts", "./no-extension"]) {
      expect(checkSource("bad.ts", `${header}import x from "${spec}";\n`).length, spec).toBe(1);
    }
    expect(checkSource("bad.ts", `${header}const m = await import("./a.ts");\n`)).toHaveLength(1);
  });

  it("refuses Deno., process. and window. in code but not in comments", () => {
    expect(checkSource("bad.ts", `${header}export const k = Deno.env.get("X");\n`)).toHaveLength(1);
    expect(checkSource("bad.ts", `${header}export const k = process.env.X;\n`)).toHaveLength(1);
    expect(checkSource("bad.ts", `${header}export const k = window.location;\n`)).toHaveLength(1);
    expect(checkSource("ok.ts", `${header}// Deno.env is not used here\nexport const k = 1;\n`)).toEqual([]);
  });

  it("refuses a file without the canonical-copy header", () => {
    expect(checkSource("nohead.ts", "export const k = 1;\n")).toHaveLength(1);
  });

  it("every canonical file passes today", () => {
    const names = readdirSync(CANONICAL_DIR).filter((n: string) => n.endsWith(".ts"));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(checkSource(n, readFileSync(path.join(CANONICAL_DIR, n), "utf8")), n).toEqual([]);
  });
});
