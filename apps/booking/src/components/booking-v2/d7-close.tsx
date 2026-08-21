"use client";

import { motion } from "framer-motion";
import { CONTACT, CTA_SHOT, FOOTER_LINKS } from "./d7-data";
import { Icon, Logo, Social } from "./d7-icons";
import { GsapParallax } from "./d7-motion";
import {
  BlurFade, DotPattern, Magnetic, Meteors, Particles, ShimmerButton, WordsPullUp,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;
const SOCIALS = ["facebook", "instagram", "x", "linkedin", "youtube"];

/* ========================================================================== */

/** Closing call to action — the page's one full-bleed dark moment. */
export function CtaBand() {
  return (
    <section className="d7-wrap pb-16 pt-6 sm:pb-20">
      <BlurFade y={40}>
        <div className="relative isolate overflow-hidden rounded-[var(--r-xl)] px-7 py-12 sm:px-12 sm:py-14
                        [background:linear-gradient(115deg,#161042_0%,#3b1f96_46%,#7c3aed_100%)]
                        shadow-[0_40px_90px_-40px_rgba(60,30,140,.8)]">
          <Meteors number={16} />
          <Particles quantity={40} color="#c4b5fd" className="opacity-60" />
          <span aria-hidden className="pointer-events-none absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[#6d5af0]/45 blur-[80px]" />

          <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,.9fr)]">
            <div>
              <h2 className="d7-dis text-[clamp(1.9rem,3.6vw,2.9rem)] text-white">
                <WordsPullUp words={["Ready", "to", "Hit", "the", "Road?"]} />
              </h2>
              <p className="mt-3 max-w-[30rem] text-[15px] leading-relaxed text-white/70">
                Book now and enjoy a premium rental experience.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Magnetic strength={0.22}>
                  <ShimmerButton className="d7-btn px-7 py-3.5">
                    Book Now <Icon name="arrow" className="d7-arrow h-4 w-4" />
                  </ShimmerButton>
                </Magnetic>
                <Magnetic strength={0.18}>
                  <button className="d7-btn inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5
                                     text-[14.5px] font-semibold text-[var(--ink-fixed)] shadow-[0_16px_34px_-20px_rgba(0,0,0,.9)]
                                     transition hover:-translate-y-0.5">
                    Explore Fleet <Icon name="car" className="h-[18px] w-[18px] text-[var(--v-fixed)]" />
                  </button>
                </Magnetic>
              </div>
            </div>

            {/* the car, drifting slightly against the scroll */}
            <GsapParallax speed={0.28} className="relative">
              <motion.div
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 1, ease: EASE }}
                className="relative overflow-hidden rounded-[20px] border border-white/15
                           shadow-[0_36px_70px_-38px_rgba(0,0,0,.95)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CTA_SHOT} alt="Black Honda Accord at dusk"
                  className="aspect-[16/10] w-full object-cover" loading="lazy" decoding="async" />
                <span aria-hidden className="absolute inset-0 bg-[linear-gradient(120deg,rgba(109,90,240,.42),transparent_52%,rgba(217,70,239,.34))] mix-blend-screen" />
              </motion.div>
              <span aria-hidden className="d7-trail left-[8%] top-[74%] w-[42%]" />
            </GsapParallax>
          </div>
        </div>
      </BlurFade>
    </section>
  );
}

/* ========================================================================== */

export function Footer() {
  return (
    <footer id="contact" className="relative scroll-mt-24 overflow-hidden bg-[var(--footer)] text-white">
      <DotPattern size={26} className="fill-white/[.07] [mask-image:radial-gradient(700px_circle_at_20%_0%,white,transparent)]" />

      <div className="d7-wrap relative grid gap-10 py-14 lg:grid-cols-[1.35fr_repeat(3,.85fr)_1.1fr]">
        {/* brand */}
        <BlurFade>
          <Logo light />
          <p className="mt-4 max-w-[19rem] text-[13.5px] leading-relaxed text-white/55">
            Premium car rentals with transparent pricing and exceptional service.
          </p>
          <div className="mt-6 flex gap-2.5">
            {SOCIALS.map(s => (
              <a key={s} href="#contact" aria-label={s}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[.06]
                           text-white/70 transition hover:-translate-y-0.5 hover:border-transparent
                           hover:[background:var(--grad)] hover:text-white">
                <Social name={s} />
              </a>
            ))}
          </div>
        </BlurFade>

        {/* link columns */}
        {FOOTER_LINKS.map((col, i) => (
          <BlurFade key={col.head} delay={0.06 * (i + 1)}>
            <h3 className="text-[14px] font-bold text-white">{col.head}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.items.map(item => (
                <li key={item}>
                  <a href="#contact"
                    className="group relative inline-flex items-center text-[13px] text-white/55
                               transition-[color,padding] duration-300 hover:pl-5 hover:text-white">
                    <span aria-hidden
                      className="absolute left-0 h-px w-0 bg-[var(--v-3)] transition-all duration-300 group-hover:w-3.5" />
                    {item}
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
            {CONTACT.map(c => (
              <li key={c.value} className="group flex items-start gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[.07]
                                 text-white/70 transition group-hover:[background:var(--grad)] group-hover:text-white">
                  <Icon name={c.icon} className="h-[15px] w-[15px]" />
                </span>
                <span>
                  <span className="block text-[10.5px] uppercase tracking-[.12em] text-white/35">{c.label}</span>
                  <span className="block text-[13px] text-white/75">{c.value}</span>
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
            © {new Date().getFullYear()} Drive247. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {["Privacy Policy", "Terms of Service", "SMS Terms"].map(l => (
              <a key={l} href="#contact" className="text-[12.5px] text-white/40 transition hover:text-white">{l}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
