import { Template2LegalPage } from "@nw/template-2/legal-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — Privacy Policy, on the preview link (/template-2/privacy). */

export const metadata = { title: "Privacy Policy" };

export default function Template2PrivacyRoute() {
  return (
    <>
      <Template2LegalPage slug="privacy" sectionKey="privacy_content" fallbackTitle="Privacy Policy" />
      <Template2PageClosing />
    </>
  );
}
