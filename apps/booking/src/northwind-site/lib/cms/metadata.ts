import type { Metadata } from "next";

import { loadSection } from "./server";
import type { CmsPageSlug } from "./types";

/**
 * A page's own "Search listing" block, as Next metadata.
 *
 * Every CMS page carries a `seo` section — Title, Description, Keywords, with
 * the character limits shown in the portal — and NOTHING in this app read it.
 * Each route exported a hardcoded `metadata = { title: "About" }`, so an
 * operator could write the sentence Google shows under their link, publish it,
 * and the page still said "About".
 *
 * Blank fields fall through: the title to the route's own fallback, and the
 * description to the tenant-level one set in Site Settings -> Search & sharing.
 * That ordering matters — a page-specific description is more useful than the
 * site-wide one, but a blank page field must not blank the site default.
 *
 * The root layout's `generateMetadata` still supplies the `%s · Tenant Name`
 * template, so a page only has to return its own half.
 */
export async function pageMetadata(
  slug: CmsPageSlug,
  fallbackTitle: string,
): Promise<Metadata> {
  const seo = await loadSection(slug, "seo", {
    title: "",
    description: "",
    keywords: "",
  });

  const title = seo.title.trim() || fallbackTitle;
  const description = seo.description.trim();
  const keywords = seo.keywords
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");

  /* An empty title must be OMITTED, not returned as "". The home page passes no
     fallback — its title is the tenant's name, resolved once in the root layout
     — and returning an empty string here would override that with nothing. */
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(title || description
      ? {
          openGraph: {
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
          },
        }
      : {}),
  };
}
