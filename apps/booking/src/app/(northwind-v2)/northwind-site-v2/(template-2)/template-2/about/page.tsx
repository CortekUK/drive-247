import { pageMetadata } from "@nw/lib/cms/metadata";
import { Template2AboutPage } from "@nw/template-2/about-page";

/** Template 2 ("Glass") — About, on the preview link (/template-2/about). */

export function generateMetadata() {
  return pageMetadata("about", "About");
}

export default function Template2AboutRoute() {
  return <Template2AboutPage />;
}
