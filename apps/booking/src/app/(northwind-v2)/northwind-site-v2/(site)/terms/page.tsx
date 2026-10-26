import { LegalPage } from '@nw/site-v2/sections/legal-page';

/** Northwind booking site v2 — /terms. */

export const metadata = { title: 'Terms & Conditions' };

export default function TermsPage() {
  return (
    <>
      <LegalPage slug="terms" sectionKey="terms_content" fallbackTitle="Terms & Conditions" />
    </>
  );
}
