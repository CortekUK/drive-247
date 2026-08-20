"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { D7Review } from "./use-d7-content";
import { Icon } from "./d7-icons";
import {
  BlurFade, BorderBeam, Card3D, Card3DItem, CardSpotlight, MagicCard,
  Magnetic, Meteors, ShineBorder,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Promo band: the tenant's offer alongside their real reviews. */
export function OffersRow({ promo, reviews, reviewsTitle, bookCta }: {
  promo: { enabled?: boolean; discount_amount?: string; discount_label?: string; line1?: string; line2?: string };
  reviews: D7Review[];
  reviewsTitle?: string;
  bookCta: string;
}) {
  const showPromo = promo?.enabled !== false && !!promo?.discount_amount;
  if (!showPromo && reviews.length === 0) return null;

  return (
    <section id="offers" className="scroll-mt-24 py-14 sm:py-16">
      <div className={`d7-wrap grid gap-6 ${showPromo && reviews.length ? "lg:grid-cols-[1fr_1.25fr]" : ""}`}>
        {showPromo && <PromoCard promo={promo} bookCta={bookCta} />}
        {reviews.length > 0 && <Testimonials reviews={reviews} title={reviewsTitle} />}
      </div>
    </section>
  );
}

/* ========================================================================== */

function PromoCard({ promo, bookCta }: {
  promo: { discount_amount?: string; discount_label?: string; line1?: string; line2?: string };
  bookCta: string;
}) {
  return (
    <BlurFade y={34}>
      <CardSpotlight className="relative flex h-full flex-col justify-between overflow-hidden rounded-[var(--r-lg)] p-7
                                text-white [background:linear-gradient(145deg,#6d5af0_0%,#7c4df0_42%,#a855f7_100%)]
                                shadow-[0_30px_70px_-34px_rgba(109,90,240,.85)]">
        <Meteors number={10} className="opacity-60" />
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1
                           text-[11px] font-bold uppercase tracking-[.14em] backdrop-blur">
            <Icon name="gift" className="h-3.5 w-3.5" /> Limited offer
          </span>

          <p className="d7-dis mt-5 text-[clamp(2.6rem,6vw,3.6rem)] leading-[0.95] tracking-[-.04em]">
            {promo.discount_amount}
            {promo.discount_label && (
              <span className="ml-2 align-middle text-[.34em] font-extrabold uppercase tracking-[.14em] text-white/80">
                {promo.discount_label}
              </span>
            )}
          </p>

          {(promo.line1 || promo.line2) && (
            <p className="mt-3 text-[15px] leading-snug text-white/80">
              {promo.line1}{promo.line1 && promo.line2 ? " " : ""}{promo.line2}
            </p>
          )}
        </div>

        <Magnetic strength={0.18}>
          <a href="#booking"
            className="d7-btn relative mt-8 inline-flex items-center gap-2 rounded-full border border-white/35
                       bg-white/15 px-5 py-2.5 text-[13px] font-semibold text-white backdrop-blur
                       transition hover:-translate-y-0.5 hover:bg-white/25">
            {bookCta} <Icon name="arrow" className="d7-arrow h-4 w-4" />
          </a>
        </Magnetic>
      </CardSpotlight>
    </BlurFade>
  );
}

/* ========================================================================== */

function Testimonials({ reviews, title }: { reviews: D7Review[]; title?: string }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);

  /* reviews arrive asynchronously, so the wrap-around has to track their
     length — closing over the initial 0 would pin the carousel to index 0. */
  const go = useCallback((next: number, d: 1 | -1) => {
    setDir(d);
    setI((next + reviews.length) % reviews.length);
  }, [reviews.length]);

  /* Autoplay, paused whenever the tab is hidden. */
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) go(i + 1, 1);
    }, 6000);
    return () => clearInterval(id);
  }, [i, go]);

  const r = reviews[Math.min(i, reviews.length - 1)];
  if (!r) return null;

  return (
    <BlurFade y={34} delay={0.08} className="h-full">
      <div id="reviews" className="flex h-full scroll-mt-24 flex-col">
        <h2 className="d7-dis d7-h2 text-[var(--ink)]">{title || "What our customers say"}</h2>

        <MagicCard className="d7-card relative mt-5 flex-1 rounded-[var(--r-lg)] p-6">
          <Icon name="quote" className="h-8 w-8 text-[var(--v)]/25" />

          <div className="relative mt-3 min-h-[190px]">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.figure key={i}
                initial={{ opacity: 0, x: dir * 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -28 }}
                transition={{ duration: 0.4, ease: EASE }}>
                <div className="flex gap-1 text-[var(--amber)]">
                  {Array.from({ length: r.stars }, (_, s) => (
                    <Icon key={s} name="star" className="h-[15px] w-[15px] fill-current" />
                  ))}
                </div>
                <blockquote className="d7-body mt-3.5 text-[14px] text-[var(--ink-2)]">
                  &ldquo;{r.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span aria-hidden
                    className="grid h-10 w-10 place-items-center rounded-full text-[14px] font-extrabold
                               text-white [background:var(--grad)]">
                    {r.name.charAt(0)}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-bold text-[var(--ink)]">{r.name}</span>
                    {r.org && <span className="block text-[12px] text-[var(--mute)]">{r.org}</span>}
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>

          {/* controls */}
          <div className="mt-5 flex items-center justify-between">
            <div className="flex gap-1.5" role="tablist" aria-label="Choose a review">
              {reviews.map((_, n) => (
                <button key={n} onClick={() => go(n, n > i ? 1 : -1)}
                  aria-label={`Review ${n + 1}`} aria-selected={n === i} role="tab"
                  className={`h-1.5 rounded-full transition-all duration-500
                              ${n === i ? "w-6 [background:var(--grad)]" : "w-1.5 bg-[var(--line)] hover:bg-[var(--mute)]"}`} />
              ))}
            </div>
            <div className="flex gap-2">
              <ArrowButton dir="left"  onClick={() => go(i - 1, -1)} />
              <ArrowButton dir="right" onClick={() => go(i + 1, 1)} />
            </div>
          </div>

          <BorderBeam duration={14} size={90} radius={22} className="opacity-45" />
        </MagicCard>
      </div>
    </BlurFade>
  );
}

function ArrowButton({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={dir === "left" ? "Previous review" : "Next review"}
      className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--white)] text-[var(--ink)]
                 transition hover:-translate-y-0.5 hover:border-[var(--v)]/45 hover:text-[var(--v)]">
      <Icon name={dir} className="h-4 w-4" />
    </button>
  );
}

