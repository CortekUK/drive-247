import { redirect } from 'next/navigation';

/** Renamed /portal/rentals/history; kept for links already sent. */
export default function PortalBookingHistoryRedirect() {
  redirect('/portal/rentals/history');
}
