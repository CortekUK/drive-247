import { htmlToParagraphs } from '@nw/lib/cms/html';
import { loadSection } from '@nw/lib/cms/server';
import type { CmsPageSlug } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { CARD, PageIntro, SITE_CONTAINER } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — Privacy Policy and Terms & Conditions.
 *
 * Same source and the same safety rule as the current page
 * (`components/sections/legal-page.tsx`): the portal's rich text goes through
 * `htmlToParagraphs`, never `dangerouslySetInnerHTML`, because the portal does
 * not sanitise on write and this page is public. An unpublished policy says so
 * plainly rather than inventing one.
 *
 * The body is a single readable column (about 720px), inside a flat card.
 */

interface LegalContent {
  title: string;
  last_updated: string;
  content: string;
}

const EMPTY: LegalContent = { title: '', last_updated: '', content: '' };

/** "2026-09-08" -> "8 September 2026", and anything unparseable is dropped. */
function formatDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export async function LegalPage({
  slug,
  sectionKey,
  fallbackTitle,
}: {
  slug: Extract<CmsPageSlug, 'privacy' | 'terms'>;
  sectionKey: string;
  fallbackTitle: string;
}) {
  const legal = await loadSection(slug, sectionKey, EMPTY);

  const title = legal.title.trim() || fallbackTitle;
  const updated = formatDate(legal.last_updated);
  const paragraphs = htmlToParagraphs(legal.content);

  return (
    <article>
      <PageIntro
        className="max-w-[816px]"
        eyebrow="Legal"
        title={title}
        description={updated ? `Last updated ${updated}` : undefined}
      />
      <div className={cn(SITE_CONTAINER, 'max-w-[816px] pt-6 md:pt-8')}>
        <div className={cn(CARD, 'px-5 py-6 sm:px-8 sm:py-8')}>
          {paragraphs.length > 0 ? (
            <div className="flex flex-col gap-4">
              {paragraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 24)}`} className="text-[15px] leading-[1.75] text-pv-fg/85">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[15px] leading-relaxed text-pv-muted-fg">
              This page has not been published yet. Please contact us if you need a copy.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
