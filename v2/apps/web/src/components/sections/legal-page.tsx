import { htmlToParagraphs } from "@/lib/cms/html";
import { loadSection } from "@/lib/cms/server";
import type { CmsPageSlug } from "@/lib/cms/types";

/**
 * Privacy Policy and Terms & Conditions.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * The portal has carried a Privacy Policy and a Terms page since the CMS was
 * built, the footer links to both on every page of every tenant, and the v2
 * site had no route for either — so both links returned 404. An operator could
 * write their policy, publish it, and their customers still could not read it.
 * These are the two pages a rental business is most likely to be REQUIRED to
 * publish, so a dead link here is not a cosmetic gap.
 *
 * ── rendered as text, never injected ────────────────────────────────────────
 *
 * The body is rich text from the portal, stored as HTML. It goes through
 * `htmlToParagraphs` rather than `dangerouslySetInnerHTML`, for the reason
 * `lib/cms/html.ts` documents: the portal does not sanitise on write and this
 * page is public, so injecting it would be a stored-XSS sink. Headings, bold
 * and links are lost; the words survive, which is what a policy needs.
 */

interface LegalContent {
  title: string;
  last_updated: string;
  content: string;
}

const EMPTY: LegalContent = { title: "", last_updated: "", content: "" };

/** "2026-09-08" -> "8 September 2026", and anything unparseable is dropped. */
function formatDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export async function LegalPage({
  slug,
  sectionKey,
  fallbackTitle,
}: {
  slug: Extract<CmsPageSlug, "privacy" | "terms">;
  sectionKey: string;
  fallbackTitle: string;
}) {
  const legal = await loadSection(slug, sectionKey, EMPTY);

  const title = legal.title.trim() || fallbackTitle;
  const updated = formatDate(legal.last_updated);
  const paragraphs = htmlToParagraphs(legal.content);

  return (
    <article className="bg-white">
      <div className="container-page py-12 lg:py-20">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
            {title}
          </h1>
          {updated && (
            <p className="mt-3 text-sm text-brand-text-soft">
              Last updated {updated}
            </p>
          )}
        </header>

        {paragraphs.length > 0 ? (
          <div className="mt-8 flex max-w-3xl flex-col gap-4">
            {paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 24)}`}
                className="text-sm leading-relaxed text-brand-text-soft sm:text-base"
              >
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          /*
           * Deliberately NOT a shipped policy.
           *
           * Every other empty section on this site hides itself, but these two
           * are linked from the footer of every page: a visitor who clicks
           * "Privacy Policy" and lands on a blank page cannot tell whether the
           * page is broken or the policy is missing. Saying so plainly is the
           * honest answer — and inventing a policy on an operator's behalf
           * would be a legal document they never agreed to.
           */
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-brand-text-soft sm:text-base">
            This page has not been published yet. Please contact us if you need
            a copy.
          </p>
        )}
      </div>
    </article>
  );
}
