import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { ReferralsView } from '@/components/referrals/referrals-view';

/**
 * Referrals — the operator's Drive247 referral programme. A new route with no
 * v1 counterpart, shown in both rails.
 *
 * The gate is resolved HERE, on the server, once, before anything renders
 * (V2_PLAN §3). A tenant outside the `referrals` area gets the 404 screen.
 * Managers are additionally checked against the Subscription permission via
 * ROUTE_TO_TAB (lib/permissions.ts).
 */
export default async function ReferralsPage() {
  if (!(await serverIsV2('referrals'))) {
    notFound();
  }
  return <ReferralsView />;
}
