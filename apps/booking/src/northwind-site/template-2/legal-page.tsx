import Link from 'next/link';

import { htmlToParagraphs } from '@nw/lib/cms/html';
import { loadSection } from '@nw/lib/cms/server';
import type { CmsPageSlug } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { t2Href } from '@nw/template-2/links';

/**
 * Template 2 ("Glass") — Privacy Policy and Terms & Conditions.
 *
 * The policy is set on a sheet: one near-white pane inside the glass, a
 * single readable column (720px), like the printed page it stands for, with
 * the way to ask about it at the foot.
 *
 * Same source and safety rule as site-v2 (`site-v2/sections/legal-page.tsx`):
 * the portal's rich text goes through `htmlToParagraphs`, never injected
 * HTML, because the portal does not sanitise on write and this page is
 * public. An unpublished policy says so plainly rather than inventing one.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

interface LegalContent {
  title: string;
  last_updated: string;
  content: string;
}

const EMPTY: LegalContent = { title: '', last_updated: '', content: '' };

/** "2026-09-08" gives "8 September 2026"; anything unparseable is dropped. */
function formatDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export async function Template2LegalPage({
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
    <div className="pb-3">
      <article aria-labelledby="g2-legal-title" className="mx-auto w-full max-w-[1320px] px-3 pt-[84px] sm:px-5 sm:pt-[96px]">
        <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]">
          <header className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10">
            <h1
              id="g2-legal-title"
              className="mx-auto max-w-[18ch] text-[36px] font-semibold leading-[1.04] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[52px] lg:text-[60px]"
            >
              {title}
            </h1>
            {updated ? <p className="mt-3 text-[15px] text-[var(--g2-ink-soft)] sm:text-[16px]">Last updated {updated}</p> : null}
          </header>

          <div className="rounded-[26px] bg-white/80 px-5 py-8 shadow-[inset_0_1px_0_#fff,0_18px_40px_-30px_rgb(13_12_29/0.45)] sm:px-10 sm:py-12">
            <div className="mx-auto max-w-[720px]">
              {paragraphs.length > 0 ? (
                <div className="flex flex-col gap-5">
                  {paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 24)}`} className="text-[16px] leading-[1.8] text-[var(--g2-ink)]/85 [overflow-wrap:anywhere]">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[16px] leading-relaxed text-[var(--g2-ink-soft)]">
                  This page has not been published yet. Contact us if you need a copy.
                </p>
              )}
              <p className="mt-12 border-t border-[rgb(13_12_29/0.08)] pt-6 text-[14.5px] text-[var(--g2-ink-soft)]">
                Questions about this page?{' '}
                <Link href={t2Href('/contact')} className={cn('rounded font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}>
                  Contact us
                </Link>
              </p>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
