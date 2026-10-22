'use client';

/**
 * The Settings index — the operator's (settings-v2/settings-index.tsx), for a
 * customer: the page title, then the tiles, each a brand-coloured title over
 * one line on what is inside, the light purple tint on hover the only
 * affordance, as there. Two to a row and the fifth underneath (owner, Oct 21
 * 2026: "two, two, then one"). The top bar's field searches the tiles
 * ("in Settings"), as the operator's does; nothing found is the operator's
 * search empty state.
 *
 * Every tile opens its page at `?section=`.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useTenant } from '@nw/contexts/TenantContext';
import { SearchEmptyArt } from '@portal-v2-shared/empty-states/empty-scenes';
import { TeachingEmptyState } from '@portal-v2-shared/empty-states/teaching-empty-state';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import { PortalAlertBar } from '@nw/portal-v2/alert-bar';

import { SETTINGS_PAGE_TITLE } from './settings-ui';

export type SettingsSectionKey = 'details' | 'verification' | 'gig-driver' | 'consent' | 'account';

interface Tile {
  key: SettingsSectionKey;
  title: string;
  description: string;
  keywords?: string;
}

const TILE =
  'group -mx-3 block w-[calc(100%+1.5rem)] self-start cursor-pointer rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-200 ' +
  'hover:bg-pv-primary/10 focus-visible:ring-3 focus-visible:ring-pv-ring/30 motion-reduce:transition-none';

export function SettingsIndex() {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? tenant?.app_name ?? 'the rental company';
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;
  const [query, setQuery] = useState('');

  usePageSearch({ placeholder: 'Search settings', scopeLabel: 'Settings', value: query, onChange: setQuery });

  const tiles = useMemo(() => {
    const all: Tile[] = [
      {
        key: 'details',
        title: 'Details',
        description: 'Your name, phone, time zone and address, and the date of birth and expiry from your ID.',
        keywords: 'name phone timezone time zone address street city state zip birth age expiry',
      },
      {
        key: 'verification',
        title: 'Verification',
        description: 'Verify who you are with your driving licence or ID card, and correct what the scan read.',
        keywords: 'id identity licence license document passport check selfie qr',
      },
      ...(gigDriver
        ? [
            {
              key: 'gig-driver' as const,
              title: 'Gig driver',
              description: `Pictures and documents of your Uber, Lyft or delivery app profile, for ${company}'s gig driver rates.`,
              keywords: 'uber lyft doordash delivery proof upload pdf',
            },
          ]
        : []),
      {
        key: 'consent',
        title: 'Consent',
        description: `The privacy policy and terms you accepted, and what you agreed to for each rental.`,
        keywords: 'privacy policy terms service consent agreement rentals',
      },
      {
        key: 'account',
        title: 'Account',
        description: 'Your photo and name, and how you sign in: email, password and Google.',
        keywords: 'photo avatar picture name sign in login password google email security profile',
      },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => `${item.title} ${item.description} ${item.keywords ?? ''}`.toLowerCase().includes(q));
  }, [company, gigDriver, query]);

  return (
    <div className="w-full max-w-[1160px] space-y-9 pb-6 md:pt-[26px]">
      <div className="flex flex-col gap-4">
        <h1 className={SETTINGS_PAGE_TITLE}>Settings</h1>
        <PortalAlertBar />
      </div>

      {tiles.length === 0 ? (
        <TeachingEmptyState
          illustration={<SearchEmptyArt />}
          headline={`No settings match “${query.trim()}”`}
          body={
            <>
              Try another word, or{' '}
              <button type="button" onClick={() => setQuery('')} className="font-medium text-pv-link underline-offset-2 hover:underline">
                clear the search
              </button>{' '}
              to see every setting.
            </>
          }
        />
      ) : (
        <div className="grid max-w-[760px] gap-x-8 gap-y-2 sm:grid-cols-2">
          {tiles.map((item) => (
            <Link key={item.key} href={`/portal/settings?section=${item.key}`} className={TILE}>
              <span className="text-[15px] font-medium text-pv-primary">{item.title}</span>
              <span className="mt-1 block max-w-[320px] text-[13px] leading-[1.45] text-pv-muted-fg">{item.description}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
