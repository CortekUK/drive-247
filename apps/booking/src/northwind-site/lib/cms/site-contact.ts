import type { SiteContactContent } from "./types";

/**
 * The tenant columns that carry the company's own contact details, entered in
 * the portal under Settings > General > Company details.
 */
export interface CompanyContactRow {
  contact_email: string | null;
  contact_phone: string | null;
  phone: string | null;
  address: string | null;
}

/**
 * Site settings > Contact, with the company's own details filling whatever it
 * leaves blank. Pure, so it is tested without a request; `loadSiteContact` in
 * server.ts is the loader that feeds it.
 *
 * The portal's Company details section says its email, phone and address are
 * shown on the booking site. Site settings' Contact section still wins when it
 * is filled (it can carry a site-only display number or a structured address),
 * but an empty field there no longer means an empty row on the site: the
 * footer, the Contact page and the map fall back to the company's details
 * instead of showing nothing (QA B1.7, 2026-11-10).
 */
export function withCompanyContact(
  site: SiteContactContent,
  tenant: CompanyContactRow | null | undefined,
): SiteContactContent {
  if (!tenant) return site;
  const out = { ...site };
  const email = (tenant.contact_email ?? "").trim();
  if (out.email.trim() === "" && email !== "") out.email = email;
  // Agreements and emails take contact_phone, else phone; the site agrees.
  const phone = (tenant.contact_phone ?? tenant.phone ?? "").trim();
  if (out.phone.trim() === "" && out.phone_display.trim() === "" && phone !== "") {
    out.phone = phone;
    out.phone_display = phone;
  }
  // The company's address is one line; it stands in for the street line only
  // when Site settings has no address at all (country alone is not one).
  const hasAddress = [out.address_line1, out.address_line2, out.city, out.state, out.zip].some(
    (part) => part.trim() !== "",
  );
  const address = (tenant.address ?? "").trim();
  if (!hasAddress && address !== "") out.address_line1 = address;
  return out;
}
