import { redirect } from 'next/navigation';

/** Gig driver moved into Settings (Oct 21 2026). Old links land there. */
export default function PortalGigDriverRedirect() {
  redirect('/portal/settings?section=gig-driver');
}
