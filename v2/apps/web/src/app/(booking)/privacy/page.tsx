import { CtaBanner } from "@/components/sections/cta-banner";
import { LegalPage } from "@/components/sections/legal-page";

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
