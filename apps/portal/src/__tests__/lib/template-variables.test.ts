import { describe, it, expect } from "vitest";
import { replaceVariables, buildTemplateData } from "@/lib/template-variables";

describe("replaceVariables — gig-worker conditional", () => {
  const tmpl = `before
{{#if is_gig_driver}}gig-only content with {{customer_name}}{{/if}}
after`;

  it("keeps the inner content and substitutes nested variables when is_gig_driver = 'Yes'", () => {
    const out = replaceVariables(tmpl, { is_gig_driver: "Yes", customer_name: "Jane" });
    expect(out).toContain("gig-only content with Jane");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips the inner content when is_gig_driver = 'No'", () => {
    const out = replaceVariables(tmpl, { is_gig_driver: "No", customer_name: "Jane" });
    expect(out).not.toContain("gig-only content");
    expect(out).not.toContain("Jane");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips the inner content when is_gig_driver is missing", () => {
    const out = replaceVariables(tmpl, { customer_name: "Jane" });
    expect(out).not.toContain("gig-only content");
  });

  it("handles multiple {{#if}} blocks on the same template", () => {
    const multi = `{{#if is_gig_driver}}A{{/if}} mid {{#if is_gig_driver}}B{{/if}}`;
    expect(replaceVariables(multi, { is_gig_driver: "Yes" })).toBe("A mid B");
    expect(replaceVariables(multi, { is_gig_driver: "No" })).toBe(" mid ");
  });

  it("leaves templates without conditional blocks alone", () => {
    const plain = "Hello {{customer_name}}";
    expect(replaceVariables(plain, { customer_name: "Jane" })).toBe("Hello Jane");
  });

  it("does not treat 'Yes' as a partial match (e.g., is_gig_driver = 'Yesterday' would be false)", () => {
    // Defensive: only the exact string "Yes" keeps the block. Anything else strips.
    const out = replaceVariables(tmpl, { is_gig_driver: "yes", customer_name: "Jane" });
    expect(out).not.toContain("gig-only content");
  });
});

describe("buildTemplateData — gig-worker resolution", () => {
  const baseArgs = () => ({
    rental: {} as Record<string, any>,
    customer: {} as Record<string, any>,
    vehicle: {} as Record<string, any>,
    tenant: {} as Record<string, any>,
  });

  it("prefers the rental's snapshot when set to true", () => {
    const a = baseArgs();
    a.rental.is_gig_driver = true;
    a.customer.is_gig_driver = false;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.is_gig_driver).toBe("Yes");
  });

  it("prefers the rental's snapshot when explicitly false (does not fall through to customer)", () => {
    const a = baseArgs();
    a.rental.is_gig_driver = false;
    a.customer.is_gig_driver = true;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    // Rental snapshot wins: this customer was NOT a gig driver at booking time
    // even if they've since toggled on the flag in the portal.
    expect(data.is_gig_driver).toBe("No");
  });

  it("falls back to the customer flag when the rental snapshot is undefined", () => {
    const a = baseArgs();
    a.customer.is_gig_driver = true;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.is_gig_driver).toBe("Yes");
  });

  it("resolves to 'No' when both are absent", () => {
    const a = baseArgs();
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.is_gig_driver).toBe("No");
  });
});
