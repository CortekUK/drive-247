"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { OFFERS, POSTS, REVIEWS } from "./d7-data";
import { Icon } from "./d7-icons";
import {
  BlurFade, BorderBeam, Card3D, Card3DItem, CardSpotlight, MagicCard,
  Magnetic, Meteors, ShineBorder,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;

/** The three-up band: offers, a testimonial and the journal. */
export function OffersRow() {
  return (
    <section id="offers" className="scroll-mt-24 py-14 sm:py-16">
      <div className="d7-wrap grid gap-6 lg:grid-cols-[1.14fr_.8fr_1.12fr]">
        <ExclusiveOffers />
        <Testimonials />
        <Journal />
      </div>
    </section>
  );
}

/* ========================================================================== */

function ExclusiveOffers() {
  return (
    <BlurFade y={34}>
      <CardSpotlight className="relative flex h-full flex-col overflow-hidden rounded-[var(--r-lg)] p-6
                                text-white [background:linear-gradient(145deg,#6d5af0_0%,#7c4df0_42%,#a855f7_100%)]
                                shadow-[0_30px_70px_-34px_rgba(109,90,240,.85)]">
        <Meteors number={10} className="opacity-60" />
        {/* soft light pooling in the top-right corner */}
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />

        <div className="relative">
          <h2 className="d7-dis text-[24px] tracking-[-.03em]">Exclusive Offers</h2>
          <p className="mt-1.5 text-[13px] text-white/75">Grab the best deals on premium car rentals</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {OFFERS.map((o, i) => (
              <motion.div key={o.code}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.09, duration: 0.6, ease: EASE }}
                whileHover={{ y: -5 }}
                className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/[.13] p-3
                           backdrop-blur-[2px] transition-colors hover:bg-white/[.2]">
                <ShineBorder duration={11} className="opacity-70" />
                <Icon name={o.icon} className="h-[22px] w-[22px] text-white/90" />
                <p className="mt-3 text-[12.5px] font-semibold text-white/85">{o.title}</p>
                <p className="d7-dis mt-1 text-[15px] leading-tight tracking-[-.02em]">{o.amount}</p>
                <p className="mt-1 text-[11px] leading-snug text-white/65">{o.sub}</p>
                <p className="mt-3 text-[9.5px] uppercase tracking-[.12em] text-white/55">Code</p>
                <p className="text-[11px] font-extrabold tracking-[.02em]">{o.code}</p>
              </motion.div>
            ))}
          </div>

          <Magnetic strength={0.18}>
            <button className="d7-btn mt-6 inline-flex items-center gap-2 rounded-full border border-white/35
                               bg-white/15 px-5 py-2.5 text-[13px] font-semibold text-white backdrop-blur
                               transition hover:-translate-y-0.5 hover:bg-white/25">
              View All Offers <Icon name="arrow" className="d7-arrow h-4 w-4" />
            </button>
          </Magnetic>
        </div>
      </CardSpotlight>
    </BlurFade>
  );
}

/* ========================================================================== */

function Testimonials() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);

  const go = useCallback((next: number, d: 1 | -1) => {
    setDir(d);
    setI((next + REVIEWS.length) % REVIEWS.length);
  }, []);

  /* Autoplay, paused whenever the tab is hidden. */
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) go(i + 1, 1);
    }, 6000);
    return () => clearInterval(id);
  }, [i, go]);

  const r = REVIEWS[i];

  return (
    <BlurFade y={34} delay={0.08} className="h-full">
      <div id="reviews" className="flex h-full scroll-mt-24 flex-col">
        <h2 className="d7-dis d7-h2 text-[var(--ink)]">What Our Customers Say</h2>

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
                    <span className="block text-[12px] text-[var(--mute)]">{r.city}</span>
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>

          {/* controls */}
          <div className="mt-5 flex items-center justify-between">
            <div className="flex gap-1.5" role="tablist" aria-label="Choose a review">
              {REVIEWS.map((_, n) => (
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

/* ========================================================================== */

function Journal() {
  return (
    <BlurFade y={34} delay={0.16} className="h-full">
      <div className="flex h-full flex-col">
        <h2 className="d7-dis d7-h2 text-[var(--ink)]">Latest From Drive247</h2>
        <p className="mt-1.5 text-[13px] text-[var(--body)]">Tips, guides and updates for smart travelers</p>

        <div className="mt-5 grid flex-1 gap-4 sm:grid-cols-2">
          {POSTS.map((post, i) => (
            <Card3D key={post.title} max={7} className="h-full">
              <article className="d7-card group relative h-full min-h-[210px] overflow-hidden rounded-[var(--r-lg)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.img} alt=""
                  className="d7-zoom absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
                <span aria-hidden
                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,16,32,.18)_0%,rgba(11,16,32,.62)_58%,rgba(11,16,32,.88)_100%)]" />
                <span aria-hidden className="d7-sheen absolute inset-0" />

                <Card3DItem z={34} className="relative flex h-full flex-col justify-between p-4">
                  <span className="w-fit rounded-full bg-white/90 px-2.5 py-1 text-[10.5px] font-extrabold
                                   uppercase tracking-[.1em] text-[var(--v-fixed)] backdrop-blur">
                    {post.tag}
                  </span>
                  <span>
                    <h3 className="d7-dis text-[15.5px] leading-snug text-white">{post.title}</h3>
                    <span className="mt-1 block text-[11px] text-white/60">{post.read}</span>
                    <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2
                                     text-[12px] font-bold text-[var(--ink-fixed)] transition
                                     group-hover:[background:var(--grad)] group-hover:text-white">
                      Read More
                      <Icon name="arrow" className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                    </span>
                  </span>
                </Card3DItem>

                <BorderBeam duration={8} delay={i * 1.4} size={80} radius={22}
                  className="opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              </article>
            </Card3D>
          ))}
        </div>

        <a href="#offers" className="d7-link group mx-auto mt-5 flex w-fit items-center gap-1.5 text-[13.5px]
                                     font-semibold text-[var(--v)]">
          View All Articles
          <Icon name="arrow" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </a>
      </div>
    </BlurFade>
  );
}
