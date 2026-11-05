"use client";

/**
 * The margins beside the signup card: operator reviews as sticker-like,
 * slightly crooked speech bubbles in three sizes, with a few true facts about
 * Drive247 scribbled between them in a rough hand.
 *
 * Reviews come first from the landing page's own source: the published
 * `operator_testimonials` rows super admins manage (Customer management →
 * Testimonials), read through the same `fetchTestimonials()` the landing page
 * uses. SAMPLE_REVIEWS below are PLACEHOLDERS, not real operators — they fill
 * the empty slots in development only and are never rendered in production.
 * Replace them with real reviews (publish them in admin) before relying on them.
 *
 * Wide screens only; the outer column needs 2xl, the lowest items need height.
 */

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Caveat } from "next/font/google";

import { fetchTestimonials, type Testimonial } from "@/lib/testimonials-server";
import { cn } from "@/lib/utils";

import { SIGNUP_ENTER } from "./signup-ui";

const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"], display: "swap" });

/** PLACEHOLDERS — development only (see the header). Not real operators. */
const SAMPLE_REVIEWS: Testimonial[] = [
  { id: "sample-1", name: "Priya Nair", initials: "PN", role: "Owner", fleetSize: "6-vehicle fleet", location: "Dallas", stars: 5, before: "", bold: "Customers book at 2am and I wake up to paid rentals.", after: "" },
  { id: "sample-2", name: "Daniel Okafor", initials: "DO", role: "Founder", fleetSize: "15-vehicle fleet", location: "Houston", stars: 5, before: "", bold: "No more chasing deposits.", after: "" },
  { id: "sample-3", name: "Lena Brooks", initials: "LB", role: "Fleet Manager", fleetSize: "22-vehicle fleet", location: "Denver", stars: 5, before: "", bold: "The lockbox handover saves me hours every week.", after: "" },
  { id: "sample-4", name: "Omar Haddad", initials: "OH", role: "Owner", fleetSize: "4-vehicle fleet", location: "Orlando", stars: 5, before: "", bold: "Finally off the marketplaces.", after: "" },
];

const SHOW_SAMPLES = process.env.NODE_ENV !== "production";

type Side = "left" | "right";
type Size = "sm" | "md" | "lg";

/** Where a thing sits: which margin, how far from the card, how high, how crooked. */
type Place = {
  side: Side;
  gap: number;
  top: string;
  rotate: number;
  /** Extra visibility rules: the outer column needs 2xl, the lowest items need height. */
  only?: string;
};

/**
 * Review slots, in the order reviews fill them — the most prominent first, so
 * the real reviews always land in the big, near spots.
 */
const REVIEW_SLOTS: (Place & { size: Size })[] = [
  { side: "left", gap: 44, top: "5%", rotate: -3, size: "lg" },
  { side: "right", gap: 44, top: "15%", rotate: 2.5, size: "md" },
  { side: "right", gap: 56, top: "57%", rotate: -2, size: "md" },
  { side: "left", gap: 60, top: "53%", rotate: 3, size: "sm" },
  { side: "right", gap: 330, top: "8%", rotate: -4, size: "sm", only: "2xl:block" },
  { side: "left", gap: 360, top: "22%", rotate: 4, size: "sm", only: "2xl:block" },
  { side: "right", gap: 320, top: "50%", rotate: 3, size: "md", only: "2xl:block" },
];

type Doodle = "arrow-down" | "arrow-up" | "star" | "loop" | "dash";

const FACTS: (Place & { size: number; mark: Doodle; markFirst?: boolean; text: ReactNode })[] = [
  { side: "left", gap: 80, top: "40%", rotate: -4, size: 26, mark: "arrow-down", text: <>your <U>own booking site</U>, built for you</> },
  { side: "left", gap: 110, top: "77%", rotate: 2, size: 21, mark: "loop", only: "[@media(min-height:820px)]:block", text: <><U>ID checks</U> before the keys go out</> },
  { side: "left", gap: 300, top: "66%", rotate: -2, size: 23, mark: "star", markFirst: true, only: "2xl:block", text: <>renters sign &amp; pay <U>on their phone</U></> },
  { side: "right", gap: 90, top: "5%", rotate: 4, size: 24, mark: "arrow-up", markFirst: true, text: <>deposits <U>held for you</U></> },
  { side: "right", gap: 130, top: "45%", rotate: -3, size: 22, mark: "dash", text: <>keys in a <U>lockbox</U>, no meet-ups</> },
  { side: "right", gap: 70, top: "85%", rotate: 3, size: 25, mark: "star", markFirst: true, only: "[@media(min-height:820px)]:block", text: <>Trax flags <U>what&rsquo;s late</U></> },
];

/** Half the card's width (480px) — everything is placed from the card's edges. */
const HALF_CARD = 240;

function placeStyle(p: Place): CSSProperties {
  const edge = `calc(50% + ${HALF_CARD + p.gap}px)`;
  return {
    top: p.top,
    ...(p.side === "left" ? { right: edge } : { left: edge }),
    transform: `rotate(${p.rotate}deg)`,
  };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A wobbly underline under a fact's key words. */
function U({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block font-bold">
      {children}
      <svg viewBox="0 0 120 10" preserveAspectRatio="none" className="absolute -bottom-[0.2em] left-0 h-[0.32em] w-full" aria-hidden>
        <path d="M2 6 Q14 2 26 6 T50 5 T76 6 T100 4 T118 6" fill="none" stroke="currentColor" className="text-indigo-500/60 dark:text-indigo-400/50" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

/** Small hand-drawn marks that sit beside a fact. */
function Mark({ kind }: { kind: Doodle }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 40 40" className="size-[1.5em] shrink-0 overflow-visible" aria-hidden>
      {kind === "arrow-down" && (
        <>
          <path d="M6 4 Q30 8 26 34" {...line} />
          <path d="M18 28 L26 36 L32 26" {...line} />
        </>
      )}
      {kind === "arrow-up" && (
        <>
          <path d="M6 36 Q4 12 30 8" {...line} />
          <path d="M22 2 L32 8 L24 16" {...line} />
        </>
      )}
      {kind === "star" && <path d="M20 6 L23 17 L34 20 L23 23 L20 34 L17 23 L6 20 L17 17 Z" {...line} />}
      {kind === "loop" && <path d="M4 26 Q12 6 20 20 Q26 32 32 16 Q36 8 38 14" {...line} />}
      {kind === "dash" && <path d="M4 22 Q14 16 22 21 T38 18" {...line} />}
    </svg>
  );
}

/** Faceless people, a different look per card (ILLUSTRATION_GUIDE: real skin tones, no faces). */
const LOOKS = [
  { skin: "#d9a88a", hair: "#1f2040", top: "#5b5bd6" },
  { skin: "#b77e5f", hair: "#2a1d1a", top: "#2e2a8f" },
  { skin: "#e8bf9f", hair: "#6b4a2b", top: "#8b8cf0" },
  { skin: "#8d5a3f", hair: "#151530", top: "#3a36a8" },
];

function Person({ look, className }: { look: (typeof LOOKS)[number]; className: string }) {
  const clip = `sn-face-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#eceafe" stroke="#1f2040" strokeWidth="2" />
      <clipPath id={clip}>
        <circle cx="24" cy="24" r="21" />
      </clipPath>
      <g clipPath={`url(#${clip})`} stroke="#1f2040" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M8 48 Q8 33 24 33 Q40 33 40 48 Z" fill={look.top} />
        <circle cx="24" cy="21" r="8.5" fill={look.skin} />
        <path d="M15.5 20 Q15 11 24 11 Q33 11 32.5 19 Q29 15 24 15 Q19 15 15.5 20 Z" fill={look.hair} />
      </g>
    </svg>
  );
}

/** A hand-drawn star, a little wonky on purpose. */
function Star({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 2.5 L14.6 8.6 L21.2 9.1 L16.1 13.4 L17.8 20 L12 16.4 L6.3 20.1 L7.9 13.5 L2.8 9.2 L9.5 8.5 Z"
        fill="#5b5bd6"
        stroke="#1f2040"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SIZES: Record<Size, { card: string; quote: string; star: string; avatar: string; name: string; meta: string }> = {
  lg: { card: "w-[288px] px-5 pt-4 pb-5", quote: "text-[28px]", star: "size-5", avatar: "size-12", name: "text-[14px]", meta: "text-[12px]" },
  md: { card: "w-[240px] px-4 pt-3.5 pb-4", quote: "text-[23px]", star: "size-[18px]", avatar: "size-11", name: "text-[13px]", meta: "text-[11.5px]" },
  sm: { card: "w-[196px] px-3.5 pt-3 pb-3.5", quote: "text-[19px]", star: "size-[15px]", avatar: "size-9", name: "text-[12px]", meta: "text-[10.5px]" },
};

function ReviewCard({ t, size, look }: { t: Testimonial; size: Size; look: (typeof LOOKS)[number] }) {
  const s = SIZES[size];
  const meta = [t.role, t.fleetSize, t.location].filter(Boolean).join(" · ");
  // The line a review is remembered by: its highlight, else the whole quote.
  const line = (t.bold || `${t.before}${t.after}`).trim();
  // The big card also carries the rest of the quote, small, under the line.
  const rest = size === "lg" && t.bold ? `${t.before}${t.after}`.trim() : "";
  return (
    <figure className={cn("relative rounded-[22px] border-2 border-[#1f2040] bg-white shadow-[5px_6px_0_0_#c7c6f5] dark:border-[#0b0b1a] dark:bg-[#f4f4fb] dark:shadow-[5px_6px_0_0_rgba(91,91,214,0.45)]", s.card)}>
      {/* the speech-bubble tail */}
      <svg viewBox="0 0 28 18" className="absolute -bottom-[15px] left-9 h-[18px] w-7" aria-hidden>
        <path d="M2 0 L10 16 L22 0" fill="white" stroke="#1f2040" strokeWidth="2" strokeLinejoin="round" className="dark:fill-[#f4f4fb]" />
      </svg>
      <div className="flex gap-0.5">
        {Array.from({ length: t.stars }, (_, i) => (
          <Star key={i} className={s.star} />
        ))}
      </div>
      <blockquote className={cn(hand.className, "mt-1.5 leading-[1.05] font-bold text-[#151530]", s.quote)}>
        &ldquo;{line}&rdquo;
      </blockquote>
      {rest ? <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-zinc-500">{rest}</p> : null}
      <figcaption className="mt-3 flex items-center gap-2.5">
        <Person look={look} className={s.avatar} />
        <span className="min-w-0 text-left">
          <span className={cn("block truncate font-semibold text-[#151530]", s.name)}>{t.name}</span>
          {meta ? <span className={cn("block truncate text-zinc-500", s.meta)}>{meta}</span> : null}
        </span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// The margins
// ---------------------------------------------------------------------------

export function SideNotes() {
  const [reviews, setReviews] = useState<Testimonial[]>([]);

  useEffect(() => {
    let live = true;
    // Never throws: a failed read returns the built-in copies of the same quotes.
    void fetchTestimonials().then((rows) => {
      if (!live) return;
      const all = SHOW_SAMPLES ? [...rows, ...SAMPLE_REVIEWS] : rows;
      setReviews(all.slice(0, REVIEW_SLOTS.length));
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      {FACTS.map((f, i) => (
        <div key={`fact-${i}`} className={cn("absolute", f.only && cn("hidden", f.only))} style={placeStyle(f)}>
          <div
            className={cn(hand.className, "flex max-w-[210px] items-center gap-1.5 leading-[1.05] text-zinc-500/75 dark:text-zinc-400/55", SIGNUP_ENTER)}
            style={{ fontSize: f.size, animationDelay: `${100 + i * 60}ms`, animationFillMode: "both" }}
          >
            {f.markFirst && <Mark kind={f.mark} />}
            <span>{f.text}</span>
            {!f.markFirst && <Mark kind={f.mark} />}
          </div>
        </div>
      ))}

      {reviews.map((t, i) => {
        const slot = REVIEW_SLOTS[i];
        return (
          <div key={t.id} className={cn("absolute", slot.only && cn("hidden", slot.only))} style={placeStyle(slot)}>
            <div className={SIGNUP_ENTER} style={{ animationDelay: `${150 + i * 110}ms`, animationFillMode: "both" }}>
              <ReviewCard t={t} size={slot.size} look={LOOKS[i % LOOKS.length]} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
