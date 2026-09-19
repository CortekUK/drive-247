import { SiteShell } from "@/components/custom-booking-page/site-shell";
import { ArticleView } from "@/components/custom-booking-page/views";
import { getCbpSeed } from "../../seed";

/**
 * One article. The slug is resolved client-side against the active tenant —
 * slugs are unique per tenant, not globally, so the lookup has to carry the
 * tenant id with it (see `useArticle`).
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <SiteShell seed={await getCbpSeed()}>
      <ArticleView slug={decodeURIComponent(slug)} />
    </SiteShell>
  );
}
