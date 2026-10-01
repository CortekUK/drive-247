import { redirect } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { ReferralsView } from '@/components/referrals/referrals-view';

/**
 * Referrals — the operator's Drive247 referral programme.
 *
 * OPEN TO EVERY TENANT since 30 Sep 2026. It used to resolve `serverIsV2
 * ('referrals')` here and 404 anyone outside the canary; that area is gone
 * (see the note where it used to sit in lib/v2.ts), so there is nothing left
 * to resolve and no reason to render a 404 to a paying operator.
 *
 * Still gated where it should be, and neither of these is a canary:
 *  - managers are checked against the Subscription permission via ROUTE_TO_TAB
 *    (lib/permissions.ts);
 *  - the programme itself only issues codes to subscribed operators, and the
 *    view says so to anyone else.
 */
export default async function ReferralsPage() {
  // v2 chrome: Referrals lives on Billing now (the coupon opens it all in a
  // dialog) and has no sidebar row, so an old link or a search hit lands there.
  if (await serverIsV2('chrome')) {
    redirect('/subscription');
  }
  return <ReferralsView />;
}
