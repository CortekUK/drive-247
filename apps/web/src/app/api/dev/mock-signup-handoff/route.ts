import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Same address as MOCK_OWNER_EMAIL in mock-signup.ts (a client module, so not imported here). */
const MOCK_OWNER_EMAIL = "ilyasghulam35@gmail.com";

/**
 * The end of the localhost signup rehearsal (components/onboarding/mock-signup.ts).
 *
 * The mock build screen's "Go to my portal" lands here. It mints a one-time
 * sign-in token for the rehearsal owner and sends the browser to that owner's
 * own workspace on the local portal, with `firstrun=1` so the portal re-arms
 * the welcome questions, the quick tour and the checklist on arrival
 * (apps/portal/src/lib/first-run-handoff.ts).
 *
 * `generateLink` sends no email; the token is spent by the portal's
 * /dev-handoff page. DEVELOPMENT ONLY: in any build NODE_ENV folds to
 * "production" and this answers 404.
 */
const IS_DEV = process.env.NODE_ENV === "development";
const PORTAL_PORT = 4002;

export async function GET() {
  if (!IS_DEV) return new NextResponse("Not found", { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return new NextResponse("SUPABASE_SERVICE_ROLE_KEY is missing from apps/web/.env.local", {
      status: 500,
    });
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: owner, error: ownerError } = await admin
    .from("app_users")
    .select("tenant_id")
    .eq("email", MOCK_OWNER_EMAIL)
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: tenant } = owner?.tenant_id
    ? await admin.from("tenants").select("slug").eq("id", owner.tenant_id).maybeSingle()
    : { data: null };
  const slug = (tenant as { slug?: string } | null)?.slug;
  if (ownerError || !slug) {
    return new NextResponse(
      `No portal workspace found for ${MOCK_OWNER_EMAIL}${ownerError ? `: ${ownerError.message}` : ""}`,
      { status: 500 },
    );
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: MOCK_OWNER_EMAIL,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return new NextResponse(`Could not create a sign-in token: ${linkError?.message ?? "no token"}`, {
      status: 500,
    });
  }

  const next = `/?tenant=${encodeURIComponent(slug)}&firstrun=1`;
  const target = new URL(`http://${slug}.portal.localhost:${PORTAL_PORT}/dev-handoff`);
  target.searchParams.set("token_hash", tokenHash);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target.toString());
}
