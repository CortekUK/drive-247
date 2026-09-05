import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ContactForm } from "@/components/forms/contact-form";
import { DEFAULT_CONTACT_INFO, DEFAULT_TRUST_BADGES } from "@/lib/cms/defaults";
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
export async function ContactDetailsSection() {
  const [info, trust] = await Promise.all([
    loadSection("contact", "contact_info", DEFAULT_CONTACT_INFO),
    loadSection("contact", "trust_badges", DEFAULT_TRUST_BADGES),
  ]);

  const email = info.email.address.trim();
  const phone = info.phone.number.trim();
  const office = info.office.address.trim();
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
      href: `tel:${phone.replace(/[^+\d]/g, "")}`,
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
