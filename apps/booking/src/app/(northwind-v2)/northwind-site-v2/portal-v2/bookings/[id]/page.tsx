import { redirect } from 'next/navigation';

/** Renamed /portal/rentals/[id]; kept for links already sent (emails, notifications). */
export default async function PortalBookingDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/portal/rentals/${encodeURIComponent(id)}`);
}
