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

describe("buildTemplateData — PAYG period rates", () => {
  const baseArgs = () => ({
    rental: { is_pay_as_you_go: true, monthly_amount: 150, rental_period_type: "Weekly" } as Record<string, any>,
    customer: {} as Record<string, any>,
    vehicle: {} as Record<string, any>,
    tenant: {} as Record<string, any>,
  });

  it("computes daily/weekly/monthly framings from a Weekly rate", () => {
    const a = baseArgs();
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_period_label).toBe("Weekly");
    expect(data.payg_billing_amount).toBe("$150.00");
    // Weekly $150 → daily $150/7 = 21.42857… → formatted "$21.43"
    expect(data.payg_daily_rate).toBe("$21.43");
    // Weekly = (150/7) × 7 = 150 exact → "$150.00"
    expect(data.payg_weekly_rate).toBe("$150.00");
    // Monthly = (150/7) × 30 = 642.857… → "$642.86"
    expect(data.payg_monthly_rate).toBe("$642.86");
  });

  it("computes framings from a Monthly rate", () => {
    const a = baseArgs();
    a.rental.rental_period_type = "Monthly";
    a.rental.monthly_amount = 600;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_period_label).toBe("Monthly");
    expect(data.payg_billing_amount).toBe("$600.00");
    // Monthly $600 → daily $20 → weekly $140 → monthly back to $600
    expect(data.payg_daily_rate).toBe("$20.00");
    expect(data.payg_weekly_rate).toBe("$140.00");
    expect(data.payg_monthly_rate).toBe("$600.00");
  });

  it("returns empty strings on non-PAYG rentals so the template line collapses", () => {
    const a = baseArgs();
    a.rental.is_pay_as_you_go = false;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_period_label).toBe("");
    expect(data.payg_billing_amount).toBe("");
    expect(data.payg_daily_rate).toBe("");
    expect(data.payg_weekly_rate).toBe("");
    expect(data.payg_monthly_rate).toBe("");
    expect(data.payg_reminder_interval).toBe("");
  });

  it("formats reminder cadence from per-rental override", () => {
    const a = baseArgs();
    a.rental.payg_reminder_interval_days = 5;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_reminder_interval).toBe("every 5 days");
  });

  it("formats reminder cadence with singular form when interval is 1", () => {
    const a = baseArgs();
    a.rental.payg_reminder_interval_days = 1;
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_reminder_interval).toBe("every 1 day");
  });

  it("falls back to default cadence (4 days) when no per-rental override", () => {
    const a = baseArgs();
    const data = buildTemplateData(a.rental, a.customer, a.vehicle, a.tenant);
    expect(data.payg_reminder_interval).toBe("every 4 days");
  });
});

describe("replaceVariables — {{#if is_payg}} conditional", () => {
  const tmpl = `before
{{#if is_payg}}PAYG section: charged {{payg_billing_amount}} per {{payg_period_label}}{{/if}}
after`;

  it("renders the PAYG block when payg_period_label is set", () => {
    const out = replaceVariables(tmpl, {
      payg_period_label: "Weekly",
      payg_billing_amount: "$150.00",
    });
    expect(out).toContain("PAYG section: charged $150.00 per Weekly");
  });

  it("strips the PAYG block on non-PAYG rentals (empty payg_period_label)", () => {
    const out = replaceVariables(tmpl, {
      payg_period_label: "",
      payg_billing_amount: "",
    });
    expect(out).not.toContain("PAYG section");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips the PAYG block when payg_period_label is missing entirely", () => {
    const out = replaceVariables(tmpl, {});
    expect(out).not.toContain("PAYG section");
  });

  it("handles co-existing gig-driver and PAYG conditionals", () => {
    const multi = `{{#if is_payg}}P{{/if}}{{#if is_gig_driver}}G{{/if}}`;
    expect(replaceVariables(multi, { payg_period_label: "Weekly", is_gig_driver: "Yes" })).toBe("PG");
    expect(replaceVariables(multi, { payg_period_label: "Weekly", is_gig_driver: "No" })).toBe("P");
    expect(replaceVariables(multi, { payg_period_label: "", is_gig_driver: "Yes" })).toBe("G");
    expect(replaceVariables(multi, { payg_period_label: "", is_gig_driver: "No" })).toBe("");
  });
});
