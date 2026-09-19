import { CtaBanner } from "@nw/components/sections/cta-banner";
import { LegalPage } from "@nw/components/sections/legal-page";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <LegalPage
        slug="privacy"
        sectionKey="privacy_content"
        fallbackTitle="Privacy Policy"
      />
      <CtaBanner />
    </>
  );
}
