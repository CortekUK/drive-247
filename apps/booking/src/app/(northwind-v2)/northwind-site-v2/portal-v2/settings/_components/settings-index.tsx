'use client';

/**
 * The Settings index — the operator's (settings-v2/settings-index.tsx), for a
 * customer: the page title, then titled sections of tiles in a three-column
 * grid, each tile a brand-coloured title over one line on what is inside. The
 * light purple tint on hover is the only affordance, as there. The top bar's
 * field searches the tiles ("in Settings"), as the operator's does.
 *
 * A tile opens its page at `?section=`; My profile opens the profile dialog,
 * as the operator's Profile does.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useTenant } from '@nw/contexts/TenantContext';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import { SETTINGS_PAGE_TITLE, SETTINGS_SECTION_TITLE } from './settings-ui';

export type SettingsSectionKey = 'details' | 'address' | 'verification' | 'gig-driver' | 'consent' | 'account' | 'profile';

interface Tile {
  key: SettingsSectionKey;
  title: string;
  description: string;
  keywords?: string;
}

const TILE =
  'group -mx-3 block w-[calc(100%+1.5rem)] self-start cursor-pointer rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-200 ' +
  'hover:bg-pv-primary/10 focus-visible:ring-3 focus-visible:ring-pv-ring/30 motion-reduce:transition-none';

export function SettingsIndex({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? tenant?.app_name ?? 'the rental company';
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;
  const [query, setQuery] = useState('');

  usePageSearch({ placeholder: 'Search settings', scopeLabel: 'Settings', value: query, onChange: setQuery });

  const sections = useMemo(() => {
    const all: { title: string; items: Tile[] }[] = [
      {
        title: 'Your details',
        items: [
          {
            key: 'details',
            title: 'Details',
            description: 'Your name and phone, your timezone, and the date of birth and ID expiry from your verified ID.',
            keywords: 'name phone timezone birth expiry',
          },
          {
            key: 'address',
            title: 'Address and license',
            description: "Your home address and your driver's license, used to fill in rental and insurance paperwork for you.",
            keywords: 'street city state zip driving licence',
          },
          {
            key: 'verification',
            title: 'Verification',
            description: 'Where your identity check stands, what your document says, and what happens next.',
            keywords: 'id identity document passport check',
          },
          ...(gigDriver
            ? [
                {
                  key: 'gig-driver' as const,
                  title: 'Gig driver',
                  description: `Screenshots of your Uber, Lyft or delivery app profile, for ${company}'s gig driver rates.`,
                  keywords: 'uber lyft doordash delivery proof',
                },
              ]
            : []),
        ],
      },
      {
        title: 'Account',
        items: [
          {
            key: 'profile',
            title: 'My profile',
            description: 'Your photo and your name, and your email and password, each changed with a six-digit code.',
            keywords: 'photo avatar picture name email password',
          },
          {
            key: 'consent',
            title: 'Consent',
            description: `Whether ${company} may text you or message you on WhatsApp about your rentals, and when you agreed.`,
            keywords: 'sms text whatsapp messages notifications',
          },
          {
            key: 'account',
            title: 'Account',
            description: 'How you sign in: your email and password, and the Google account linked to this one.',
            keywords: 'sign in login password google email security',
          },
        ],
      },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => `${item.title} ${item.description} ${item.keywords ?? ''}`.toLowerCase().includes(q)),
      }))
      .filter((section) => section.items.length > 0);
  }, [company, gigDriver, query]);

  return (
    <div className="w-full max-w-[1160px] space-y-9 pb-6 md:pt-[26px]">
      <h1 className={SETTINGS_PAGE_TITLE}>Settings</h1>

      {sections.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm font-semibold text-pv-fg">No settings match &ldquo;{query.trim()}&rdquo;</p>
          <button type="button" onClick={() => setQuery('')} className="mt-2 text-sm font-medium text-pv-primary hover:underline">
            Clear the search
          </button>
        </div>
      ) : (
        sections.map((section) => {
          const id = `settings-${section.title.toLowerCase().replace(/\s+/g, '-')}`;
          return (
            <section key={section.title} aria-labelledby={id}>
              <h2 id={id} className={SETTINGS_SECTION_TITLE}>
                {section.title}
              </h2>
              <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => {
                  const body = (
                    <>
                      <span className="text-[15px] font-medium text-pv-primary">{item.title}</span>
                      <span className="mt-1 block max-w-[320px] text-[13px] leading-[1.45] text-pv-muted-fg">{item.description}</span>
                    </>
                  );
                  return item.key === 'profile' ? (
                    <button key={item.key} type="button" onClick={onOpenProfile} className={TILE}>
                      {body}
                    </button>
                  ) : (
                    <Link key={item.key} href={`/portal/settings?section=${item.key}`} className={TILE}>
                      {body}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
