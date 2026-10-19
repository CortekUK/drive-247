import { notFound } from "next/navigation";

/**
 * An address v2 has no page for 404s inside v2, not in another design's
 * catch-all. It lives in (site)/ so the 404 renders inside the site's own frame
 * (header and footer kept) via (site)/not-found.tsx — from the group's root it
 * would fall through to the bare root not-found.
 */
export default function NorthwindV2NotFound() {
  notFound();
}
