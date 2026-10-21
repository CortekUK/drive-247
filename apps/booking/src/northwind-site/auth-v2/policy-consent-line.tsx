'use client';

/**
 * "By continuing, you agree to …" under the sign-in and sign-up buttons. The
 * customer portal records the acceptance on arrival (record_customer_policy_
 * consent: the tenant's current privacy policy and terms versions), and
 * Settings → Consent shows it — so the screens that lead there say so.
 */

import Link from 'next/link';

import { useTenant } from '@nw/contexts/TenantContext';

export function PolicyConsentLine({ ink }: { ink?: string }) {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? tenant?.app_name ?? 'the rental company';
  return (
    <p className="mt-4 text-center text-xs leading-relaxed text-pv-muted-fg">
      By continuing, you agree to {company}&apos;s{' '}
      <Link href="/terms" target="_blank" className="font-medium underline-offset-4 hover:underline" style={{ color: ink }}>
        Terms of Service
      </Link>{' '}
      and{' '}
      <Link href="/privacy" target="_blank" className="font-medium underline-offset-4 hover:underline" style={{ color: ink }}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}
