import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_VARIABLES,
  getVariable,
  exampleValues,
  fillVariables,
  extractVariables,
  unknownVariables,
} from "@/lib/notifications-v2/variables";
import { EMAIL_TEMPLATE_VARIABLES } from "@/lib/email-template-variables";

/**
 * Notifications v2 variables: the `{{key}}` list every template on the new
 * page draws from, the example values every preview shows, and the fill /
 * check helpers. Spec: docs/notifications-v2/build-spec.md (variables.ts).
 */

const GROUPS = ["customer", "rental", "vehicle", "money", "company", "links"];

describe("NOTIFICATION_VARIABLES", () => {
  it("has unique snake_case keys", () => {
    const keys = NOTIFICATION_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("gives every variable a label, a description, a known group and an example", () => {
    for (const v of NOTIFICATION_VARIABLES) {
      expect(v.label.trim(), v.key).not.toBe("");
      expect(v.description.trim(), v.key).not.toBe("");
      expect(GROUPS, v.key).toContain(v.group);
      expect(v.example.trim(), v.key).not.toBe("");
    }
  });

  it("keeps every key the existing customer email templates use, so saved templates still fill", () => {
    const ours = new Set(NOTIFICATION_VARIABLES.map((v) => v.key));
    for (const v of EMAIL_TEMPLATE_VARIABLES) expect(ours.has(v.key), v.key).toBe(true);
  });

  it("looks variables up by key", () => {
    expect(getVariable("customer_name")?.label).toBeTruthy();
    expect(getVariable("not_a_variable")).toBeUndefined();
  });
});

describe("exampleValues", () => {
  it("covers every variable with a non-empty value", () => {
    const values = exampleValues();
    for (const v of NOTIFICATION_VARIABLES) {
      expect(values[v.key], v.key).toBeTruthy();
    }
  });

  it("tells one consistent story: 7 days at $100 is $700.00 in USD by default", () => {
    const values = exampleValues();
    expect(values.rental_amount).toBe("$700.00");
    expect(values.extension_days).toBe("4");
    expect(values.extension_amount).toBe("$400.00");
    // The reference and the id in links belong to the same booking.
    expect(values.rental_id.replace(/-/g, "").slice(0, 6).toUpperCase()).toBe(values.rental_number.replace("R-", ""));
    expect(values.portal_url).toContain(values.rental_id);
  });

  it("formats amounts in the tenant's currency", () => {
    const gbp = exampleValues(null, { currencyCode: "GBP" });
    expect(gbp.rental_amount).toBe("£700.00");
    expect(gbp.toll_total).toBe("£42.50");
    const lower = exampleValues(null, { currencyCode: "eur" });
    expect(lower.rental_amount).toContain("€");
  });

  it("uses the tenant's own branding and slug when given", () => {
    const values = exampleValues(
      { companyName: "Northwind Rentals", contactEmail: "desk@northwind.test", contactPhone: "+44 20 7946 0000" },
      { slug: "northwind" },
    );
    expect(values.company_name).toBe("Northwind Rentals");
    expect(values.company_email).toBe("desk@northwind.test");
    expect(values.company_phone).toBe("+44 20 7946 0000");
    expect(values.customer_portal_url).toBe("https://northwind.drive-247.com/portal/bookings");
    expect(values.portal_url.startsWith("https://northwind.portal.drive-247.com/rentals/")).toBe(true);
  });

  it("falls back to the defaults for blank branding", () => {
    const values = exampleValues({ companyName: "  ", contactEmail: "" });
    expect(values.company_name).toBe(getVariable("company_name")?.example);
    expect(values.company_email).toBe(getVariable("company_email")?.example);
  });
});

describe("fillVariables", () => {
  const values = { customer_name: "Jordan Ellis", rental_amount: "$700.00", empty: "" };

  it("replaces every occurrence of a known variable", () => {
    expect(fillVariables("Hi {{customer_name}}, {{customer_name}} owes {{rental_amount}}.", values)).toBe(
      "Hi Jordan Ellis, Jordan Ellis owes $700.00.",
    );
  });

  it("leaves unknown or unsupplied variables visible, so the preview shows the mistake", () => {
    expect(fillVariables("Hi {{custmer_name}} and {{rental_number}}", values)).toBe(
      "Hi {{custmer_name}} and {{rental_number}}",
    );
  });

  it("replaces a variable supplied as empty with nothing", () => {
    expect(fillVariables("a{{empty}}b", values)).toBe("ab");
  });

  it("escapes values in HTML mode and only there", () => {
    const hostile = { customer_name: `<img src=x onerror="alert(1)"> & 'co'` };
    const html = fillVariables("<p>Hi {{customer_name}}</p>", hostile, { html: true });
    expect(html).toBe("<p>Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;co&#39;</p>");
    expect(html).not.toContain("<img");
    expect(fillVariables("Hi {{customer_name}}", hostile)).toBe(`Hi <img src=x onerror="alert(1)"> & 'co'`);
  });

  it("does not escape the template itself, only the values", () => {
    expect(fillVariables('<a href="{{rental_amount}}">x</a>', values, { html: true })).toBe('<a href="$700.00">x</a>');
  });

  it("matches the server's exact {{key}} form, not {{ key }}", () => {
    expect(fillVariables("Hi {{ customer_name }}", values)).toBe("Hi {{ customer_name }}");
  });

  it("returns an empty string for empty input", () => {
    expect(fillVariables("", values)).toBe("");
  });
});

describe("extractVariables and unknownVariables", () => {
  it("lists each variable once, in the order it first appears", () => {
    expect(extractVariables("{{b}} {{a}} {{b}} {{c_1}}")).toEqual(["b", "a", "c_1"]);
    expect(extractVariables("no variables")).toEqual([]);
    expect(extractVariables("")).toEqual([]);
  });

  it("reports only the variables that are not allowed, once each", () => {
    expect(unknownVariables("{{customer_name}} {{oops}} {{oops}} {{Customer_Name}}", ["customer_name"])).toEqual([
      "oops",
      "Customer_Name",
    ]);
    expect(unknownVariables("{{customer_name}}", ["customer_name"])).toEqual([]);
  });
});
