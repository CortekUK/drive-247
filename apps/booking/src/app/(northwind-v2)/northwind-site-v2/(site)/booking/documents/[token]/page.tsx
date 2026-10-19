import type { Metadata } from "next";

import { BookingDocumentsScreen } from "@nw/site-v2/booking/documents-screen";

/**
 * /booking/documents/<token> — v2 of `(northwind)/northwind-site/(booking)/
 * booking/documents/[token]/page.tsx`: the page a customer lands on after
 * paying, to send their identity photos and insurance document. The durable
 * token in their email is the only credential (no login), which is why this
 * sits in the public (site) group and not under the portal.
 *
 * The token is passed through undecoded and unvalidated, exactly as v1 does —
 * only the server knows what a real token looks like.
 */

export const metadata: Metadata = {
  title: "Send your documents",
  description:
    "Send your identity and insurance documents so we can review them and confirm your booking.",
  // A live bearer token for a paid booking: never index or archive it.
  robots: { index: false, follow: false, nocache: true },
};

export default async function BookingDocumentsRouteV2({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingDocumentsScreen token={token} />;
}
