import { redirect } from 'next/navigation';

/** Documents became Insurances (Oct 21 2026). Old links land there. */
export default function PortalDocumentsRedirect() {
  redirect('/portal/insurances');
}
