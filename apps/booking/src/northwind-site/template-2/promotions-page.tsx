'use client';

/**
 * Template 2 ("Glass") — Promotions (/template-2/promotions).
 *
 *   the offers   each running offer is a ticket of glass: its picture, a
 *                perforated tear (notched both sides), then the discount
 *                large, the offer's name, what it is for, and when it ends.
 *                Same data as site-v2: the `promotions` table, live, only
 *                the offers running today
 *   none running the operator's own words for it (`promotions / empty_state`)
 *                and the way on to the cars, then what renting longer saves
 *                — worked out from their own prices, so it is true whatever
 *                they are running
 *
 * The steps for using an offer (`how_it_works`) show once there are at least
 * two, and the small print (`terms`) once written; both only while an offer
 * is running, like site-v2: rules for an offer mean nothing on a page that
 * says there are none. Operator text stays editable in place.
 */

import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react-nw';

import type { FleetSeed } from '@nw/components/fleet/fleet-vehicle';
import { formatMoney } from '@nw/components/fleet/format';
import { useCmsSection } from '@nw/hooks/use-cms';
import { usePromotions } from '@nw/hooks/use-promotions';
import { DEFAULT_PROMOTIONS_EMPTY_STATE } from '@nw/lib/cms/defaults';
import { Editable } from '@nw/lib/cms/editable';
import type { PromotionsResult } from '@nw/lib/cms/queries';
import type { PageSections, PromoItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { T2Count } from '@nw/template-2/count-up';
import { t2Href } from '@nw/template-2/links';
import { PERIOD, periodTiles } from '@nw/template-2/rates';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const PAGE = 'mx-auto w-full max-w-[1320px] px-3 sm:px-5';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';

export type PromoStep = { index: number; title: string; description: string };

export function Template2PromotionsPage({
  seed,
  sections,
  fleet,
  steps,
  stepsTitle,
  stepsSubtitle,
  termsTitle,
  terms,
}: {
  seed: PromotionsResult | null;
  sections: PageSections;
  fleet: FleetSeed | null;
  steps: PromoStep[];
  stepsTitle: string;
  stepsSubtitle: string;
  termsTitle: string;
  terms: string[];
}) {
  const { items, isLoading } = usePromotions(seed);
  const { content: empty } = useCmsSection('promotions', 'empty_state', DEFAULT_PROMOTIONS_EMPTY_STATE, sections);
  const running = items.length > 0;
  const savings = periodTiles(fleet?.vehicles ?? []).filter((tile) => tile.key !== 'day' && tile.best > 0);
  const currency = fleet?.currencyCode ?? null;

  return (
    <div className="space-y-3 pb-3">
      <section aria-labelledby="g2-offers-title" className={cn(PAGE, 'pt-[84px] sm:pt-[96px]')}>
        <div className={PANE}>
          <header className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10">
            <h1
              id="g2-offers-title"
              className="text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] sm:text-[56px] lg:text-[64px]"
            >
              Offers and deals.
            </h1>
            <p className="mx-auto mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
              Our current discounts on cars, with the date each one runs until.
            </p>
          </header>

          {isLoading ? (
            <ul aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((slot) => (
                <li key={slot} className="h-[380px] animate-pulse rounded-[26px] bg-white/45 motion-reduce:animate-none" />
              ))}
            </ul>
          ) : running ? (
            <>
              <h2 className="px-2 pb-4 text-center text-[20px] font-semibold tracking-[-0.03em] text-[var(--g2-ink)] sm:px-3">
                <Editable path="promotions.empty_state.title_active">{empty.title_active}</Editable>
              </h2>
              {/* Centred, so one or two offers do not sit to one side of an empty column. */}
              <ul className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-center">
                {items.map((promo) => (
                  <Ticket key={promo.id} promo={promo} />
                ))}
              </ul>
            </>
          ) : (
            <div className="g2-well g2-tray flex flex-col items-center rounded-[30px] px-6 py-12 text-center sm:py-14">
              <p className="text-[24px] font-semibold tracking-[-0.035em] text-[var(--g2-ink)] sm:text-[30px]">
                <Editable path="promotions.empty_state.title_default">{empty.title_default}</Editable>
              </p>
              <p className="mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[16px]">
                <Editable path="promotions.empty_state.description">{empty.description}</Editable>
              </p>
              <Link
                href={t2Href('/fleet')}
                className={cn('g2-cta mt-7 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold', FOCUS)}
              >
                <Editable path="promotions.empty_state.button_text">{empty.button_text}</Editable>
                <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* With no offer running: what renting longer saves, from the operator's own prices. */}
      {!isLoading && !running && savings.length > 0 ? (
        <section aria-labelledby="g2-longer-title" className={PAGE}>
          <div className={PANE}>
            <header className="px-2 pb-5 pt-5 text-center sm:px-3 sm:pt-7">
              <h2 id="g2-longer-title" className="text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[36px]">
                Rent longer, pay less a day.
              </h2>
              <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[17px]">
                Weekly and monthly prices cost less each day than renting the same car day by day. No code needed.
              </p>
            </header>
            <ul className={cn('grid gap-3', savings.length > 1 && 'sm:grid-cols-2')}>
              {savings.map((tile) => (
                <li key={tile.key} className="g2-well g2-tray flex flex-col rounded-[28px] p-6 sm:p-7">
                  <p className="text-[14px] font-semibold text-[var(--g2-accent-ink)]">{PERIOD[tile.key].title}</p>
                  <p className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.05em] text-[var(--g2-ink)] tabular-nums sm:text-[56px]">
                    Up to <T2Count to={tile.best} suffix="%" />
                  </p>
                  <p className="mt-2 text-[15px] text-[var(--g2-ink-soft)]">less a day than renting daily</p>
                  <p className="mt-6 border-t border-[rgb(13_12_29/0.08)] pt-4 text-[14.5px] text-[var(--g2-ink-soft)]">
                    From <span className="font-semibold text-[var(--g2-ink)]">{formatMoney(tile.lowest, currency)}</span> {PERIOD[tile.key].unit}, about{' '}
                    {formatMoney(Math.round(tile.perDay), currency)} a day
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex justify-center pb-2 pt-5">
              <Link
                href={t2Href('/fleet')}
                className={cn(
                  'inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]',
                  FOCUS,
                )}
              >
                See every car&rsquo;s prices
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Using an offer, and its small print: only while one is running. */}
      {running && (steps.length >= 2 || (termsTitle !== '' && terms.length > 0)) ? (
        <section aria-label="Using an offer" className={PAGE}>
          <div className={PANE}>
            {steps.length >= 2 ? (
              <>
                <header className="px-2 pb-5 pt-5 text-center sm:px-3 sm:pt-7">
                  <h2 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[36px]">
                    <Editable path="promotions.how_it_works.title">{stepsTitle || 'How it works'}</Editable>
                  </h2>
                  {stepsSubtitle ? (
                    <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px]">
                      <Editable path="promotions.how_it_works.subtitle">{stepsSubtitle}</Editable>
                    </p>
                  ) : null}
                </header>
                <ol className={cn('grid gap-3', steps.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
                  {steps.map((step, position) => (
                    <li key={step.index} className="g2-well g2-tray flex flex-col gap-4 rounded-[28px] p-6">
                      <span className="g2-cta grid size-10 place-items-center rounded-full text-[15px] font-semibold">{position + 1}</span>
                      <div>
                        <h3 className="text-[19px] font-semibold tracking-[-0.025em] text-[var(--g2-ink)]">
                          <Editable path={`promotions.how_it_works.steps.${step.index}.title`}>{step.title}</Editable>
                        </h3>
                        {step.description ? (
                          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--g2-ink-soft)]">
                            <Editable path={`promotions.how_it_works.steps.${step.index}.description`}>{step.description}</Editable>
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}

            {termsTitle !== '' && terms.length > 0 ? (
              <div className={cn('mx-auto max-w-[44rem] px-3 pb-4', steps.length >= 2 ? 'pt-8' : 'pt-4')}>
                <h2 className="text-[15px] font-semibold text-[var(--g2-ink)]">
                  <Editable path="promotions.terms.title">{termsTitle}</Editable>
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {terms.map((term, index) => (
                    <li key={`${index}-${term.slice(0, 24)}`} className="flex gap-2.5 text-[14px] leading-relaxed text-[var(--g2-ink-soft)]">
                      <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[var(--g2-ink-soft)]/50" />
                      <span className="min-w-0 flex-1">
                        <Editable path={`promotions.terms.terms.${index}`}>{term}</Editable>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** One offer, as a ticket: the picture, a perforated tear, then the stub. */
function Ticket({ promo }: { promo: PromoItem }) {
  return (
    <li className="flex flex-col lg:w-[calc((100%-1.5rem)/3)]">
      <div className="g2-ticket-top rounded-t-[26px] bg-white/55 p-2 pb-3">
        <div className="aspect-[16/10] overflow-hidden rounded-[20px] bg-white/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image} alt={promo.imageAlt} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
      </div>
      <div className="g2-ticket-stub relative flex flex-1 flex-col rounded-b-[26px] bg-white/55 px-5 pb-5 pt-6 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className="text-[40px] font-semibold leading-none tracking-[-0.05em] text-[var(--g2-ink)]">{promo.discount}</p>
          {promo.label ? <p className="text-[15px] font-medium text-[var(--g2-ink-soft)]">{promo.label}</p> : null}
        </div>
        {promo.badge ? (
          <p className="mt-3 w-fit max-w-full truncate rounded-full bg-[color-mix(in_oklab,var(--g2-accent)_12%,#fff)] px-3 py-1 text-[13px] font-semibold text-[var(--g2-accent-ink)]">
            {promo.badge}
          </p>
        ) : null}
        {promo.caption.trim() !== '' ? <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--g2-ink-soft)]">{promo.caption}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          {promo.validUntil !== '' ? (
            <p className="flex items-center gap-1.5 text-[13.5px] text-[var(--g2-ink-soft)]">
              <CalendarClock aria-hidden className="size-4 text-[var(--g2-accent-ink)]" strokeWidth={2} />
              {promo.validUntil}
            </p>
          ) : (
            <span />
          )}
          <Link href={t2Href('/fleet')} className={cn('rounded text-[14px] font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}>
            Choose a car
          </Link>
        </div>
      </div>
    </li>
  );
}
