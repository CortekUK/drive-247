import { pageMetadata } from "@nw/lib/cms/metadata";
import { Template2ContactPage } from "@nw/template-2/contact-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — Contact, on the preview link (/template-2/contact). */

export function generateMetadata() {
  return pageMetadata("contact", "Contact");
}

export default function Template2ContactRoute() {
  return (
    <>
      <Template2ContactPage />
      <Template2PageClosing />
    </>
  );
}
