/**
 * The Stripe events subscription-webhook actually implements.
 *
 * WHY THIS IS A SHARED CONSTANT. A handler only runs if the Stripe endpoint is
 * SUBSCRIBED to its event, and that subscription lives in Stripe's config, not
 * in this repo — so the two drift silently and no code review can catch it. An
 * audit found the endpoint subscribed to exactly five events while the switch
 * handled nine. Four handlers had never run once:
 *
 *   invoice.voided / invoice.marked_uncollectible / invoice.deleted
 *     Added specifically so that voiding a failed invoice as goodwill releases
 *     the tenant from the 7-day grace clock. It could not, so a tenant stayed
 *     hard-blocked over an invoice Stripe considered settled, holding a "pay
 *     your pending invoice" link they could not act on.
 *
 *   customer.subscription.created
 *     Added so a subscription that reaches Stripe but never reaches us is
 *     adopted at signup rather than at first failure.
 *
 * Keep this list and the switch in subscription-webhook/index.ts in step, then
 * run the sync-subscription-webhook-events function to push it to every
 * account/mode endpoint.
 */
export const SUBSCRIPTION_WEBHOOK_EVENTS = [
  // Signup
  "checkout.session.completed",
  "customer.subscription.created",
  // Lifecycle
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Collection
  "invoice.paid",
  "invoice.payment_failed",
  // An invoice can stop being owed without being paid
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.deleted",
  // Money flowing backwards
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;
