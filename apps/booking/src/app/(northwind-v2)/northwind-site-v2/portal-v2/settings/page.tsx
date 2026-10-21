'use client';

/**
 * /portal/settings — built the way the operator's Settings is: an index of
 * tiles, and one page per section at `?section=`, each with one heading. As on
 * the operator portal there is no breadcrumb: the Settings gear on the profile
 * row is the way back to the index.
 *
 *   Details · Verification · Gig driver · Consent · Account
 *
 * (Oct 21 2026, second pass: Address and license folded into Details, ID
 * verification into Verification, My profile into Account. Every section is a
 * page — nothing here opens as a dialog. Older `?section=` values land on the
 * page that absorbed them.)
 */

import { useSearchParams } from 'next/navigation';

import { useTenant } from '@nw/contexts/TenantContext';

import { SettingsIndex, type SettingsSectionKey } from './_components/settings-index';
import { SETTINGS_PAGE_COLUMN } from './_components/settings-ui';
import { AccountSettings } from './_sections/account';
import { ConsentSettings } from './_sections/consent';
import { DetailsSettings } from './_sections/details';
import { GigDriverSettings } from './_sections/gig-driver';
import { VerificationSettings } from './_sections/verification';

const ABSORBED: Record<string, SettingsSectionKey> = { address: 'details', profile: 'account' };
const SECTIONS: readonly SettingsSectionKey[] = ['details', 'verification', 'gig-driver', 'consent', 'account'];

export default function PortalSettingsPage() {
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;

  const raw = searchParams?.get('section') ?? null;
  const key = raw ? (ABSORBED[raw] ?? raw) : null;
  const section = SECTIONS.includes(key as SettingsSectionKey) ? (key as SettingsSectionKey) : null;

  if (!section || (section === 'gig-driver' && tenant && !gigDriver)) return <SettingsIndex />;

  return (
    <div key={section} className={SETTINGS_PAGE_COLUMN}>
      {section === 'details' ? (
        <DetailsSettings />
      ) : section === 'verification' ? (
        <VerificationSettings />
      ) : section === 'gig-driver' ? (
        <GigDriverSettings />
      ) : section === 'consent' ? (
        <ConsentSettings />
      ) : (
        <AccountSettings />
      )}
    </div>
  );
}
