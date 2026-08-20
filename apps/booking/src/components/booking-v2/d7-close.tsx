"use client";

import { motion } from "framer-motion";
import { LEGAL_LINKS } from "./d7-data";
import { Icon, Logo, Social } from "./d7-icons";
import { GsapParallax } from "./d7-motion";
import {
  BlurFade, DotPattern, Magnetic, Meteors, Particles, ShimmerButton, WordsPullUp,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ========================================================================== */

/** Closing call to action — the tenant's own `home_cta` block. */
export function CtaBand({ cta, image, bookCta }: {
  cta: { title?: string; description?: string; primary_cta_text?: string; secondary_cta_text?: string; trust_points?: string[] };
  image: string | null;
  bookCta: string;
}) {
  const title = cta.title || "Ready to book your rental?";

  return (
    <section className="d7-wrap pb-16 pt-6 sm:pb-20">
      <BlurFade y={40}>
        <div className="relative isolate overflow-hidden rounded-[var(--r-xl)] px-7 py-12 sm:px-12 sm:py-14
                        [background:linear-gradient(115deg,#161042_0%,#3b1f96_46%,#7c3aed_100%)]
                        shadow-[0_40px_90px_-40px_rgba(60,30,140,.8)]">
          <Meteors number={16} />
          <Particles quantity={40} color="#c4b5fd" className="opacity-60" />
          <span aria-hidden className="pointer-events-none absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[#6d5af0]/45 blur-[80px]" />

          <div className={`relative grid items-center gap-8 ${image ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,.9fr)]" : ""}`}>
            <div>
              <h2 className="d7-dis text-[clamp(1.9rem,3.6vw,2.9rem)] text-white">
                <WordsPullUp words={title.split(/\s+/)} />
              </h2>
              {cta.description && (
                <p className="mt-3 max-w-[34rem] text-[15px] leading-relaxed text-white/70">{cta.description}</p>
              )}

              {!!cta.trust_points?.length && (
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {cta.trust_points.map(p => (
                    <span key={p} className="flex items-center gap-1.5 text-[13px] text-white/70">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#c4b5fd]" />{p}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Magnetic strength={0.22}>
                  <a href="#booking">
                    <ShimmerButton className="d7-btn px-7 py-3.5">
                      {cta.primary_cta_text || bookCta} <Icon name="arrow" className="d7-arrow h-4 w-4" />
                    </ShimmerButton>
                  </a>
                </Magnetic>
                <Magnetic strength={0.18}>
                  <a href="/contact"
                    className="d7-btn inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5
                               text-[14.5px] font-semibold text-[var(--ink-fixed)] shadow-[0_16px_34px_-20px_rgba(0,0,0,.9)]
                               transition hover:-translate-y-0.5">
                    {cta.secondary_cta_text || "Get in touch"}
                    <Icon name="chat" className="h-[18px] w-[18px] text-[var(--v-fixed)]" />
                  </a>
                </Magnetic>
              </div>
            </div>

            {image && (
              <GsapParallax speed={0.28} className="relative">
                <motion.div
                  initial={{ opacity: 0, x: 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, ease: EASE }}
                  className="relative overflow-hidden rounded-[20px] border border-white/15
                             shadow-[0_36px_70px_-38px_rgba(0,0,0,.95)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="aspect-[16/10] w-full object-cover" loading="lazy" decoding="async" />
                  <span aria-hidden className="absolute inset-0 bg-[linear-gradient(120deg,rgba(109,90,240,.42),transparent_52%,rgba(217,70,239,.34))] mix-blend-screen" />
                </motion.div>
              </GsapParallax>
            )}
          </div>
        </div>
      </BlurFade>
    </section>
  );
}

/* ========================================================================== */

export function Footer({ appName, logoUrl, blurb, contact, socials, columns }: {
  appName: string;
  logoUrl: string | null;
  blurb?: string;
  contact: { icon: string; label: string; value: string; href?: string }[];
  socials: { name: string; href: string }[];
  columns: { head: string; items: { label: string; href: string }[] }[];
}) {
  return (
    <footer id="contact" className="relative scroll-mt-24 overflow-hidden bg-[var(--footer)] text-white">
      <DotPattern size={26} className="fill-white/[.07] [mask-image:radial-gradient(700px_circle_at_20%_0%,white,transparent)]" />

      <div className="d7-wrap relative grid gap-10 py-14 lg:grid-cols-[1.35fr_repeat(3,.85fr)_1.1fr]">
        {/* brand */}
        <BlurFade>
          <Logo light name={appName} logoUrl={logoUrl} />
          {blurb && (
            <p className="mt-4 max-w-[19rem] text-[13.5px] leading-relaxed text-white/55">{blurb}</p>
          )}
          <div className="mt-6 flex gap-2.5">
            {socials.map(s => (
              <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.name}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[.06]
                           text-white/70 transition hover:-translate-y-0.5 hover:border-transparent
                           hover:[background:var(--grad)] hover:text-white">
                <Social name={s.name} />
              </a>
            ))}
          </div>
        </BlurFade>

        {/* link columns */}
        {columns.map((col, i) => (
          <BlurFade key={col.head} delay={0.06 * (i + 1)}>
            <h3 className="text-[14px] font-bold text-white">{col.head}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.items.map(item => (
                <li key={item.label}>
                  <a href={item.href}
                    className="group relative inline-flex items-center text-[13px] text-white/55
                               transition-[color,padding] duration-300 hover:pl-5 hover:text-white">
                    <span aria-hidden
                      className="absolute left-0 h-px w-0 bg-[var(--v-3)] transition-all duration-300 group-hover:w-3.5" />
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </BlurFade>
        ))}

        {/* contact */}
        <BlurFade delay={0.26}>
          <h3 className="text-[14px] font-bold text-white">Contact</h3>
          <ul className="mt-4 space-y-3.5">
            {contact.map(c => (
              <li key={c.value} className="group flex items-start gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[.07]
                                 text-white/70 transition group-hover:[background:var(--grad)] group-hover:text-white">
                  <Icon name={c.icon} className="h-[15px] w-[15px]" />
                </span>
                <span>
                  <span className="block text-[10.5px] uppercase tracking-[.12em] text-white/35">{c.label}</span>
                  {c.href
                    ? <a href={c.href} className="block text-[13px] text-white/75 transition hover:text-white">{c.value}</a>
                    : <span className="block text-[13px] text-white/75">{c.value}</span>}
                </span>
              </li>
            ))}
          </ul>
        </BlurFade>
      </div>

      {/* bottom bar */}
      <div className="relative border-t border-white/[.08]">
        <div className="d7-wrap flex flex-wrap items-center justify-between gap-3 py-5">
          <p className="text-[12.5px] text-white/40">
            © {new Date().getFullYear()} {appName}. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL_LINKS.map(l => (
              <a key={l.label} href={l.href} className="text-[12.5px] text-white/40 transition hover:text-white">{l.label}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
