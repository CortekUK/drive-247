"use client";

import { motion } from "framer-motion";
import { Icon, Skyline } from "./d7-icons";
import {
  AnimatedShinyText, AuroraBackground, BlurFade, BorderBeam, HoverBorderGradient,
  Magnetic, Meteors, Particles, ShimmerButton, WordsPullUp,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;

export type HeroContent = {
  headline?: string;
  subheading?: string;
  bookCta: string;
  phoneCta?: string;
  phone: string | null;
  trustPoints: string[];
  still: string | null;
};

/** Icons cycled through the hero trust badges — the CMS trust line is plain text. */
const BADGE_ICONS = ["shield", "check", "head", "star", "bolt"];

/* ========================================================================== */

export function Hero({ content, appName, services, promo }: {
  content: HeroContent;
  appName: string;
  services: { icon?: string; title: string; description?: string }[];
  /* The eyebrow pill carries the tenant's live offer. Repeating the brand name
     there would just echo the logo two inches to its left. */
  promo?: { enabled?: boolean; discount_amount?: string; discount_label?: string; line1?: string; line2?: string };
}) {
  const promoText = promo?.enabled !== false && promo?.discount_amount
    ? [promo.discount_amount, promo.discount_label, promo.line1, promo.line2].filter(Boolean).join(" ")
    : null;
  /* The headline is authored as one string; split it so the last two words can
     carry the gradient, which is what gives the design its emphasis. */
  const words = (content.headline || "").trim().split(/\s+/).filter(Boolean);
  const split = Math.max(1, words.length - 2);
  const lead = words.slice(0, split);
  const tail = words.slice(split);

  return (
    <section id="top" className="relative isolate overflow-hidden pt-[74px]">
      {/* ---------------------------------------------------------- sky */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="d7-sky absolute inset-0" />
        <AuroraBackground className="absolute inset-0" />
        <Particles quantity={54} color="#8b5cf6" className="opacity-70" />
        <Meteors number={12} className="opacity-40" />
        <div className="d7-blob absolute -left-[12%] top-[6%] h-[46vh] w-[46vh] rounded-full bg-[#7dd3fc]/35 blur-[90px]" />
        <div className="d7-blob absolute right-[4%] top-[2%] h-[52vh] w-[52vh] rounded-full bg-[#c4b5fd]/45 blur-[100px]"
          style={{ animationDelay: "-7s" }} />
        <div className="d7-blob absolute left-[38%] top-[38%] h-[34vh] w-[34vh] rounded-full bg-[#fbcfe8]/40 blur-[90px]"
          style={{ animationDelay: "-12s" }} />
        <Skyline className="absolute inset-x-0 bottom-[30%] h-[34%] w-full opacity-45" />
        <div className="d7-sky-fade absolute inset-x-0 bottom-0 h-[52%]" />
      </div>

      <div className="d7-wrap grid items-center gap-10 pb-4 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:pt-14">
        {/* ------------------------------------------------------- copy */}
        <div className="relative z-10">
          {promoText && (
            <BlurFade delay={0.05}>
              <a href="#booking"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--glass)] px-3.5 py-1.5
                           shadow-[0_6px_20px_-14px_rgba(23,16,72,.5)] backdrop-blur transition hover:-translate-y-0.5">
                <Icon name="gift" className="h-[15px] w-[15px] text-[var(--v)]" />
                <AnimatedShinyText className="d7-eyebrow">{promoText}</AnimatedShinyText>
              </a>
            </BlurFade>
          )}

          <h1 className={`d7-dis d7-hero text-[var(--ink)] ${promoText ? "mt-6" : ""}`}>
            <WordsPullUp words={lead} delay={0.14} />
            {tail.length > 0 && (
              <>
                <br />
                <WordsPullUp
                  words={tail.map((w, i) => (
                    <span key={i} className="d7-grad-text">{w}</span>
                  ))}
                  delay={0.3} />
              </>
            )}
          </h1>

          {content.subheading && (
            <motion.p
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
              className="d7-body mt-6 max-w-[30rem]">
              {content.subheading}
            </motion.p>
          )}

          {/* trust badges — straight from the CMS trust line */}
          {content.trustPoints.length > 0 && (
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              {content.trustPoints.map((label, i) => (
                <motion.span key={label}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.68 + i * 0.09, duration: 0.6, ease: EASE }}
                  className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ink-2)]">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--white)] text-[var(--v)]
                                   shadow-[0_6px_16px_-10px_rgba(23,16,72,.6)]">
                    <Icon name={BADGE_ICONS[i % BADGE_ICONS.length]} className="h-[15px] w-[15px]" />
                  </span>
                  {label}
                </motion.span>
              ))}
            </div>
          )}

          {/* CTAs — both land in the real booking flow / the tenant's phone */}
          <motion.div
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.95, duration: 0.7, ease: EASE }}
            className="mt-9 flex flex-wrap items-center gap-3.5">
            <Magnetic strength={0.22}>
              <ShimmerButton className="d7-btn px-7 py-3.5"
                onClick={() => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" })}>
                {content.bookCta} <Icon name="arrow" className="d7-arrow h-4 w-4" />
              </ShimmerButton>
            </Magnetic>
            {content.phone && (
              <Magnetic strength={0.18}>
                <a href={`tel:${content.phone.replace(/[^+\d]/g, "")}`}>
                  <HoverBorderGradient className="flex items-center gap-2 px-6 py-3">
                    {content.phoneCta || "Call us"}
                    <Icon name="phone" className="h-[17px] w-[17px] text-[var(--v)]" />
                  </HoverBorderGradient>
                </a>
              </Magnetic>
            )}
          </motion.div>
        </div>

        {/* -------------------------------------------------------- art */}
        {content.still && (
          <div className="relative">
            <motion.div
              initial={{ opacity: 0, x: 70, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 0.2, duration: 1.15, ease: EASE }}
              className="relative">
              <div aria-hidden className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_45%,rgba(139,92,246,.35),transparent_72%)] blur-2xl" />

              <div className="d7-hover relative">
                <div className="relative overflow-hidden rounded-[26px] border border-[var(--line)] shadow-[0_50px_90px_-46px_rgba(23,16,72,.7)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={content.still} alt={`${appName} rental vehicle`}
                    className="aspect-[16/10] w-full object-cover" fetchPriority="high" decoding="async" />
                  <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(109,90,240,.20),transparent_46%,rgba(168,85,247,.18))]" />
                  <BorderBeam duration={9} size={110} radius={26} />
                </div>

                <span aria-hidden className="d7-trail left-[6%] top-[62%] w-[38%]" />
                <span aria-hidden className="d7-trail left-[14%] top-[72%] w-[26%]" style={{ animationDelay: "1.4s" }} />
              </div>
            </motion.div>
          </div>
        )}
      </div>

      <BookingTeaser bookCta={content.bookCta} />
      <TrustStrip services={services} />
    </section>
  );
}

/* ========================================================================== */
/* BOOKING TEASER                                                             */
/* ========================================================================== */

const TABS = [
  { id: "where", label: "Pick-up & Return", icon: "car" },
  { id: "when",  label: "Dates & Time",     icon: "cal" },
  { id: "what",  label: "Vehicle Type",     icon: "sliders" },
] as const;

const FIELDS = [
  { label: "Pick-up Location", value: "Choose a location", icon: "pin" },
  { label: "Return Location",  value: "Same as pick-up",   icon: "pin" },
  { label: "Pick-up Date",     value: "Select date",       icon: "cal" },
  { label: "Return Date",      value: "Select date",       icon: "cal" },
];

/**
 * The panel that overlaps the hero.
 *
 * It deliberately collects NOTHING. The real form lives in `#booking`, and a
 * second set of location/date inputs up here would either duplicate that
 * widget's validation and availability rules, or quietly throw the customer's
 * input away when they scrolled down — which is worse than not asking. So the
 * whole panel is one large control that takes you to the real form.
 */
function BookingTeaser({ bookCta }: { bookCta: string }) {
  const go = () => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });

  return (
    <BlurFade delay={0.35} y={40} className="relative z-20 mt-10">
      <div className="d7-wrap">
        <div className="d7-float relative overflow-hidden">
          <BorderBeam duration={12} size={140} radius={22} className="opacity-70" />

          <div className="flex overflow-x-auto border-b border-[var(--line)] d7-noscroll">
            {TABS.map((t, i) => (
              <span key={t.id}
                className={`relative flex shrink-0 items-center gap-2 px-6 py-4 text-[13.5px] font-semibold
                            ${i === 0 ? "text-[var(--v)]" : "text-[var(--body)]"}`}>
                <Icon name={t.icon} className="h-[17px] w-[17px]" />
                {t.label}
                {i === 0 && (
                  <span aria-hidden className="absolute inset-x-4 -bottom-px h-[2.5px] rounded-full [background:var(--grad)]" />
                )}
              </span>
            ))}
          </div>

          <button type="button" onClick={go}
            className="group block w-full cursor-pointer p-5 text-left sm:p-6"
            aria-label={`${bookCta} — go to the booking form`}>
            <div className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              {FIELDS.map(f => (
                <span key={f.label}
                  className="d7-field flex flex-col gap-1 rounded-xl border border-[var(--line)] bg-[var(--white)] px-3 py-2.5
                             transition group-hover:border-[var(--v)]/40">
                  <span className="d7-label whitespace-nowrap text-[11px]">{f.label}</span>
                  <span className="flex items-center gap-2">
                    <Icon name={f.icon} className="h-[15px] w-[15px] shrink-0 text-[var(--v)]" />
                    <span className="truncate text-[13px] font-semibold text-[var(--mute)]">{f.value}</span>
                  </span>
                </span>
              ))}
              <span className="d7-btn flex min-w-[168px] items-center justify-center gap-2 rounded-[14px] px-6 py-3.5
                               text-[14.5px] font-semibold text-white [background:var(--grad)]
                               shadow-[var(--shadow-v)] transition group-hover:-translate-y-0.5">
                {bookCta} <Icon name="arrow" className="d7-arrow h-4 w-4" />
              </span>
            </div>
            <span className="mt-4 flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
              <Icon name="lock" className="h-[14px] w-[14px] text-[var(--v)]" />
              Live availability and pricing — no card needed to check dates
            </span>
          </button>
        </div>
      </div>
    </BlurFade>
  );
}

/* ========================================================================== */

/** Four-up promise strip — the tenant's own service highlights. */
function TrustStrip({ services }: { services: { icon?: string; title: string; description?: string }[] }) {
  const items = services.slice(0, 4);
  if (!items.length) return null;

  /* The CMS stores lucide names ("ThumbsUp"); map the ones we ship glyphs for. */
  const glyph = (name?: string) => {
    const map: Record<string, string> = {
      ThumbsUp: "star", Users: "users", MapPin: "pin", Baby: "seat",
      Settings: "gear", Headphones: "head", Shield: "shield", Clock: "clock",
      Car: "car", Tag: "tag", Zap: "bolt", Gift: "gift",
    };
    return map[name ?? ""] ?? "check";
  };

  return (
    <div className="d7-wrap py-12 sm:py-14">
      <div className="grid gap-y-8 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--line)]">
        {items.map((s, i) => (
          <BlurFade key={s.title} delay={0.06 * i}>
            <div className="group flex items-center gap-3.5 px-0 lg:px-7">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--v-lt)] text-[var(--v)]
                               transition duration-500 group-hover:[background:var(--grad)] group-hover:text-white
                               group-hover:shadow-[var(--shadow-v)]">
                <Icon name={glyph(s.icon)} className="h-[22px] w-[22px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-bold text-[var(--ink)]">{s.title}</span>
                {s.description && (
                  <span className="block truncate text-[12.5px] text-[var(--body)]">{s.description}</span>
                )}
              </span>
            </div>
          </BlurFade>
        ))}
      </div>
    </div>
  );
}
