import { ArrowUpRight, ChevronDown, Mail, MapPin, MessageCircle, Phone } from 'lucide-react-nw';
import type { LucideIcon } from 'lucide-react-nw';

import { DEFAULT_CONTACT_HERO, DEFAULT_CONTACT_INFO, DEFAULT_SITE_CONTACT, EMPTY_CONTACT_INFO } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { loadSection, resolveTenant } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { loadOpeningHours, type OpeningHours } from '@nw/site-v2/sections/contact-hours';
import { Template2ContactForm } from '@nw/template-2/contact-form';

/**
 * Template 2 ("Glass") — Contact (/template-2/contact), laid out like a
 * messaging app, as the home page's questions are:
 *
 *   the ways in   a list like a phone's conversations — call, WhatsApp,
 *                 email, visit — each row the link, with its note, under a
 *                 line on today's hours (all the hours fold out below it)
 *   the thread    beside it, the message form as a conversation with the
 *                 operator (`contact-form.tsx`)
 *   the map       full width under both, the address on a card over it
 *
 * Same sources and precedence as site-v2 (`contact-details-section.tsx` and
 * `contact-map-section.tsx` document why): Site Settings wins for the
 * business details, `contact / contact_info` is the fallback and holds the
 * notes, WhatsApp is page-only, every row is absent until filled in; the
 * page's own office address wins for the map, and no address means no map.
 */

const PAGE = 'mx-auto w-full max-w-[1320px] px-3 sm:px-5';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

type Way = { id: string; Icon: LucideIcon; label: string; value: string; note: string; href: string; path: string; notePath: string };

const join = (parts: readonly string[]) =>
  parts.map((part) => part.trim()).filter((part) => part !== '').join(', ');

export async function Template2ContactPage() {
  const [hero, info, pageInfo, site, hours, tenant] = await Promise.all([
    loadSection('contact', 'hero', DEFAULT_CONTACT_HERO),
    loadSection('contact', 'contact_info', DEFAULT_CONTACT_INFO),
    loadSection('contact', 'contact_info', EMPTY_CONTACT_INFO),
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadOpeningHours(),
    resolveTenant(),
  ]);

  const operator = tenant?.company_name?.trim() || tenant?.app_name?.trim() || 'us';
  const subtitle = hero.subtitle.trim();
  const email = site.email.trim() || info.email.address.trim();
  const phone = site.phone_display.trim() || site.phone.trim() || info.phone.number.trim();
  const dial = (site.phone.trim() || phone).replace(/[^+\d]/g, '');
  const siteAddress =
    site.address_line1.trim() !== '' || site.city.trim() !== ''
      ? join([site.address_line1, site.address_line2, site.city, site.state, site.zip, site.country])
      : '';
  const office = siteAddress || info.office.address.trim();
  const mapAddress = pageInfo.office.address.trim() || siteAddress;
  const whatsapp = info.whatsapp.number.trim();
  const directions = site.google_maps_url.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(office || mapAddress)}`;

  const ways: Way[] = [];
  if (phone !== '') ways.push({ id: 'phone', Icon: Phone, label: 'Call us', value: phone, note: info.phone.availability.trim(), href: `tel:${dial}`, path: 'contact.contact_info.phone.number', notePath: 'contact.contact_info.phone.availability' });
  if (whatsapp !== '') ways.push({ id: 'whatsapp', Icon: MessageCircle, label: 'WhatsApp', value: whatsapp, note: info.whatsapp.description.trim(), href: `https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`, path: 'contact.contact_info.whatsapp.number', notePath: 'contact.contact_info.whatsapp.description' });
  if (email !== '') ways.push({ id: 'email', Icon: Mail, label: 'Email', value: email, note: info.email.response_time.trim() ? `Replies ${info.email.response_time.trim()}` : '', href: `mailto:${email}`, path: 'contact.contact_info.email.address', notePath: 'contact.contact_info.email.response_time' });
  if (office !== '') ways.push({ id: 'office', Icon: MapPin, label: 'Visit us', value: office, note: '', href: directions, path: 'contact.contact_info.office.address', notePath: '' });

  return (
    <div className="space-y-3 pb-3">
      <section aria-labelledby="g2-contact-title" className={cn(PAGE, 'pt-[84px] sm:pt-[96px]')}>
        {/* From a laptop up, the opening is exactly one screen with the navbar: the
            pane takes the height under it, the columns the room under the title.
            On a short screen it grows instead of crushing the form. */}
        <div className={cn(PANE, 'lg:flex lg:h-[calc(100svh-108px)] lg:min-h-[620px] lg:flex-col')}>
          <header {...cmsSection('contact.hero', 'Hero')} className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10 lg:pb-6 lg:pt-5">
            <h1
              id="g2-contact-title"
              className="mx-auto max-w-[18ch] text-[38px] lg:max-w-none font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[56px] lg:text-[clamp(44px,6.4svh,60px)]"
            >
              <Editable path="contact.hero.title">{hero.title}</Editable>
            </h1>
            {subtitle ? (
              <p className="mx-auto mt-3 max-w-[36rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
                <Editable path="contact.hero.subtitle">{subtitle}</Editable>
              </p>
            ) : null}
          </header>

          <div className={cn('grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1', (ways.length > 0 || hours) && 'lg:grid-cols-[400px_minmax(0,1fr)]')}>
            {ways.length > 0 || hours ? (
              <div {...cmsSection('contact.contact_info', 'Contact details')} className="g2-well g2-tray flex flex-col rounded-[28px] p-2 lg:min-h-0 lg:overflow-y-auto">
                {hours ? <Hours hours={hours} /> : null}
                <ul aria-label="Ways to reach us" className="flex flex-col gap-1">
                  {ways.map((way) => (
                    <WayRow key={way.id} way={way} />
                  ))}
                </ul>
              </div>
            ) : null}
            <div id="contact-form" className="min-w-0 scroll-mt-24">
              <Template2ContactForm operator={operator} replyTime={info.email.response_time.trim()} />
            </div>
          </div>
        </div>
      </section>

      {mapAddress !== '' ? (
        <section {...cmsSection('site-settings.contact', 'Map')} aria-label="Where we are" className={PAGE}>
          <div className={cn(PANE, 'relative')}>
            <iframe
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapAddress)}&z=14&output=embed&iwloc=near`}
              title={`Map: ${mapAddress}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block h-[360px] w-full rounded-[24px] border-0 sm:h-[440px] sm:rounded-[28px]"
            />
            <div className="absolute bottom-6 left-6 right-6 max-w-[360px] rounded-[22px] bg-white/85 p-5 shadow-[0_18px_40px_-24px_rgb(13_12_29/0.6),inset_0_1px_0_#fff] backdrop-blur-xl sm:bottom-9 sm:left-9 sm:right-auto">
              <p className="text-[13px] font-semibold text-[var(--g2-accent-ink)]">Where we are</p>
              <p className="mt-1 text-[16px] font-semibold leading-snug text-[var(--g2-ink)]">{mapAddress}</p>
              <a
                href={directions}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('mt-3 inline-flex items-center gap-1.5 rounded text-[14px] font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}
              >
                Get directions
                <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.25} />
              </a>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Today's hours in one line, every day's folded out under it. */
function Hours({ hours }: { hours: OpeningHours }) {
  const today = hours.groups.find((group) => group.today);
  const line = hours.alwaysOpen ? 'Open every day, any time' : today ? (today.hours ? `Open today, ${today.hours}` : 'Closed today') : 'Pickup and return hours';
  const open = hours.alwaysOpen || !!today?.hours;
  return (
    <details className="group mb-1 rounded-[22px] bg-white/70 shadow-[inset_0_1px_0_#fff]">
      <summary className={cn('flex cursor-pointer list-none items-center gap-3 rounded-[22px] px-4 py-3.5 [&::-webkit-details-marker]:hidden', FOCUS)}>
        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', open ? 'bg-emerald-500 shadow-[0_0_0_4px_rgb(16_185_129/0.18)]' : 'bg-[var(--g2-ink-soft)]/40')} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-[var(--g2-ink)]">{line}</span>
          <span className="block text-[12.5px] text-[var(--g2-ink-soft)]">Pickup and return hours{hours.zone ? `, ${hours.zone}` : ''}</span>
        </span>
        {hours.alwaysOpen ? null : <ChevronDown aria-hidden className="size-4 shrink-0 text-[var(--g2-ink-soft)] transition-transform duration-200 group-open:rotate-180" />}
      </summary>
      {hours.alwaysOpen ? null : (
        <dl className="mx-4 divide-y divide-[rgb(13_12_29/0.07)] border-t border-[rgb(13_12_29/0.07)] pb-2">
          {hours.groups.map((group) => (
            <div key={group.days} className="flex items-baseline justify-between gap-4 py-2 text-[14px]">
              <dt className={cn('text-[var(--g2-ink)]', group.today && 'font-semibold')}>{group.days}</dt>
              <dd className={cn('shrink-0 tabular-nums', group.hours ? 'font-semibold text-[var(--g2-ink)]' : 'text-[var(--g2-ink-soft)]')}>{group.hours ?? 'Closed'}</dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}

/** One way to reach them, as a row in a conversation list. */
function WayRow({ way }: { way: Way }) {
  const { Icon } = way;
  const external = way.href.startsWith('http');
  return (
    <li>
      <a
        href={way.href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={cn('group flex items-center gap-3.5 rounded-[22px] px-3 py-3 transition-colors duration-200 hover:bg-white/70', FOCUS)}
      >
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[var(--g2-accent-ink)] shadow-[inset_0_1px_0_#fff,0_6px_14px_-10px_rgb(13_12_29/0.4)] transition-colors duration-200 group-hover:bg-[var(--g2-accent)] group-hover:text-white">
          <Icon className="size-5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--g2-ink-soft)]">{way.label}</span>
            {way.note ? (
              <span className="truncate text-[12px] text-[var(--g2-ink-soft)]">
                <Editable path={way.notePath}>{way.note}</Editable>
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[15.5px] font-semibold leading-snug text-[var(--g2-ink)]">
            {/* An address may break after its "@", never in the middle of a word. */}
            <Editable path={way.path}>
              {way.id === 'email' && way.value.includes('@') ? (
                <>
                  {way.value.slice(0, way.value.indexOf('@') + 1)}
                  <wbr />
                  {way.value.slice(way.value.indexOf('@') + 1)}
                </>
              ) : (
                way.value
              )}
            </Editable>
          </span>
        </span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-[var(--g2-ink-soft)] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </a>
    </li>
  );
}
