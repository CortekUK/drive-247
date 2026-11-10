import Link from 'next/link';
import { ArrowRight } from 'lucide-react-nw';

import { loadFleetSeed } from '@nw/components/fleet/fleet-seed';
import { DEFAULT_ABOUT_HERO, DEFAULT_ABOUT_STORY } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { htmlToParagraphs } from '@nw/lib/cms/html';
import { getSection } from '@nw/lib/cms/merge';
import { getTenantSlug, loadPageSections, loadSection, loadTestimonials } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { loadSiteNumbers } from '@nw/site-v2/sections/site-numbers';
import { AboutPromises, type PromiseItem } from '@nw/template-2/about-promises';
import { Template2Closing } from '@nw/template-2/closing';
import { T2Count } from '@nw/template-2/count-up';
import { t2Href } from '@nw/template-2/links';

/**
 * Template 2 ("Glass") — About (/template-2/about).
 *
 *   the opening   the operator's headline, left, beside a photograph of one
 *                 of their own cars (never a drawing; no caption, since a
 *                 photo is not always of that exact car yet). Under both, one
 *                 strip of their figures, divided by hairlines, each counting
 *                 up as it comes into view: years on the road and their
 *                 rating (`about / stats`), how many cars and the lowest
 *                 daily price (the fleet)
 *   the story     `about / about_story`, one stop a paragraph between
 *                 hairlines, the year they began and "Today" set as type
 *   the promises  `about / why_choose_us`, one at a time (`about-promises`),
 *                 shown once the operator has written them
 *   a review      the most telling one, set large, when there are any
 *   the close     the shared closing pane, in `about / final_cta`
 *
 * The rich text becomes plain paragraphs, never injected HTML.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const PAGE = 'mx-auto w-full max-w-[1320px] px-3 sm:px-5';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';
const H2 = 'text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[36px]';

const EMPTY_CTA = { title: '', description: '' };
const EMPTY_PROMISES = { title: '', subtitle: '', items: [] as { icon?: string; title?: string; description?: string }[] };

export async function Template2AboutPage() {
  const slug = await getTenantSlug();
  const [hero, story, sections, fleet, numbers, reviews] = await Promise.all([
    loadSection('about', 'hero', DEFAULT_ABOUT_HERO),
    loadSection('about', 'about_story', DEFAULT_ABOUT_STORY),
    loadPageSections('about'),
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
    loadSiteNumbers(),
    loadTestimonials(),
  ]);

  const subtitle = hero.subtitle.trim();
  const paragraphs = htmlToParagraphs(story.content);
  const since = story.founded_year?.trim();
  const cta = getSection(sections, 'final_cta', EMPTY_CTA);
  const promises = getSection(sections, 'why_choose_us', EMPTY_PROMISES);
  // Kept with their STORED index: the editor writes back by position.
  const promiseItems: PromiseItem[] = (promises.items ?? [])
    .map((item, index) => ({ index, icon: item.icon ?? '', title: (item.title ?? '').trim(), description: (item.description ?? '').trim() }))
    .filter((item) => item.title !== '');

  const cars = fleet?.vehicles ?? [];
  // The dearest car with a photo: usually the one most worth looking at.
  const photos = [...cars.filter((car) => car.photoUrl)].sort((a, b) => (b.dailyRent ?? 0) - (a.dailyRent ?? 0));
  const photo = photos[0] ?? null;
  // Beside the story, another of their cars: the cheapest, so it differs from the opening's.
  const storyPhoto = photos.length > 1 ? photos[photos.length - 1] : null;
  // The review that says most: the best rated, then the longest.
  const quote = [...(reviews ?? [])].sort((a, b) => b.stars - a.stars || b.quote.length - a.quote.length)[0] ?? null;

  return (
    <div className="space-y-3 pb-3">
      {/* ── The opening, and their figures ── */}
      <section aria-labelledby="g2-about-title" className={cn(PAGE, 'pt-[84px] sm:pt-[96px]')}>
        <div className={PANE}>
          <div className={cn('grid items-stretch gap-3', photo?.photoUrl && 'lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]')}>
            <header {...cmsSection('about.hero', 'Hero')} className="flex flex-col justify-center px-3 py-8 sm:px-6 sm:py-12 lg:py-16">
              <h1
                id="g2-about-title"
                className="max-w-[14ch] text-[40px] font-semibold leading-[1] tracking-[-0.05em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[60px] lg:text-[72px]"
              >
                <Editable path="about.hero.title">{hero.title}</Editable>
              </h1>
              {subtitle ? (
                <p className="mt-5 max-w-[32rem] text-[16px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[19px]">
                  <Editable path="about.hero.subtitle">{subtitle}</Editable>
                </p>
              ) : null}
              <Link
                href={t2Href('/fleet')}
                className={cn('g2-cta mt-8 inline-flex h-12 w-fit items-center gap-2 rounded-full px-7 text-[15px] font-semibold', FOCUS)}
              >
                See our cars
                <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
              </Link>
            </header>
            {photo?.photoUrl ? (
              <div className="g2-well g2-tray relative min-h-[260px] overflow-hidden rounded-[28px] sm:min-h-[380px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts */}
                <img src={photo.photoUrl} alt={photo.name} className="absolute inset-0 size-full object-cover" />
              </div>
            ) : null}
          </div>

          {numbers.length > 0 ? (
            <dl className="g2-well g2-tray mt-3 grid grid-cols-2 rounded-[28px] p-2 lg:grid-cols-4">
              {numbers.map((stat, index) => (
                <div
                  key={stat.key}
                  className={cn(
                    'relative flex flex-col-reverse px-4 py-5 sm:px-7 sm:py-7',
                    // Hairlines: between columns, and between the two rows on a phone.
                    index % 2 === 1 && 'before:absolute before:inset-y-6 before:left-0 before:w-px before:bg-[var(--g2-ink)]/10',
                    index % 2 === 0 && index > 0 && 'lg:before:absolute lg:before:inset-y-6 lg:before:left-0 lg:before:w-px lg:before:bg-[var(--g2-ink)]/10',
                    index >= 2 && 'max-lg:after:absolute max-lg:after:inset-x-4 max-lg:after:top-0 max-lg:after:h-px max-lg:after:bg-[var(--g2-ink)]/10',
                  )}
                >
                  <dt className="mt-2 text-[13.5px] font-medium text-[var(--g2-ink-soft)] sm:text-[14.5px]">
                    {stat.label}
                    {stat.key === 'years' && since ? <span className="block text-[12.5px] font-normal">Since {since}</span> : null}
                  </dt>
                  <dd className="text-[40px] font-semibold leading-none tracking-[-0.05em] text-[var(--g2-ink)] tabular-nums sm:text-[56px]">
                    <T2Count to={stat.to} decimals={stat.decimals} prefix={stat.prefix} suffix={stat.suffix} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {/* ── The story, along a rail ── */}
      {paragraphs.length > 0 ? (
        <section {...cmsSection('about.about_story', 'Your story')} aria-labelledby="g2-story-title" className={PAGE}>
          <div className={PANE}>
            <div
              className={cn(
                'grid gap-3 lg:gap-10',
                storyPhoto?.photoUrl ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'mx-auto max-w-[760px]',
              )}
            >
              {/* The title, over one of their cars, filling the column beside the story. */}
              <div className="flex flex-col gap-5">
                <h2 id="g2-story-title" className={cn(H2, 'px-3 pt-4 sm:px-4 sm:pt-6')}>
                  <Editable path="about.about_story.title">{story.title}</Editable>
                </h2>
                {storyPhoto?.photoUrl ? (
                  <div className="g2-well g2-tray relative min-h-[240px] flex-1 overflow-hidden rounded-[28px] sm:min-h-[320px]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts */}
                    <img src={storyPhoto.photoUrl} alt={storyPhoto.name} className="absolute inset-0 size-full object-cover" />
                  </div>
                ) : null}
              </div>
              {/* The story in stops, split by hairlines; its two dates, set as type,
                  mark where it begins and where it is now. */}
              <ol className="divide-y divide-[rgb(13_12_29/0.08)] px-3 py-2 sm:px-4 sm:py-4">
                {paragraphs.map((paragraph, index) => {
                  const first = index === 0;
                  const last = index === paragraphs.length - 1 && paragraphs.length > 1;
                  const mark = first && since ? since : last ? 'Today' : null;
                  return (
                    <li key={`${index}-${paragraph.slice(0, 24)}`} className="py-6 first:pt-2 last:pb-2 sm:py-7">
                      {mark ? (
                        <p className="mb-2.5 text-[26px] font-semibold leading-none tracking-[-0.045em] text-[var(--g2-accent-ink)] tabular-nums sm:text-[30px]">
                          {first ? <Editable path="about.about_story.founded_year">{mark}</Editable> : mark}
                        </p>
                      ) : null}
                      <p
                        className={cn(
                          first
                            ? 'text-[19px] leading-[1.5] tracking-[-0.015em] text-[var(--g2-ink)] sm:text-[23px]'
                            : 'text-[16px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px]',
                        )}
                      >
                        {paragraph}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── What they promise ── */}
      {promiseItems.length > 0 ? (
        <section {...cmsSection('about.why_choose_us', 'Why choose us')} aria-labelledby="g2-promises-title" className={PAGE}>
          <div className={PANE}>
            <header className="px-2 pb-6 pt-5 text-center sm:px-3 sm:pt-7">
              <h2 id="g2-promises-title" className={H2}>
                <Editable path="about.why_choose_us.title">{promises.title.trim() || 'Why people rent from us'}</Editable>
              </h2>
              {promises.subtitle.trim() ? (
                <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px]">
                  <Editable path="about.why_choose_us.subtitle">{promises.subtitle.trim()}</Editable>
                </p>
              ) : null}
            </header>
            <AboutPromises items={promiseItems} />
          </div>
        </section>
      ) : null}

      {/* ── One renter, in their words ── */}
      {quote ? (
        <section aria-label="A review" className={PAGE}>
          <figure className={cn(PANE, 'px-6 py-10 text-center sm:px-12 sm:py-16')}>
            <blockquote>
              <p className="mx-auto max-w-[28ch] text-[26px] font-medium leading-[1.25] tracking-[-0.03em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[40px]">
                &ldquo;{quote.quote}&rdquo;
              </p>
            </blockquote>
            <figcaption className="mt-6 text-[15px] text-[var(--g2-ink-soft)]">
              <span className="font-semibold text-[var(--g2-ink)]">{quote.author}</span>
              {quote.source ? `, ${quote.source}` : ''}
            </figcaption>
            <Link href={t2Href('/reviews')} className={cn('mt-6 inline-flex rounded text-[15px] font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}>
              Read every review
            </Link>
          </figure>
        </section>
      ) : null}

      <Template2Closing
        seed={fleet}
        flush
        title={cta.title.trim() ? <Editable path="about.final_cta.title">{cta.title.trim()}</Editable> : undefined}
        text={cta.description.trim() ? <Editable path="about.final_cta.description">{cta.description.trim()}</Editable> : undefined}
      />
    </div>
  );
}
