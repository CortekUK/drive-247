'use client';

/**
 * /portal/settings — built the way the operator's Settings is (owner, Oct 21
 * 2026): an index of tiles, and one page per section at `?section=`, each
 * with the operator's settings header, rows and floating save bar. As on the
 * operator portal there is no breadcrumb: the Settings gear on the profile
 * row is the way back to the index.
 *
 *   Your details  Details · Address and license · Verification · Gig driver
 *   Account       My profile (a dialog, as the operator's) · Consent · Account
 *
 * ID verification and Gig driver were their own rail tabs until this change;
 * their old addresses redirect here.
 */

import { useRouter, useSearchParams } from 'next/navigation';

import { useTenant } from '@nw/contexts/TenantContext';

import { SettingsIndex, type SettingsSectionKey } from './_components/settings-index';
import { SETTINGS_PAGE_COLUMN } from './_components/settings-ui';
import { AccountSettings } from './_sections/account';
import { GigDriverSettings } from './_sections/gig-driver';
import { MyProfileDialog } from './_sections/my-profile';
import { ProfileFormSettings } from './_sections/profile-form';
import { VerificationSettings } from './_sections/verification';

const SECTIONS: readonly SettingsSectionKey[] = ['details', 'address', 'verification', 'gig-driver', 'consent', 'account', 'profile'];

export default function PortalSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;

  const raw = searchParams?.get('section') ?? null;
  const section = SECTIONS.includes(raw as SettingsSectionKey) ? (raw as SettingsSectionKey) : null;
  const profileOpen = section === 'profile';

  const setProfileOpen = (open: boolean) => {
    router.replace(open ? '/portal/settings?section=profile' : '/portal/settings', { scroll: false });
  };

  if (!section || section === 'profile' || (section === 'gig-driver' && tenant && !gigDriver)) {
    return (
      <>
        <SettingsIndex onOpenProfile={() => setProfileOpen(true)} />
        <MyProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      </>
    );
  }

  return (
    <div key={section} className={SETTINGS_PAGE_COLUMN}>
      {section === 'details' || section === 'address' || section === 'consent' ? (
        <ProfileFormSettings section={section} />
      ) : section === 'verification' ? (
        <VerificationSettings />
      ) : section === 'gig-driver' ? (
        <GigDriverSettings />
      ) : (
        <AccountSettings />
      )}
    </div>
  );
}
