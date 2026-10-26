import { ArrowRight, Mail, MapPin, MessageCircle, Phone } from 'lucide-react-nw';
import type { LucideIcon } from 'lucide-react-nw';

import { DEFAULT_CONTACT_INFO, DEFAULT_SITE_CONTACT, DEFAULT_TRUST_BADGES } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { resolveIcon } from '@nw/lib/cms/icons';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { SITE_WIDE } from '@nw/site-v2/kit';

type DetailRow = {
  id: string;
  Icon: LucideIcon;
  label: string;
  /** What tapping the card does, e.g. "Call us". */
  action: string;
  value: string;
  note: string;
  href?: string;
  /** CMS paths for the visual editor — the value and its note. */
  path: string;
  notePath: string;
};

/**
 * Northwind booking site v2 — the ways to reach the operator, as big tinted
 * cards a renter can tap, each with its icon sitting on the card's top edge,
 * starting just under the hero's wave so the whole curve shows. Every card ends in the
 * same row — what tapping does, and an arrow — so they line up: call, message on WhatsApp, email, and where they are. Each
 * says what tapping it does. The form and the map come after
 * (`contact-map-section.tsx`).
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
      action: 'Send an email',
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
      action: 'Call us',
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
      action: 'Message us',
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
      label: 'Visit us',
      action: 'Get directions',
      value: office,
      note: '',
      href: site.google_maps_url.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(office)}`,
      path: 'contact.contact_info.office.address',
      notePath: '',
    });
  }

  const badges = trust.badges
    .map((badge, index) => ({ badge, index }))
    .filter(({ badge }) => badge.label.trim() !== '');

  return (
    <section {...cmsSection('contact.contact_info', 'Contact details')} aria-label="Ways to reach us" className={cn(SITE_WIDE, 'pt-7 md:pt-9')}>
      {rows.length > 0 ? (
        <ul
          data-reveal-group
          className={cn(
            'grid gap-x-4 gap-y-10 sm:grid-cols-2 lg:gap-x-5',
            rows.length >= 4 ? 'xl:grid-cols-4' : rows.length === 3 ? 'lg:grid-cols-3' : '',
          )}
        >
          {rows.map(({ id, Icon, label, action, value, note, href, path, notePath }) => {
            // Calling is the quickest way to an answer, so the phone card is
            // the one in the brand colour; the rest are white.
            const lead = id === 'phone';
            const body = (
              <>
                <span
                  className={cn(
                    'absolute -top-5 left-5 grid size-11 place-items-center rounded-xl',
                    lead
                      ? 'bg-pv-card text-pv-primary'
                      : 'bg-pv-primary text-pv-primary-fg',
                  )}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={2} />
                </span>

                <span
                  className={cn(
                    'mt-3 block text-[12px] font-semibold uppercase tracking-[0.08em]',
                    lead ? 'text-pv-primary-fg/75' : 'text-pv-muted-fg',
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    'mt-1.5 block text-[17px] font-extrabold leading-snug tracking-[-0.025em] [overflow-wrap:anywhere]',
                    !lead && 'text-pv-fg',
                  )}
                >
                  {/* An address may break after its "@", never in the middle of a word. */}
                  <Editable path={path}>
                    {id === 'email' && value.includes('@') ? (
                      <>
                        {value.slice(0, value.indexOf('@'))}
                        <wbr />
                        {value.slice(value.indexOf('@'))}
                      </>
                    ) : (
                      value
                    )}
                  </Editable>
                </span>
                {note !== '' ? (
                  <span
                    className={cn(
                      'mt-1 block text-[13.5px] leading-relaxed',
                      lead ? 'text-pv-primary-fg/75' : 'text-pv-muted-fg',
                    )}
                  >
                    <Editable path={notePath}>{note}</Editable>
                  </span>
                ) : null}

                {/* At least 20px, and whatever else the card's height leaves. */}
                <span aria-hidden className="block min-h-4 flex-1" />
                {href ? (
                  <span
                    className={cn(
                      'flex items-center justify-between gap-3 border-t pt-3 text-[14px] font-semibold',
                      lead ? 'border-pv-primary-fg/20' : 'border-pv-border text-pv-fg',
                    )}
                  >
                    {action}
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none',
                        lead ? 'bg-pv-card text-pv-primary' : 'bg-pv-tint text-pv-primary dark:text-pv-fg',
                      )}
                    >
                      <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
                    </span>
                  </span>
                ) : null}
              </>
            );
            const box = cn(
              'relative flex w-full flex-col rounded-2xl px-5 pb-4 pt-8 sm:min-h-[184px]',
              lead
                ? 'bg-[linear-gradient(155deg,hsl(var(--primary)),hsl(var(--primary)/0.8))] text-pv-primary-fg'
                : 'border border-pv-border bg-pv-card',
            );
            return (
              <li key={id} className="flex">
                {href ? (
                  <a
                    href={href}
                    {...(id === 'location' ? { target: '_blank', rel: 'noreferrer' } : {})}
                    className={cn(
                      box,
                      'group transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/30 motion-reduce:transition-none',
                      !lead && 'hover:border-pv-primary/40',
                    )}
                  >
                    {body}
                  </a>
                ) : (
                  <div className={box}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {badges.length > 0 ? (
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {badges.map(({ badge, index }) => {
            const Icon = resolveIcon(badge.icon);
            return (
              <li
                key={`${badge.label}-${index}`}
                title={badge.tooltip || undefined}
                className="inline-flex items-center gap-1.5 rounded-full bg-pv-tint px-3.5 py-2 text-[13px] font-medium text-pv-fg"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-pv-primary" strokeWidth={1.75} />
                <Editable path={`contact.trust_badges.badges.${index}.label`}>{badge.label}</Editable>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
