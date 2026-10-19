import { resolveTenant } from "@nw/lib/cms/server";
import { InviteRegistration } from "@nw/site-v2/register/invite-registration";

/**
 * A customer invite link — `/register/<token>` — in the v2 booking site. v2 of
 * `(northwind)/northwind-site/register/[token]/page.tsx`. The operator sends it
 * from Customers → Invite.
 *
 * The (site) layout's shell is the frame (header, footer, brand wash), so this
 * page renders only its own content. Same edge functions, same order, same
 * payloads as v1, through the shared `use-invite-registration.ts`:
 * validate-customer-invite → (optional) create-ai-verification-session and a
 * poll of identity_verifications → submit-customer-registration.
 */
export const metadata = {
  title: "You're invited",
  // The token is a one-person credential: keep it out of search.
  robots: { index: false, follow: false },
};

export default async function RegisterPageV2({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // `cache()`d — the layout already made this read.
  const tenant = await resolveTenant();
  const tenantName = tenant?.app_name || tenant?.company_name || null;

  return <InviteRegistration token={token} companyFallback={tenantName} />;
}
