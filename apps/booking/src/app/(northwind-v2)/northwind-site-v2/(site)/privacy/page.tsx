import { LegalPage } from '@nw/site-v2/sections/legal-page';

/** Northwind booking site v2 — /privacy. */

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <>
      <LegalPage slug="privacy" sectionKey="privacy_content" fallbackTitle="Privacy Policy" />
    </>
  );
}
