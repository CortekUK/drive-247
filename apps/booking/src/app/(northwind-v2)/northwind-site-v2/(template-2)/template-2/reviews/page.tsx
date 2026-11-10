import { pageMetadata } from "@nw/lib/cms/metadata";
import { Template2ReviewsPage } from "@nw/template-2/reviews-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — Reviews, on the preview link (/template-2/reviews). */

export function generateMetadata() {
  return pageMetadata("reviews", "Reviews");
}

export default async function Template2ReviewsRoute({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  // On a dev server an empty wall shows sample reviews; `?sample=0` turns them off.
  const { sample } = await searchParams;
  return (
    <>
      <Template2ReviewsPage sample={sample !== "0"} />
      <Template2PageClosing />
    </>
  );
}
