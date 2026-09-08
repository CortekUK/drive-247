import { CtaBanner } from "@/components/sections/cta-banner";
import { LegalPage } from "@/components/sections/legal-page";

export const metadata = { title: "Terms & Conditions" };

export default function TermsPage() {
  return (
    <>
      <LegalPage
        slug="terms"
        sectionKey="terms_content"
        fallbackTitle="Terms & Conditions"
      />
      <CtaBanner />
    </>
  );
}
