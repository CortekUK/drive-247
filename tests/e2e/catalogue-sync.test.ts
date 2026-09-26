/**
 * The e2e-runner's catalogue is a generated mirror of tests/e2e/scenarios, and
 * must stay one: ONE catalogue, byte-identical in both places.
 *
 * On a failure: edit tests/e2e/scenarios/*.ts, then run
 *   node tests/e2e/sync-catalogue.mjs
 * Never edit supabase/functions/e2e-runner/catalogue/ by hand.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script, imported for its exported checker.
import { checkSource, CANONICAL_DIR, MIRROR_DIR } from "./sync-catalogue.mjs";

const tsFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")).sort() : []);

describe("e2e catalogue mirror", () => {
  const canonical = tsFiles(CANONICAL_DIR);
  const mirror = tsFiles(MIRROR_DIR);

  it("has canonical files", () => expect(canonical.length).toBeGreaterThan(5));

  it("mirrors exactly the canonical file names — nothing missing, nothing stale", () => expect(mirror).toEqual(canonical));

  it.each(canonical)("%s is byte-identical to its canonical copy", (name) => {
    const target = path.join(MIRROR_DIR, name);
    expect(existsSync(target), `${name} missing from the mirror — run node tests/e2e/sync-catalogue.mjs`).toBe(true);
    expect(readFileSync(target, "utf8"), `${name} differs — run node tests/e2e/sync-catalogue.mjs`).toBe(readFileSync(path.join(CANONICAL_DIR, name), "utf8"));
  });

  it.each(canonical)("%s obeys the mirror rules (header, sibling imports, no runtime globals)", (name) => {
    expect(checkSource(name, readFileSync(path.join(CANONICAL_DIR, name), "utf8"))).toEqual([]);
  });

  it("the checker catches each rule it enforces", () => {
    const head = "/**\n * Canonical copy: tests/e2e/scenarios/.\n */\n";
    expect(checkSource("a.ts", `/** nothing */\nexport const x = 1;`)).toEqual([expect.stringContaining("missing the canonical-copy header")]);
    expect(checkSource("b.ts", `${head}import { x } from "@/lib/x";`)).toEqual([expect.stringContaining('import "@/lib/x"')]);
    expect(checkSource("c.ts", `${head}import { x } from "../x.ts";`)).toEqual([expect.stringContaining('import "../x.ts"')]);
    expect(checkSource("d.ts", `${head}const k = Deno.env.get("X");`)).toEqual([expect.stringContaining("Deno.*")]);
    expect(checkSource("e.ts", `${head}const m = await import("./x.ts");`)).toEqual([expect.stringContaining("dynamic import")]);
    expect(checkSource("f.ts", `${head}import type { x } from "./x.ts";`)).toEqual([]);
  });
});
