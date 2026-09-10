import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decodeHtmlEntities, ENTITIES_WE_EMIT } from "@/lib/html-entities";

/**
 * Moore Luxe's signed agreement R-798b28 printed our own markup to the renter,
 * in the security-deposit clause of the contract they signed:
 *
 *   "charged to the Renter&rsquo;s payment method"
 *   "not a temporary authorisation hold &mdash; the funds are taken"
 *   "received within 5&ndash;10 business days"
 *
 * We author that clause. The PDF path decoded seven entities and none of those
 * three, so every charged-deposit tenant's contract carried it.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

describe("decodeHtmlEntities", () => {
  it("decodes the three that reached Moore Luxe's signed contract", () => {
    expect(decodeHtmlEntities("Renter&rsquo;s payment method")).toBe(
      "Renter’s payment method"
    );
    expect(decodeHtmlEntities("hold &mdash; the funds")).toBe("hold — the funds");
    expect(decodeHtmlEntities("within 5&ndash;10 business days")).toBe(
      "within 5–10 business days"
    );
  });

  it("still decodes everything the old inline version did", () => {
    // No regression on the seven it already handled.
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
    expect(decodeHtmlEntities("a&middot;b")).toBe("a·b");
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
  });

  it("decodes numeric references, decimal and hex", () => {
    expect(decodeHtmlEntities("Renter&#8217;s")).toBe("Renter’s");
    expect(decodeHtmlEntities("Renter&#x2019;s")).toBe("Renter’s");
    expect(decodeHtmlEntities("&#163;100")).toBe("£100");
  });

  it("does NOT double-decode correctly-escaped text", () => {
    // The ordering trap: decoding &amp; first turns this into an apostrophe and
    // silently corrupts text an operator escaped on purpose.
    expect(decodeHtmlEntities("&amp;rsquo;")).toBe("&rsquo;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });

  it("leaves an unknown entity exactly as written rather than dropping it", () => {
    // An operator who typed "&foo;" in their own terms should get it back.
    expect(decodeHtmlEntities("a &foo; b")).toBe("a &foo; b");
    expect(decodeHtmlEntities("100 & 200")).toBe("100 & 200");
  });

  it("survives malformed and hostile input without throwing", () => {
    for (const bad of ["", "&", "&;", "&#;", "&#x;", "&#999999999;", "&#xD800;", "&#-1;"]) {
      expect(() => decodeHtmlEntities(bad)).not.toThrow();
    }
    // A lone surrogate is not a valid scalar value and must not be emitted.
    expect(decodeHtmlEntities("&#xD800;")).toBe("&#xD800;");
  });
});

describe("every engine decodes the entities our own clauses emit", () => {
  // The real guarantee. The bug was not a missing helper — it was three engines
  // each carrying their own hand-written entity list, none of which kept up with
  // the boilerplate we inject into contracts.
  const ENGINES: Record<string, string> = {
    portal: read("apps/portal/src/app/api/esign/route.ts") + read("apps/portal/src/lib/html-entities.ts"),
    booking: read("apps/booking/src/app/api/esign/route.ts"),
    edge: read("supabase/functions/create-boldsign-document/index.ts"),
  };

  it.each(Object.keys(ENGINES))("%s decodes all of them", (engine) => {
    const src = ENGINES[engine];
    // Look for the entity in a DECODING position, not anywhere in the file.
    // Checking the bare name matched the deposit clause's own literal text, so
    // two engines passed this while decoding nothing — the exact false negative
    // that let the bug reach a signed contract in the first place.
    const missing = ENTITIES_WE_EMIT.filter((e) => {
      const name = e.replace(/^&|;$/g, "");
      const decodesIt =
        new RegExp(`replace\\(\\s*/&${name};/`, "i").test(src) ||
        // The portal delegates to the shared decoder, which owns the table.
        (/decodeHtmlEntities/.test(src) && new RegExp(`\\b${name}:`).test(src));
      return !decodesIt;
    });
    expect(missing).toEqual([]);
  });

  it("the deposit clause we inject is identical in all three engines", () => {
    // It is duplicated by hand; a divergence means one set of tenants gets
    // different contract wording from another.
    const clause = /A refundable security deposit of[\s\S]*?depending on the Renter&rsquo;s bank\./;
    const found = Object.entries(ENGINES).map(([name, src]) => [name, src.match(clause)?.[0] ?? null]);
    for (const [name, text] of found) expect(text, `${name} is missing the clause`).toBeTruthy();
    const [first, ...rest] = found.map(([, t]) => t);
    for (const t of rest) expect(t).toBe(first);
  });
});
