import { Mail, MapPin, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ContactForm } from "@/components/forms/contact-form";
import { CONTACT_INFO } from "@/lib/constants";

type DetailRow = {
  id: string;
  Icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
};

const ROWS: DetailRow[] = [
  {
    id: "email",
    Icon: Mail,
    label: "Email:",
    value: CONTACT_INFO.email,
    href: `mailto:${CONTACT_INFO.email}`,
  },
  {
    id: "phone",
    Icon: Phone,
    label: "Phone Number",
    value: CONTACT_INFO.phone,
    href: `tel:${CONTACT_INFO.phone.replace(/[^+\d]/g, "")}`,
  },
  {
    id: "location",
    Icon: MapPin,
    label: "Location",
    value: "34 Madison Street, NY, USA 10005",
  },
];

export function ContactDetailsSection() {
  return (
    <section className="bg-brand-cream">
      <div className="container-page pb-12 pt-8 lg:pb-16 lg:pt-12">
        {/* Constrain content to the left half on desktop so the overlapping form has clear space on the right. */}
        <div className="lg:max-w-[calc(100%-420px-4rem)]">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Contact Details
          </h2>

          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1">
            {ROWS.map(({ id, Icon, label, value, href }) => (
              <li key={id} className="flex items-start gap-4">
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-amber text-brand-text">
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-brand-text">
                    {label}
                  </p>
                  {href ? (
                    <a
                      href={href}
                      className="text-sm text-brand-text-soft transition-colors hover:text-brand-text"
                    >
                      {value}
                    </a>
                  ) : (
                    <p className="text-sm text-brand-text-soft">{value}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Mobile-only form (desktop renders the form inside the hero) */}
        <div className="mt-10 lg:hidden">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
