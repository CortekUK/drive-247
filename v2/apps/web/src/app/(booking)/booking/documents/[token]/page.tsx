import type { Metadata } from "next";

import { BookingDocumentsScreen } from "@/components/booking/document-capture";

/**
 * /booking/documents/<token> — the surface a customer lands on after paying.
 *
 * ── WHY THIS ROUTE IS WHERE IT IS ───────────────────────────────────────────
 * It sits under `(booking)`, and it MUST. `(portal)/layout.tsx` computes
 * `allowed = isAuthenticated && !tenantMismatch` and `router.replace`s to
 * /login otherwise, while `lib/booking/create-booking.ts` writes only a
 * `customers` row for a new booking — no `auth.users`, no `customer_users`, no
 * session. The person this page exists for has just paid inside Stripe Elements
 * and has no login at all, so anything under /portal would be unreachable to
 * exactly the user it is for. The durable token in their email is the only
 * credential this whole surface has.
 *
 * It is also NOT named /verify/<token>. That path is v1's QR-handoff route,
 * whose token is a short-lived QR session; ours is the seven-day durable link.
 * Two different credentials with two different lifetimes must not share a shape
 * a person could confuse.
 *
 * ── WHY THIS FILE IS A SERVER COMPONENT ─────────────────────────────────────
 * The same reason as `booking/[vehicleId]/page.tsx` next door: `params` is a
 * Promise in Next 16 and a client component cannot await it. Everything below
 * the await is client-side, because resolving the token means calling an edge
 * function and then running a camera flow.
 *
 * Being a server component also buys the `robots` directive below, which a
 * client component cannot export — and on a bearer-token URL that is worth
 * having. See its own note.
 */

export const metadata: Metadata = {
  title: "Send your documents",
  description:
    "Upload your driving licence and a photo of yourself to finish your booking.",
  /*
    Every URL in this route carries a live bearer token for a PAID booking, and
    opening one has side effects: the edge function mints an AI verification
    session and slides the link's expiry. Neither indexing it nor letting a
    crawler walk it is wanted. `nocache` covers the archived-snapshot case,
    which is the one that would keep a token readable after it expired.
  */
  robots: { index: false, follow: false, nocache: true },
};

export default async function BookingDocumentsRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /*
    No manual decode. `bookingDocumentsHref` in `components/booking/payment-panel.tsx`
    percent-encodes the token on the way in and Next decodes a dynamic segment on
    the way out, so `token` here is already the value the function minted.
    Decoding again would corrupt a token containing a literal '%'. It is NOT validated
    for shape here: only the server knows what a real token looks like, and a
    guess in this file would be a second, divergent opinion. An unknown token
    comes back `invalid_token` and gets its own screen.
  */
  return <BookingDocumentsScreen token={token} />;
}
