import { redirect } from 'next/navigation';

/** ID verification moved into Settings (Oct 21 2026). Old links land there. */
export default function PortalVerificationRedirect() {
  redirect('/portal/settings?section=verification');
}
