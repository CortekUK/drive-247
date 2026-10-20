import { redirect } from 'next/navigation';

/**
 * Notifications left the rail: they open in the top bar's sheet, from any
 * page. This address stays alive for links already sent, and opens the sheet
 * over Home (the shell reads `?panel=notifications`).
 */
export default function PortalNotificationsRedirect() {
  redirect('/portal?panel=notifications');
}
