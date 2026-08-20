"use client";

import { STATS } from "./d7-data";
import { Icon } from "./d7-icons";
import {
  BlurFade, GridPattern, Magnetic, MagicCard, NumberTicker, Ripple, TextGenerateEffect,
} from "./d7-ui";

/**
 * "Why Choose Drive247" — copy on the left, the counted stats panel on the
 * right. The counters are the only numbers on the page that animate, so they
 * carry the section.
 */
export function WhyChoose() {
  return (
    <section id="why" className="relative scroll-mt-24 py-14 sm:py-16">
      <div className="d7-wrap grid items-center gap-10 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.9fr)]">
        {/* ------------------------------------------------------- copy */}
        <div>
          <BlurFade>
            <h2 className="d7-dis text-[clamp(1.5rem,2.1vw,1.92rem)] tracking-[-.035em] text-[var(--ink)]">
              Why Choose <span className="d7-grad-text">Drive247</span>
            </h2>
            <span aria-hidden className="mt-3 block h-[3px] w-14 rounded-full [background:var(--grad)]" />
          </BlurFade>

          <p className="d7-body mt-5 max-w-[22rem] text-[14.5px]">
            <TextGenerateEffect words="We go the extra mile to make your journey smooth, safe and memorable." />
          </p>

          <BlurFade delay={0.2}>
            <Magnetic strength={0.2}>
              <button className="d7-btn mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px]
                                 font-semibold text-white [background:var(--grad)] shadow-[var(--shadow-v)]
                                 transition hover:-translate-y-0.5">
                Learn More <Icon name="arrow" className="d7-arrow h-4 w-4" />
              </button>
            </Magnetic>
          </BlurFade>
        </div>

        {/* ------------------------------------------------------ stats */}
        <BlurFade delay={0.12} y={30}>
          <MagicCard gradientSize={340} gradientColor="rgba(109,90,240,.10)"
            className="relative overflow-hidden rounded-[var(--r-xl)] border border-[var(--line)]
                       d7-panel-bg">
            <GridPattern size={38} className="opacity-40 [mask-image:radial-gradient(420px_circle_at_30%_50%,white,transparent)]" />
            <Ripple circles={4} className="opacity-40" />

            <div className="relative grid grid-cols-2 gap-y-8 px-6 py-9 sm:px-8 lg:grid-cols-4
                            lg:divide-x lg:divide-[var(--v)]/12">
              {STATS.map((s, i) => (
                <div key={s.label} className="group flex items-center gap-3.5 lg:justify-center lg:px-2">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--white)] text-[var(--v)]
                                   shadow-[var(--shadow)] transition duration-500
                                   group-hover:[background:var(--grad)] group-hover:text-white">
                    <Icon name={s.icon} className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="d7-dis block text-[26px] leading-none text-[var(--ink)] sm:text-[30px]">
                      <NumberTicker value={s.n} delay={i * 110} />{s.suffix}
                    </span>
                    <span className="mt-1.5 block text-[12.5px] font-medium text-[var(--body)] lg:whitespace-nowrap">{s.label}</span>
                  </span>
                </div>
              ))}
            </div>
          </MagicCard>
        </BlurFade>
      </div>
    </section>
  );
}
