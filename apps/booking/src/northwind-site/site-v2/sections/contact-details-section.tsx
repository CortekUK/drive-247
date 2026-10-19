import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react-nw';
import type { LucideIcon } from 'lucide-react-nw';

import { DEFAULT_CONTACT_INFO, DEFAULT_SITE_CONTACT, DEFAULT_TRUST_BADGES } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { resolveIcon } from '@nw/lib/cms/icons';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { ContactForm } from '@nw/site-v2/forms/contact-form';
import { CARD, CardHeading, ICON_TILE, SITE_CONTAINER } from '@nw/site-v2/kit';

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
 * Northwind booking site v2 — the contact details card beside the form.
 *
 * Same sources and precedence as the current section
 * (`components/sections/contact-details-section.tsx`, which documents why):
 * Site Settings wins for the business details, `contact / contact_info` is the
 * fallback and holds the notes, WhatsApp is page-only, and every row is absent
 * until the operator fills it in. Trust badges appear only once configured.
 */
function joinAddress(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part !== '').join(', ');
}

export async function ContactDetailsSection() {
  const [info, site, trust] = await Promise.all([
    loadSection('contact', 'contact_info', DEFAULT_CONTACT_INFO),
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('contact', 'trust_badges', DEFAULT_TRUST_BADGES),
  ]);

  const email = site.email.trim() || info.email.address.trim();
  const phone = site.phone_display.trim() || site.phone.trim() || info.phone.number.trim();
  const dialable = site.phone.trim() || phone;
  const office =
    joinAddress([site.address_line1, site.address_line2, site.city, site.state, site.zip, site.country]) ||
    info.office.address.trim();
  const whatsapp = info.whatsapp.number.trim();

  const rows: DetailRow[] = [];

  if (email !== '') {
    rows.push({
      id: 'email',
      Icon: Mail,
      label: 'Email',
      value: email,
      note: info.email.response_time.trim(),
      href: `mailto:${email}`,
      path: 'contact.contact_info.email.address',
      notePath: 'contact.contact_info.email.response_time',
    });
  }

  if (phone !== '') {
    rows.push({
      id: 'phone',
      Icon: Phone,
      label: 'Phone',
      value: phone,
      note: info.phone.availability.trim(),
      href: `tel:${dialable.replace(/[^+\d]/g, '')}`,
      path: 'contact.contact_info.phone.number',
      notePath: 'contact.contact_info.phone.availability',
    });
  }

  if (whatsapp !== '') {
    rows.push({
      id: 'whatsapp',
      Icon: MessageCircle,
      label: 'WhatsApp',
      value: whatsapp,
      note: info.whatsapp.description.trim(),
      href: `https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`,
      path: 'contact.contact_info.whatsapp.number',
      notePath: 'contact.contact_info.whatsapp.description',
    });
  }

  if (office !== '') {
    rows.push({
      id: 'location',
      Icon: MapPin,
      label: 'Location',
      value: office,
      note: '',
      path: 'contact.contact_info.office.address',
      notePath: '',
    });
  }

  const badges = trust.badges
    .map((badge, index) => ({ badge, index }))
    .filter(({ badge }) => badge.label.trim() !== '');

  return (
    <section
      {...cmsSection('contact.contact_info', 'Contact details')}
      className={cn(SITE_CONTAINER, 'grid grid-cols-1 gap-4 pt-8 md:pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-6')}
    >
      <div className={cn(CARD, 'flex flex-col gap-5 p-5 sm:p-6')}>
        <CardHeading title="Contact details" description="Reach us whichever way suits you." />

        {rows.length > 0 ? (
          <ul className="flex flex-col divide-y divide-pv-border">
            {rows.map(({ id, Icon, label, value, note, href, path, notePath }) => (
              <li key={id} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                <span className={ICON_TILE}>
                  <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-xs font-medium text-pv-muted-fg">{label}</p>
                  {href ? (
                    <a
                      href={href}
                      className="break-words text-sm font-medium text-pv-fg transition-colors duration-200 hover:text-pv-primary motion-reduce:transition-none"
                    >
                      <Editable path={path}>{value}</Editable>
                    </a>
                  ) : (
                    <p className="break-words text-sm font-medium text-pv-fg">
                      <Editable path={path}>{value}</Editable>
                    </p>
                  )}
                  {note !== '' ? (
                    <p className="text-xs text-pv-muted-fg">
                      <Editable path={notePath}>{note}</Editable>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-pv-muted-fg">Use the form and we will reply as soon as we can.</p>
        )}

        {badges.length > 0 ? (
          <ul className="flex flex-wrap gap-2 border-t border-pv-border pt-5">
            {badges.map(({ badge, index }) => {
              const Icon = resolveIcon(badge.icon);
              return (
                <li
                  key={`${badge.label}-${index}`}
                  title={badge.tooltip || undefined}
                  className="inline-flex items-center gap-1.5 rounded-full bg-pv-muted px-3 py-1.5 text-xs font-medium text-pv-fg"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-pv-primary" strokeWidth={1.75} />
                  <Editable path={`contact.trust_badges.badges.${index}.label`}>{badge.label}</Editable>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div id="contact-form" className="scroll-mt-24">
        <ContactForm />
      </div>
    </section>
  );
}
