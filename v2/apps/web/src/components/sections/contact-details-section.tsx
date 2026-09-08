import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ContactForm } from "@/components/forms/contact-form";
import {
  DEFAULT_CONTACT_INFO,
  DEFAULT_SITE_CONTACT,
  DEFAULT_TRUST_BADGES,
} from "@/lib/cms/defaults";
import { resolveIcon } from "@/lib/cms/icons";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

type DetailRow = {
  id: string;
  Icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  href?: string;
  /** CMS paths for the visual editor — the value and its note. */
  path: string;
  notePath: string;
};

/**
 * Contact details — the portal's `contact / contact_info`, plus its
 * `contact / trust_badges` underneath.
 *
 * Every row is conditional on the operator having filled it in. The prototype
 * hardcoded an email, a phone number and a New York street address that
 * belonged to nobody; here a blank field means the row is simply absent, and
 * WhatsApp appears only for operators who use it. The `availability` and
 * `response_time` fields hang off their row as a subtle note rather than
 * needing a slot of their own.
 *
 * Trust badges are absent from the Figma design, so they default to empty and
 * appear only once configured.
 */
/** "12 Peak Street", "Denver", "CO", "80202" -> one line. */
function joinAddress(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part !== "").join(", ");
}

export async function ContactDetailsSection() {
  const [info, site, trust] = await Promise.all([
    loadSection("contact", "contact_info", DEFAULT_CONTACT_INFO),
    /**
     * The BUSINESS DETAILS, from the one place a tenant enters them.
     *
     * This section read `contact / contact_info` alone, so it showed nothing at
     * all for an operator who had filled in Site Settings — which is exactly
     * what the portal tells them to do: the Contact page in the CMS says in so
     * many words, "Your phone, email and address come from Site settings. These
     * are the notes shown beside them." The page did not honour its own
     * instruction, and the result was a Contact page with a heading and no way
     * to make contact.
     *
     * Site Settings wins; the page's own fields remain as a fallback so a
     * tenant who filled them in before Site Settings existed keeps their
     * details. The NOTES beside each row (phone hours, reply time) stay
     * page-level throughout — they are copy about this page, not business
     * facts.
     */
    loadSection("site-settings", "contact", DEFAULT_SITE_CONTACT),
    loadSection("contact", "trust_badges", DEFAULT_TRUST_BADGES),
  ]);

  const email = site.email.trim() || info.email.address.trim();
  /* `phone_display` is the formatted one a human reads; `phone` is dialable. */
  const phone = site.phone_display.trim() || site.phone.trim() || info.phone.number.trim();
  const dialable = site.phone.trim() || phone;
  const office =
    joinAddress([
      site.address_line1,
      site.address_line2,
      site.city,
      site.state,
      site.zip,
      site.country,
    ]) || info.office.address.trim();
  /* WhatsApp stays page-only: Site Settings has no field for it, and the CMS
     hint here says to fill it in "only if it differs from your main phone
     number" — so a blank means "same as the phone", not "missing". */
  const whatsapp = info.whatsapp.number.trim();

  const rows: DetailRow[] = [];

  if (email !== "") {
    rows.push({
      id: "email",
      Icon: Mail,
      label: "Email:",
      value: email,
      note: info.email.response_time.trim(),
      href: `mailto:${email}`,
      path: "contact.contact_info.email.address",
      notePath: "contact.contact_info.email.response_time",
    });
  }

  if (phone !== "") {
    rows.push({
      id: "phone",
      Icon: Phone,
      label: "Phone Number",
      value: phone,
      note: info.phone.availability.trim(),
      href: `tel:${dialable.replace(/[^+\d]/g, "")}`,
      path: "contact.contact_info.phone.number",
      notePath: "contact.contact_info.phone.availability",
    });
  }

  if (whatsapp !== "") {
    rows.push({
      id: "whatsapp",
      Icon: MessageCircle,
      label: "WhatsApp",
      value: whatsapp,
      note: info.whatsapp.description.trim(),
      href: `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`,
      path: "contact.contact_info.whatsapp.number",
      notePath: "contact.contact_info.whatsapp.description",
    });
  }

  if (office !== "") {
    rows.push({
      id: "location",
      Icon: MapPin,
      label: "Location",
      value: office,
      note: "",
      path: "contact.contact_info.office.address",
      notePath: "",
    });
  }

  const badges = trust.badges
    .map((badge, index) => ({ badge, index }))
    .filter(({ badge }) => badge.label.trim() !== "");

  return (
    <section {...cmsSection("contact.contact_info", "Contact details")} className="bg-brand-cream">
      <div className="container-page pb-12 pt-8 lg:pb-16 lg:pt-12">
        {/* Constrain content to the left half on desktop so the overlapping form has clear space on the right. */}
        <div className="lg:max-w-[calc(100%-420px-4rem)]">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Contact Details
          </h2>

          {rows.length > 0 && (
            <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1">
              {rows.map(({ id, Icon, label, value, note, href, path, notePath }) => (
                <li key={id} className="flex items-start gap-4">
                  <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-amber text-brand-text">
                    <Icon className="size-5" strokeWidth={2} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-semibold text-brand-text">
                      {label}
                    </p>
                    {href ? (
                      <a
                        href={href}
                        className="break-words text-sm text-brand-text-soft transition-colors hover:text-brand-text"
                      >
                        <Editable path={path}>{value}</Editable>
                      </a>
                    ) : (
                      <p className="break-words text-sm text-brand-text-soft">
                        <Editable path={path}>{value}</Editable>
                      </p>
                    )}
                    {note !== "" && (
                      <p className="text-xs text-brand-text-subtle">
                        <Editable path={notePath}>{note}</Editable>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {badges.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-2">
              {badges.map(({ badge, index }) => {
                const Icon = resolveIcon(badge.icon);
                return (
                  <li
                    key={`${badge.label}-${index}`}
                    title={badge.tooltip || undefined}
                    className="inline-flex items-center gap-2 rounded-full border border-brand-border-soft bg-white px-3 py-2 text-[12px] font-medium text-brand-text"
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={2} />
                    <Editable path={`contact.trust_badges.badges.${index}.label`}>{badge.label}</Editable>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Mobile-only form (desktop renders the form inside the hero) */}
        <div className="mt-10 lg:hidden">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
