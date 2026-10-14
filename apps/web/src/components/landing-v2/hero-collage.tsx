import { Caveat } from "next/font/google";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

/*
 * The hero's right side: five portraits that pop in one after another, each
 * marked up with a rough, handwritten note and a scribbled arrow.
 *
 * The portraits are licensed Unsplash stock photos (public/landing-v2/people,
 * see CREDITS.md), self-hosted. They are imagery, not customers: the notes are
 * BENEFITS of the product, never quotes attributed to anyone, so nothing here
 * pretends to be a testimonial. Real operator photos (with their permission)
 * can replace them, at which point the notes could become their own words.
 *
 * Everything is positioned in percent of a square stage and the note type is
 * sized in container units, so the whole collage scales as one piece from
 * phone to desktop. Motion is the house entrance (opacity + 12px lift, 200ms
 * ease-out), staggered; reduced motion shows it at rest.
 */

const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

/** A loose, hand-drawn arrow. `d` is the shaft; the head is drawn at its end. */
function Scribble({ d, head, style }: { d: string; head: string; style: CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute overflow-visible" style={style} aria-hidden>
      <path d={d} fill="none" stroke="var(--lv-ink-2)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={head} fill="none" stroke="var(--lv-ink-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A wobbly underline under the note's key words. */
function Squiggle() {
  return (
    <svg viewBox="0 0 120 10" preserveAspectRatio="none" className="absolute -bottom-[0.18em] left-0 h-[0.32em] w-full" aria-hidden>
      <path d="M2 6 Q14 2 26 6 T50 5 T76 6 T100 4 T118 6" fill="none" stroke="var(--lv-accent)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Tile = { src: string; box: CSSProperties; rotate: number };
type Note = { text: ReactNode; box: CSSProperties; rotate: number; arrow: { d: string; head: string; box: CSSProperties } };

const TILES: Tile[] = [
  {
    src: "/landing-v2/people/person-1.jpg",
    box: { left: "3%", top: "9%", width: "33%", height: "37%" },
    rotate: -4,
  },
  {
    src: "/landing-v2/people/person-2.jpg",
    box: { left: "63%", top: "3%", width: "33%", height: "36%" },
    rotate: 3,
  },
  {
    src: "/landing-v2/people/person-3.jpg",
    box: { left: "35%", top: "40%", width: "31%", height: "34%" },
    rotate: 2,
  },
  {
    src: "/landing-v2/people/person-4.jpg",
    box: { left: "4%", top: "61%", width: "28%", height: "31%" },
    rotate: 3,
  },
  {
    src: "/landing-v2/people/person-5.jpg",
    box: { left: "70%", top: "55%", width: "27%", height: "31%" },
    rotate: -3,
  },
];

const NOTES: Note[] = [
  {
    text: (
      <>
        your <span className="relative inline-block font-bold">own site<Squiggle /></span>, live in about a week
      </>
    ),
    box: { left: "38.5%", top: "5%", width: "22.5%" },
    rotate: -3,
    arrow: { d: "M85 4 Q30 14 10 88", head: "M2 72 L10 92 L26 80", box: { left: "30%", top: "17%", width: "11%", height: "15%" } },
  },
  {
    text: (
      <>
        deposits <span className="relative inline-block font-bold">held for you<Squiggle /></span>
      </>
    ),
    box: { left: "66%", top: "41.5%", width: "32%" },
    rotate: 2,
    arrow: { d: "M10 96 Q80 80 55 6", head: "M40 16 L55 2 L68 18", box: { left: "88%", top: "31%", width: "8%", height: "11%" } },
  },
  {
    text: (
      <>
        renters sign &amp; pay <span className="relative inline-block font-bold">on their phone<Squiggle /></span>
      </>
    ),
    box: { left: "33%", top: "77%", width: "34%" },
    rotate: -2,
    arrow: { d: "M18 96 Q0 40 46 6", head: "M30 6 L48 4 L44 22", box: { left: "36%", top: "69.5%", width: "8%", height: "8.5%" } },
  },
  {
    text: (
      <>
        Trax flags <span className="relative inline-block font-bold">what&rsquo;s late<Squiggle /></span>
      </>
    ),
    box: { left: "2%", top: "49%", width: "32%" },
    rotate: -4,
    arrow: { d: "M60 4 Q100 50 56 94", head: "M44 80 L56 96 L72 84", box: { left: "20%", top: "53%", width: "9%", height: "10%" } },
  },
  {
    text: (
      <>
        your customers. <span className="relative inline-block font-bold">not the marketplace&rsquo;s<Squiggle /></span>
      </>
    ),
    box: { left: "58%", top: "88%", width: "42%" },
    rotate: 2,
    arrow: { d: "M40 96 Q100 60 60 4", head: "M46 14 L60 2 L74 14", box: { left: "90%", top: "81%", width: "8%", height: "8%" } },
  },
];

/** Delay before item `i` pops in; notes follow their portrait. */
const tileDelay = (i: number) => 150 + i * 160;

export function HeroCollage() {
  return (
    <div className={`${hand.className} relative aspect-square w-full [container-type:inline-size]`} aria-label="What Drive247 does for you">
      {TILES.map((t, i) => (
        <div key={i} className="lv2-pop absolute" style={{ ...t.box, animationDelay: `${tileDelay(i)}ms` }}>
          <div
            className="relative h-full w-full overflow-hidden rounded-2xl border-[5px] border-[var(--lv-paper)] bg-[var(--lv-tint)] outline outline-1 outline-[var(--lv-line)]"
            style={{ transform: `rotate(${t.rotate}deg)` }}
          >
            <Image src={t.src} alt="" fill sizes="(min-width: 1024px) 200px, 34vw" className="object-cover" priority={i < 2} />
          </div>
        </div>
      ))}

      {NOTES.map((n, i) => (
        <div key={i} className="lv2-pop pointer-events-none absolute inset-0" style={{ animationDelay: `${tileDelay(i) + 140}ms` }}>
          <p
            className="absolute leading-[1.05] text-[var(--lv-ink)]"
            style={{ ...n.box, transform: `rotate(${n.rotate}deg)`, fontSize: "clamp(15px, 4.1cqw, 25px)" }}
          >
            {n.text}
          </p>
          <Scribble d={n.arrow.d} head={n.arrow.head} style={n.arrow.box} />
        </div>
      ))}
    </div>
  );
}
