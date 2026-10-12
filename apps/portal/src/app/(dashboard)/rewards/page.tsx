import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { RewardsView } from '@/components/rewards-v2/rewards-view';

/**
 * Rewards — the Creator Rewards Programme. V2 tenants only.
 *
 * Gated on the server like `/integrations`: a tenant without the v2 chrome gets
 * the portal's normal 404, exactly as before this route existed. The database
 * enforces the same rule a second time — `submit_creator_reward()` refuses any
 * tenant that is not on v2 — so the gate is not only cosmetic.
 */
export default async function RewardsPage() {
  if (!(await serverIsV2('chrome'))) {
    notFound();
  }
  return <RewardsView />;
}
