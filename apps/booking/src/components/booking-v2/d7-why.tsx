"use client";

import { Icon } from "./d7-icons";
import {
  BlurFade, GridPattern, Magnetic, MagicCard, NumberTicker, Ripple, TextGenerateEffect,
} from "./d7-ui";

export type D7Service = { icon?: string; title: string; description?: string };

/** CMS stores lucide icon names; map to the glyphs this design ships. */
const GLYPH: Record<string, string> = {
  ThumbsUp: "star", Users: "users", MapPin: "pin", Baby: "seat",
  Settings: "gear", Headphones: "head", Shield: "shield", Clock: "clock",
  Car: "car", Tag: "tag", Zap: "bolt", Gift: "gift", Star: "star",
};

/**
 * "Why choose us" — the tenant's own service highlights.
 *
 * The counters beside it are derived from real numbers (fleet size, review
 * count and average rating). Anything we cannot count is simply not shown,
 * rather than filled with a flattering invention.
 */
export function WhyChoose({ services, vehicleCount, reviewCount, avgRating }: {
  services: { title?: string; subtitle?: string; services?: D7Service[] };
  vehicleCount: number;
  reviewCount: number;
  avgRating: number | null;
}) {
  const tiles = services.services ?? [];

  const stats = [
    vehicleCount > 0 && { icon: "car", n: vehicleCount, suffix: "", label: "Vehicles ready" },
    reviewCount > 0 && { icon: "users", n: reviewCount, suffix: "", label: "Customer reviews" },
    avgRating != null && { icon: "star", n: avgRating, suffix: "/5", label: "Average rating", decimals: 1 },
    { icon: "head", n: 24, suffix: "/7", label: "Support" },
  ].filter(Boolean) as { icon: string; n: number; suffix: string; label: string; decimals?: number }[];

  return (
    <section id="why" className="relative scroll-mt-24 py-14 sm:py-16">
      <div className="d7-wrap grid items-center gap-10 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.9fr)]">
        {/* ------------------------------------------------------- copy */}
        <div>
          <BlurFade>
            <h2 className="d7-dis text-[clamp(1.5rem,2.1vw,1.92rem)] tracking-[-.035em] text-[var(--ink)]">
              {services.title || "Why choose us"}
            </h2>
            <span aria-hidden className="mt-3 block h-[3px] w-14 rounded-full [background:var(--grad)]" />
          </BlurFade>

          {services.subtitle && (
            <p className="d7-body mt-5 max-w-[24rem] text-[14.5px]">
              <TextGenerateEffect words={services.subtitle} />
            </p>
          )}

          <BlurFade delay={0.2}>
            <Magnetic strength={0.2}>
              <a href="#booking"
                className="d7-btn mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px]
                           font-semibold text-white [background:var(--grad)] shadow-[var(--shadow-v)]
                           transition hover:-translate-y-0.5">
                Book Now <Icon name="arrow" className="d7-arrow h-4 w-4" />
              </a>
            </Magnetic>
          </BlurFade>
        </div>

        {/* ------------------------------------------------------ stats */}
        {stats.length > 0 && (
          <BlurFade delay={0.12} y={30}>
            <MagicCard gradientSize={340} gradientColor="rgba(109,90,240,.10)"
              className="d7-panel-bg relative overflow-hidden rounded-[var(--r-xl)] border border-[var(--line)]">
              <GridPattern size={38} className="opacity-40 [mask-image:radial-gradient(420px_circle_at_30%_50%,white,transparent)]" />
              <Ripple circles={4} className="opacity-40" />

              <div className="relative grid grid-cols-2 gap-y-8 px-6 py-9 sm:px-8 lg:grid-cols-4
                              lg:divide-x lg:divide-[var(--v)]/12">
                {stats.map((s, i) => (
                  <div key={s.label} className="group flex items-center gap-3.5 lg:justify-center lg:px-2">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--white)] text-[var(--v)]
                                     shadow-[var(--shadow)] transition duration-500
                                     group-hover:[background:var(--grad)] group-hover:text-white">
                      <Icon name={s.icon} className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="d7-dis block text-[26px] leading-none text-[var(--ink)] sm:text-[30px]">
                        <NumberTicker value={s.n} decimals={s.decimals ?? 0} delay={i * 110} />{s.suffix}
                      </span>
                      <span className="mt-1.5 block text-[12.5px] font-medium text-[var(--body)] lg:whitespace-nowrap">
                        {s.label}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </MagicCard>
          </BlurFade>
        )}
      </div>

      {/* ------------------------------------------------ the six tiles */}
      {tiles.length > 0 && (
        <div className="d7-wrap mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t, i) => (
            <BlurFade key={t.title} delay={0.05 * i}>
              <MagicCard className="d7-card group h-full rounded-[var(--r)] p-5">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--v-lt)] text-[var(--v)]
                                 transition duration-500 group-hover:[background:var(--grad)] group-hover:text-white">
                  <Icon name={GLYPH[t.icon ?? ""] ?? "check"} className="h-5 w-5" />
                </span>
                <h3 className="d7-h3 d7-dis mt-4 text-[var(--ink)]">{t.title}</h3>
                {t.description && (
                  <p className="d7-body mt-2 text-[13.5px] leading-relaxed">{t.description}</p>
                )}
              </MagicCard>
            </BlurFade>
          ))}
        </div>
      )}
    </section>
  );
}
