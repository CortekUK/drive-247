import { Template2LegalPage } from "@nw/template-2/legal-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — Terms & Conditions, on the preview link (/template-2/terms). */

export const metadata = { title: "Terms & Conditions" };

export default function Template2TermsRoute() {
  return (
    <>
      <Template2LegalPage slug="terms" sectionKey="terms_content" fallbackTitle="Terms & Conditions" />
      <Template2PageClosing />
    </>
  );
}
