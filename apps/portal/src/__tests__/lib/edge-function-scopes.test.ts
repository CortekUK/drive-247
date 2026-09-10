import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * supabase/functions is the ONLY part of this repo with no safety net:
 *   - there is no CI (.github/ does not exist)
 *   - there is no `deno check` or lint step in any build script
 *   - supabase/functions sits outside every tsconfig, so `tsc` never sees it
 *   - `supabase functions deploy` does not typecheck
 *
 * Proven the hard way. boldsign-webhook shipped a bare `payload` reference —
 * the handler's parameter is `event` — and threw ReferenceError on EVERY
 * BoldSign callback. A surrounding catch downgraded it to console.warn, so it
 * ran unnoticed and additional-driver signing status was never synced.
 *
 * The same sweep then found three more of the identical class, none of which
 * anything else in this repo could have caught.
 *
 * This test is that missing compiler. It lives in the portal vitest suite
 * because that is the only harness in this repo that actually runs.
 */
describe("edge functions: no undefined references", () => {
  it("every identifier read in supabase/functions is declared somewhere", () => {
    const root = resolve(__dirname, "../../../../..");
    let out = "";
    let failed = false;
    try {
      out = execFileSync(
        "node",
        [resolve(root, "scripts/check-edge-function-scopes.mjs"), "--json"],
        { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );
    } catch (e: any) {
      // The script exits 1 when it finds something; stdout still holds the JSON.
      out = e?.stdout ?? "";
      failed = true;
    }

    const findings = out.trim() ? JSON.parse(out) : [];

    if (findings.length) {
      const detail = findings
        .map((f: { file: string; line: number; name: string }) => `  ${f.file}:${f.line}  '${f.name}' is never declared`)
        .join("\n");
      throw new Error(
        `${findings.length} undefined reference(s) in supabase/functions — these throw ` +
          `ReferenceError at runtime and nothing else in this repo typechecks them:\n${detail}`,
      );
    }

    expect(findings).toEqual([]);
    expect(failed).toBe(false);
  });
});
