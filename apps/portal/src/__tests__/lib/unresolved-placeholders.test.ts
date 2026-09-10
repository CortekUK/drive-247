import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  findUnresolvedPlaceholders,
  stripUnresolvedPlaceholders,
} from "@/lib/unresolved-placeholders";

/**
 * A sweep of all 62 active tenant templates found five referencing variables no
 * engine supplies. They print verbatim into signed contracts. The fixtures below
 * are the real markup, taken from production.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

// Verbatim from clutch-motors and globalmotiontransport active templates.
const CLUTCH_SIGNATURE =
  "Printed Name: {{customer_name}} Renter Signature: {{customer_signature}} Date: {{customer_signature_date}}";
const CLUTCH_INITIALS =
  "Business Purpose &amp; Graves Amendment Waiver (Section 1): {{initials_section_1}}";
const GMT_ODOMETER =
  "Monthly Rate: {{vehicle_monthly_rent}} Starting Odometer: {{starting_odometer}}";
const GMT_INSURANCE =
  "Renter's insurance policy number: {{customer_insurance_policy}} Renter's insurance company name: {{customer_insurance_company}}";

describe("findUnresolvedPlaceholders", () => {
  it("finds what Clutch Motors prints where a signature should be", () => {
    // Already-substituted names are gone by this point; only leftovers remain.
    const afterSubstitution = CLUTCH_SIGNATURE.replace("{{customer_name}}", "Jane Doe");
    expect(findUnresolvedPlaceholders(afterSubstitution)).toEqual([
      "customer_signature",
      "customer_signature_date",
    ]);
  });

  it("finds GMT's insurance and odometer placeholders", () => {
    expect(findUnresolvedPlaceholders(GMT_INSURANCE)).toEqual([
      "customer_insurance_company",
      "customer_insurance_policy",
    ]);
  });

  it("reports each name once, however many times it appears", () => {
    expect(findUnresolvedPlaceholders("{{a}} {{a}} {{a}}")).toEqual(["a"]);
  });

  it("finds nothing in a fully resolved document", () => {
    expect(findUnresolvedPlaceholders("Renter Signature: Jane Doe")).toEqual([]);
    expect(findUnresolvedPlaceholders("")).toEqual([]);
  });
});

describe("stripUnresolvedPlaceholders", () => {
  it("leaves a blank rather than raw markup in the signature line", () => {
    const { html, removed } = stripUnresolvedPlaceholders(
      CLUTCH_SIGNATURE.replace("{{customer_name}}", "Jane Doe")
    );
    expect(html).toBe("Printed Name: Jane Doe Renter Signature:  Date: ");
    expect(removed).toEqual(["customer_signature", "customer_signature_date"]);
  });

  it("clears the initials placeholder from the acknowledgement clause", () => {
    const { html } = stripUnresolvedPlaceholders(CLUTCH_INITIALS);
    expect(html).not.toContain("{{");
    expect(html).toContain("Graves Amendment Waiver (Section 1):");
  });

  it("handles the triple-brace form too", () => {
    expect(stripUnresolvedPlaceholders("{{{unknown_thing}}}").html).toBe("");
  });

  it("returns the input untouched when everything resolved", () => {
    const clean = "Renter Signature: Jane Doe";
    const { html, removed } = stripUnresolvedPlaceholders(clean);
    expect(html).toBe(clean);
    expect(removed).toEqual([]);
  });

  it("NEVER removes a BoldSign text tag", () => {
    // Removing one produces a document with no signature field, which cannot be
    // signed at all — strictly worse than the problem being fixed.
    for (const tag of ["{{@sig1}}", "{{@init1}}", "{{@date1}}", "{{@sig2}}"]) {
      const { html, removed } = stripUnresolvedPlaceholders(`Sign here: ${tag}`);
      expect(html).toBe(`Sign here: ${tag}`);
      expect(removed).toEqual([]);
    }
  });

  it("NEVER removes a Handlebars conditional", () => {
    const tpl = "{{#if is_payg}}Pay as you go{{/if}}";
    expect(stripUnresolvedPlaceholders(tpl).html).toBe(tpl);
  });

  it("strips leftovers while leaving tags and conditionals intact together", () => {
    const mixed = "{{#if is_payg}}A{{/if}} {{gone}} {{@sig1}}";
    const { html, removed } = stripUnresolvedPlaceholders(mixed);
    expect(html).toBe("{{#if is_payg}}A{{/if}}  {{@sig1}}");
    expect(removed).toEqual(["gone"]);
  });
});

describe("all three engines strip unresolved placeholders", () => {
  const ENGINES: Record<string, string> = {
    portal: read("apps/portal/src/app/api/esign/route.ts"),
    booking: read("apps/booking/src/app/api/esign/route.ts"),
    edge: read("supabase/functions/create-boldsign-document/index.ts"),
  };

  it.each(Object.keys(ENGINES))("%s strips before returning", (engine) => {
    expect(ENGINES[engine]).toMatch(/stripUnresolvedPlaceholders|unresolved/);
  });

  it("each engine warns rather than removing silently", () => {
    // An operator whose template names a variable we do not supply needs to hear
    // about it. The blank is damage control, not a fix.
    for (const [engine, src] of Object.entries(ENGINES)) {
      expect(src, `${engine} does not warn`).toMatch(
        /no engine supplies|console\.warn[\s\S]{0,200}removed rather than printing/
      );
    }
  });

  it("portal supplies the odometer alias GMT's template asks for", () => {
    // `starting_odometer` is the collection reading, which the handover work
    // made available — so this one can be answered rather than blanked.
    expect(ENGINES.portal).toMatch(/starting_odometer:\s*_times\.collectionMileage/);
    expect(ENGINES.edge).toMatch(/starting_odometer:\s*_times\.collectionMileage/);
  });
});
