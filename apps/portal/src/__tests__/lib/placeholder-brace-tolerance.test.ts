import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Moore Luxe's signed agreement R-798b28 shows the renter stray braces:
 *
 *   "entered into between Moore Luxe LLC and {Ivita} ("Renter")"
 *   "Date: {September 9, 2026"
 *
 * Their stored template writes `{{{customer_name}}}` and `{{{rental_start_date}}`.
 * Triple braces are Mustache/Handlebars syntax for "insert unescaped", so
 * operators type them from habit — and the second one is not even balanced
 * (three open, two close), which is exactly as easy to type.
 *
 * The substituters matched EXACTLY two braces, replaced the inner pair, and left
 * the outer ones stranded in a signed contract. All four now accept two or three
 * on each side, counted independently.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

/** The shipped pattern, mirrored here so the tests exercise the real shape. */
const sub = (tpl: string, key: string, value: string) =>
  tpl.replace(new RegExp(`\\{{2,3}\\s*${key}\\s*\\}{2,3}`, "gi"), value);

describe("placeholder brace tolerance", () => {
  it("resolves Moore Luxe's two real template forms with no braces left", () => {
    expect(sub("and {{{customer_name}}} (\"Renter\")", "customer_name", "Ivita")).toBe(
      'and Ivita ("Renter")'
    );
    // Unbalanced: three open, two close.
    expect(sub("Date: {{{rental_start_date}}", "rental_start_date", "September 9, 2026")).toBe(
      "Date: September 9, 2026"
    );
  });

  it("still handles the ordinary and whitespaced forms", () => {
    expect(sub("{{customer_name}}", "customer_name", "Ivita")).toBe("Ivita");
    expect(sub("{{ customer_name }}", "customer_name", "Ivita")).toBe("Ivita");
    expect(sub("{{customer_name}}}", "customer_name", "Ivita")).toBe("Ivita");
  });

  it("is case-insensitive and replaces every occurrence", () => {
    expect(sub("{{Customer_Name}} and {{{customer_name}}}", "customer_name", "Ivita")).toBe(
      "Ivita and Ivita"
    );
  });

  it("leaves BoldSign text tags alone", () => {
    // These must survive substitution untouched or the signature, initials and
    // date fields are never placed and the document cannot be signed.
    for (const tag of ["{{@sig1}}", "{{@init1}}", "{{@date1}}"]) {
      expect(sub(tag, "customer_name", "X")).toBe(tag);
      expect(sub(tag, "rental_start_date", "X")).toBe(tag);
    }
  });

  it("does not match a different variable that shares a prefix", () => {
    // `customer_name` must not consume `{{customer_name_extra}}`.
    expect(sub("{{customer_name_extra}}", "customer_name", "Ivita")).toBe(
      "{{customer_name_extra}}"
    );
  });

  it("leaves an unknown placeholder untouched", () => {
    expect(sub("{{{unknown_thing}}}", "customer_name", "Ivita")).toBe("{{{unknown_thing}}}");
  });
});

describe("all four substituters agree", () => {
  // The preview and the three send engines each own a copy. If the preview were
  // stricter than the send path, an operator would see stray braces in the editor
  // and be unable to tell whether the real contract carried them.
  const SITES: Record<string, string> = {
    "portal engine": read("apps/portal/src/app/api/esign/route.ts"),
    "booking engine": read("apps/booking/src/app/api/esign/route.ts"),
    "edge function": read("supabase/functions/create-boldsign-document/index.ts"),
    "editor preview": read("apps/portal/src/lib/template-variables.ts"),
  };

  it.each(Object.keys(SITES))("%s tolerates 2-3 braces", (site) => {
    // Substring, not a regex-of-a-regex: the shipped source contains the
    // literal quantifier on each side. Asserting it by pattern was fragile
    // enough to fail on correct code, which is worse than not testing it.
    expect(SITES[site]).toContain("\\{{2,3}");
    expect(SITES[site]).toContain("\\}{2,3}");
  });

  it("no site still uses the exact-two-brace variable pattern", () => {
    for (const [site, src] of Object.entries(SITES)) {
      // The old shape, which stranded the outer braces in signed contracts.
      expect(src, `${site} still matches exactly two braces`).not.toContain(
        "\\{\\{\\s*${key}\\s*\\}\\}"
      );
    }
  });
});
