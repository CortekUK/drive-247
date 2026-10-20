import { redirect } from 'next/navigation';

/**
 * The section was renamed Rentals (/portal/rentals). This address stays alive
 * for every link already sent: confirmation emails, stored notifications,
 * bookmarks.
 */
export default function PortalBookingsRedirect() {
  redirect('/portal/rentals');
}
