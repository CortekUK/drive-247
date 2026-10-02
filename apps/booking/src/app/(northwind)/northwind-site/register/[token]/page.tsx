import { InviteRegistration } from "./_components/invite-registration";

/**
 * A customer invite link — `/register/<token>` — in the NEW booking design
 * (Ghulam, Oct 2 2026: "make a good, like awesome UI of it").
 *
 * The operator sends this from Customers → Invite. The original design's page
 * (`(legacy)/register/[token]`) still serves every other tenant, unchanged;
 * northwind reaches this one because `register` is no longer in
 * ORIGINAL_ONLY_SEGMENTS (lib/booking-design.ts), which only new-design
 * tenants consult.
 *
 * Same edge functions, same order, same payloads as the original page:
 * validate-customer-invite → (optional) create-ai-verification-session and a
 * poll of identity_verifications → submit-customer-registration. Only the
 * presentation is new.
 */
export const metadata = { title: "You're invited" };

export default async function RegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteRegistration token={token} />;
}
