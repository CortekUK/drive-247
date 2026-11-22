/**
 * QA B1.7 (2026-11-10): the booking site's footer, Contact page and map show
 * the company's own contact details (Settings > General > Company details)
 * wherever Site settings > Contact leaves a blank, and Site settings still
 * wins where it is filled.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_CONTACT } from "../../northwind-site/lib/cms/defaults";
import { withCompanyContact } from "../../northwind-site/lib/cms/site-contact";

const company = {
  contact_email: "hello@northwind-rentals.test",
  contact_phone: "+1 415 555 0142",
  phone: "+1 415 555 0100",
  address: "12 Harbour Street, Portland, OR 97201",
};

describe("withCompanyContact", () => {
  it("fills a blank Site settings contact from the company's details", () => {
    const out = withCompanyContact(DEFAULT_SITE_CONTACT, company);
    expect(out.email).toBe("hello@northwind-rentals.test");
    expect(out.phone).toBe("+1 415 555 0142");
    expect(out.phone_display).toBe("+1 415 555 0142");
    expect(out.address_line1).toBe("12 Harbour Street, Portland, OR 97201");
    expect(out.country).toBe("");
  });

  it("keeps whatever Site settings filled, field by field", () => {
    const site = {
      ...DEFAULT_SITE_CONTACT,
      email: "site@northwindrentals.com",
      phone_display: "(555) 000-1234",
      address_line1: "1200 Market Street",
      city: "Springfield",
      country: "USA",
    };
    const out = withCompanyContact(site, company);
    expect(out.email).toBe("site@northwindrentals.com");
    expect(out.phone_display).toBe("(555) 000-1234");
    expect(out.phone).toBe("");
    expect(out.address_line1).toBe("1200 Market Street");
    expect(out.city).toBe("Springfield");
  });

  it("takes contact_phone before phone, and a country alone is not an address", () => {
    expect(withCompanyContact(DEFAULT_SITE_CONTACT, { ...company, contact_phone: null }).phone).toBe("+1 415 555 0100");
    expect(withCompanyContact(DEFAULT_SITE_CONTACT, { ...company, contact_phone: "  ", phone: null }).phone).toBe("");
    const out = withCompanyContact({ ...DEFAULT_SITE_CONTACT, country: "USA" }, company);
    expect(out.address_line1).toBe("12 Harbour Street, Portland, OR 97201");
    expect(out.country).toBe("USA");
  });

  it("changes nothing without a tenant row, and never mutates its input", () => {
    const site = { ...DEFAULT_SITE_CONTACT, email: "x@y.co" };
    expect(withCompanyContact(site, null)).toBe(site);
    const out = withCompanyContact(DEFAULT_SITE_CONTACT, company);
    expect(out).not.toBe(DEFAULT_SITE_CONTACT);
    expect(DEFAULT_SITE_CONTACT.email).toBe("");
  });
});
