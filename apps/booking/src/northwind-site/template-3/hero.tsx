"use client";

/**
 * Template 3 ("Cinematic") — the home hero: ONE pinned scene the scroll plays
 * through, in four beats. Each beat has the screen to itself, so however much
 * moves, only one thing is happening at a time.
 *
 *   0.00–0.20  The line-up    three cars under a spotlight, the headline;
 *                             scrolling parts the outer cars and drives the
 *                             middle one at the camera
 *   0.17–0.45  The statement  a line written in as you scroll, letter by
 *                             letter, while photographs fly past it
 *   0.43–0.80  Three reasons  delivery, cover, freedom: a word and a photo
 *                             wiped in from the right, one after another
 *   0.78–1.00  The close      the line-up again, the price, the way in
 *
 * Everything is driven by the section's scroll progress (framer-motion's
 * useScroll), smoothed by the shell's Lenis. Reduced motion gets a still
 * hero with the same words and buttons and no pinning.
 *
 * The accent (letters mid-reveal, buttons, the progress line) is the tenant's
 * brand colour, see accent.ts.
 */

import Image from "next/image";
import Link from "next/link";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { Fragment, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react-nw";

import { useTenant } from "@nw/contexts/TenantContext";
import { cn } from "@nw/lib/utils";
import { t3Accent } from "@nw/template-3/accent";
import type { T3Car, T3LineUp } from "@nw/template-3/cars";
import { T3_DISPLAY } from "@nw/template-3/shell";

const EASE = [0.22, 1, 0.36, 1] as const;
const SMALL = "text-[13px] font-medium";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t3-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f4f6]";
const DIM = "rgba(17,18,22,0.12)";
const INK = "#111216";

type Car = T3Car | null;
type Cars = T3LineUp;

/** Photographs that fly past the statement: where each ends up (from the centre, in vw/vh) and when it sets off. */
const COLLAGE = [
  {
    src: "/booking_landingpage/promo-business-class.jpg",
    x: -34,
    y: -30,
    w: "w-[38vw] sm:w-[20vw]",
    at: 0.18,
  },
  {
    src: "/booking_landingpage/reviews-hero.jpg",
    x: 30,
    y: -34,
    w: "w-[34vw] sm:w-[17vw]",
    at: 0.195,
  },
  {
    src: "/booking_landingpage/promo-weekend-escape.jpg",
    x: 40,
    y: 22,
    w: "w-[40vw] sm:w-[21vw]",
    at: 0.21,
  },
  {
    src: "/booking_landingpage/about-interior.jpg",
    x: -40,
    y: 26,
    w: "w-[30vw] sm:w-[13vw]",
    at: 0.225,
  },
  {
    src: "/booking_landingpage/fleet-hero.jpg",
    x: 6,
    y: -44,
    w: "w-[34vw] sm:w-[16vw]",
    at: 0.24,
  },
  {
    src: "/booking_landingpage/contact-hero.jpg",
    x: -8,
    y: 42,
    w: "w-[36vw] sm:w-[18vw]",
    at: 0.255,
  },
  {
    src: "/booking_landingpage/promotions-hero.jpg",
    x: 46,
    y: -6,
    w: "w-[32vw] sm:w-[15vw]",
    at: 0.27,
  },
] as const;

const FEATURES = [
  {
    word: "Delivery",
    text: "Your car arrives at your door, the airport or your hotel, cleaned and fuelled, at the time you choose.",
    image: "/booking_landingpage/reviews-hero.jpg",
    alt: "A driver smiling out of the window of a rental car",
  },
  {
    word: "Cover",
    text: "Insurance is part of checkout, so you are covered from the moment the keys are in your hand.",
    image: "/booking_landingpage/about-interior.jpg",
    alt: "Leather and wood interior of a luxury car",
  },
  {
    word: "Freedom",
    text: "Rent by the day, the week or the month. Change your dates or extend from your phone.",
    image: "/booking_landingpage/about-hero.jpg",
    alt: "A white SUV crossing open desert dunes",
  },
] as const;

const BEATS = [
  { at: 0, label: "The line-up" },
  { at: 0.19, label: "Our promise" },
  { at: 0.45, label: "Why us" },
  { at: 0.8, label: "Book" },
] as const;

export function Template3Hero({
  fromDaily,
  cars,
}: {
  fromDaily: string | null;
  cars: Cars;
}) {
  const { tenant } = useTenant();
  const accent = t3Accent(tenant?.primary_color);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  if (reduce) return <StillHero fromDaily={fromDaily} cars={cars} />;

  return (
    <section ref={ref} aria-label="Introduction" data-t3-clear-nav="1.02" className="relative h-[560vh]">
      <div className="sticky top-0 h-dvh overflow-hidden">
        <LineUp p={p} cars={cars} />
        <Statement p={p} accent={accent} />
        <Reasons p={p} accent={accent} />
        <Close p={p} fromDaily={fromDaily} cars={cars} />
        <Progress p={p} />
      </div>
    </section>
  );
}

/* ─────────────────────────────── beat 1: line-up ───────────────────────── */

function LineUp({ p, cars }: { p: MotionValue<number>; cars: Cars }) {
  const headY = useTransform(p, [0, 0.14], [0, -140]);
  const headO = useTransform(p, [0.02, 0.12], [1, 0]);
  const carScale = useTransform(p, [0, 0.2], [1, 2.3]);
  const carY = useTransform(p, [0, 0.2], ["0%", "38%"]);
  const carO = useTransform(p, [0.13, 0.205], [1, 0]);
  const cueO = useTransform(p, [0, 0.025], [1, 0]);
  const sceneVis = useTransform(p, (v) => (v > 0.22 ? "hidden" : "visible"));

  return (
    <motion.div className="absolute inset-0" style={{ visibility: sceneVis }}>
      <Spotlight />

      <motion.div
        style={{ y: headY, opacity: headO }}
        className="absolute inset-x-0 top-[15%] z-20 px-5 text-center sm:top-[13%]"
      >
        <h1
          style={T3_DISPLAY}
          className="mx-auto text-[clamp(46px,min(10vw,14vh),168px)] leading-[0.92] tracking-[-0.01em] text-[#111216]"
        >
          <RiseLine text="For those who" delay={0.35} />
          <RiseLine text="refuse ordinary" delay={0.5} />
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.1, ease: EASE }}
          className={cn(
            SMALL,
            "mt-6 text-[15px] text-[#1c2330] sm:mt-8 sm:text-[17px]",
          )}
        >
          Premium car rental, delivered to your door
        </motion.p>
      </motion.div>

      {/* The line-up, staged like a showroom: the centre car forward and largest,
          each pair outside it a step back and a step smaller. Slot sizes are CSS
          variables on the row (see ROW). Side cars part as you scroll; the centre
          car drives at you. */}
      <div className={ROW}>
        <SideCar car={cars.farLeft} side={-1} ring={2} p={p} delay={0.75} />
        <SideCar car={cars.farRight} side={1} ring={2} p={p} delay={0.85} />
        <SideCar car={cars.left} side={-1} ring={1} p={p} delay={0.5} />
        <SideCar car={cars.right} side={1} ring={1} p={p} delay={0.6} />
        <motion.div
          style={{
            x: "-50%",
            scale: carScale,
            y: carY,
            opacity: carO,
            width: "var(--c)",
          }}
          className="absolute bottom-0 left-1/2 z-10 origin-bottom"
        >
          <Entrance delay={0.25}>
            <StagedCar
              car={cars.centre}
              priority
              sizes="(min-width: 640px) 40vw, 80vw"
            />
          </Entrance>
        </motion.div>
      </div>

      <Floor />

      <motion.div
        style={{ opacity: cueO }}
        className="absolute inset-x-0 bottom-6 z-20 flex justify-center"
      >
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6, duration: 0.8 }}
          className={cn(SMALL, "flex items-center gap-2 text-white")}
        >
          Scroll
          <motion.span
            animate={{ y: [0, 5, 0] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
          >
            <ArrowDown className="size-3.5" strokeWidth={1.5} />
          </motion.span>
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

/* ────────────────────────────── beat 2: statement ──────────────────────── */

function Statement({ p, accent }: { p: MotionValue<number>; accent: string }) {
  const opacity = useTransform(p, [0.17, 0.21, 0.41, 0.46], [0, 1, 1, 0]);
  const scale = useTransform(p, [0.17, 0.46], [1.06, 0.96]);
  const vis = useTransform(p, (v) =>
    v < 0.165 || v > 0.465 ? "hidden" : "visible",
  );

  return (
    <motion.div
      className="absolute inset-0 grid place-items-center"
      style={{ visibility: vis }}
    >
      {COLLAGE.map((photo) => (
        <FlyingPhoto key={photo.src} p={p} photo={photo} />
      ))}
      <motion.p
        style={{ ...T3_DISPLAY, opacity, scale }}
        className="relative z-10 max-w-[16ch] px-5 text-center text-[clamp(40px,6.4vw,104px)] leading-[0.98] tracking-[-0.01em] sm:max-w-none"
      >
        <ScrollLetters
          p={p}
          text="We don’t hand you a car."
          from={0.21}
          to={0.3}
          accent={accent}
        />
        <br />
        <ScrollLetters
          p={p}
          text="We hand you the weekend."
          from={0.29}
          to={0.38}
          accent={accent}
        />
      </motion.p>
    </motion.div>
  );
}

function FlyingPhoto({
  p,
  photo,
}: {
  p: MotionValue<number>;
  photo: (typeof COLLAGE)[number];
}) {
  const end = photo.at + 0.2;
  const x = useTransform(p, [photo.at, end], ["0vw", `${photo.x * 1.5}vw`]);
  const y = useTransform(p, [photo.at, end], ["0vh", `${photo.y * 1.5}vh`]);
  const scale = useTransform(p, [photo.at, end], [0.25, 1.7]);
  const opacity = useTransform(
    p,
    [photo.at, photo.at + 0.025, end - 0.05, end],
    [0, 0.75, 0.75, 0],
  );
  return (
    <motion.div
      style={{ x, y, scale, opacity }}
      className={cn("absolute aspect-[4/3] overflow-hidden", photo.w)}
    >
      <Image
        src={photo.src}
        alt=""
        fill
        sizes="25vw"
        className="object-cover"
      />
    </motion.div>
  );
}

/* ────────────────────────────── beat 3: reasons ────────────────────────── */

function Reasons({ p, accent }: { p: MotionValue<number>; accent: string }) {
  const opacity = useTransform(p, [0.43, 0.46, 0.77, 0.8], [0, 1, 1, 0]);
  const vis = useTransform(p, (v) =>
    v < 0.425 || v > 0.805 ? "hidden" : "visible",
  );
  return (
    <motion.div
      style={{ opacity, visibility: vis }}
      className="absolute inset-0"
    >
      {FEATURES.map((feature, index) => (
        <Reason
          key={feature.word}
          p={p}
          feature={feature}
          index={index}
          accent={accent}
        />
      ))}
    </motion.div>
  );
}

const REASON_START = 0.46;
const REASON_SPAN = 0.105;

function Reason({
  p,
  feature,
  index,
  accent,
}: {
  p: MotionValue<number>;
  feature: (typeof FEATURES)[number];
  index: number;
  accent: string;
}) {
  const a = REASON_START + index * REASON_SPAN;
  const b = a + REASON_SPAN;
  const last = index === FEATURES.length - 1;

  // The photo wipes in from the right over the one before it, settling as it goes.
  const clipPath = useTransform(
    p,
    [a - 0.035, a + 0.02],
    ["inset(0% 0% 0% 100%)", "inset(0% 0% 0% 0%)"],
  );
  const imgScale = useTransform(p, [a - 0.035, b], [1.3, 1.02]);
  // The words come up, hold, and go up and out as the next arrive (the last one stays).
  const textO = useTransform(
    p,
    last ? [a - 0.005, a + 0.03] : [a - 0.005, a + 0.03, b - 0.03, b],
    last ? [0, 1] : [0, 1, 1, 0],
  );
  const textY = useTransform(
    p,
    last ? [a - 0.005, a + 0.03] : [a - 0.005, a + 0.03, b - 0.03, b],
    last ? [50, 0] : [50, 0, 0, -50],
  );

  return (
    <>
      <motion.div
        style={{ clipPath, zIndex: index + 1 }}
        className="absolute inset-x-0 top-0 h-[52%] overflow-hidden md:inset-y-0 md:left-1/2 md:h-auto"
      >
        <motion.div style={{ scale: imgScale }} className="absolute inset-0">
          <Image
            src={feature.image}
            alt={feature.alt}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </motion.div>
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-[#f3f4f6] via-transparent to-transparent md:bg-linear-to-r"
        />
      </motion.div>

      <motion.div
        style={{ opacity: textO, y: textY }}
        className="absolute inset-x-0 bottom-0 z-10 flex h-[48%] flex-col justify-center gap-5 px-5 sm:px-8 md:inset-y-0 md:left-0 md:right-1/2 md:h-auto md:px-[6vw]"
      >
        <span className={cn(SMALL, "tabular-nums text-[#5b5f69]")}>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(FEATURES.length).padStart(2, "0")}
        </span>
        <h2
          style={T3_DISPLAY}
          className="text-[clamp(56px,8.5vw,140px)] leading-[0.9] tracking-[-0.01em]"
        >
          <ScrollLetters
            p={p}
            text={feature.word}
            from={a}
            to={a + 0.05}
            accent={accent}
          />
        </h2>
        <p className="max-w-[40ch] text-[15px] leading-relaxed text-[#5b5f69] sm:text-[16px]">
          {feature.text}
        </p>
        <Link
          href="/booking"
          className={cn(
            "inline-flex h-11 w-fit items-center gap-2 rounded-full bg-[var(--t3-accent)] px-5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110",
            FOCUS,
          )}
        >
          Start your booking
          <ArrowUpRight className="size-3.5" />
        </Link>
      </motion.div>
    </>
  );
}

/* ─────────────────────────────── beat 4: close ─────────────────────────── */

function Close({
  p,
  fromDaily,
  cars,
}: {
  p: MotionValue<number>;
  fromDaily: string | null;
  cars: Cars;
}) {
  const opacity = useTransform(p, [0.78, 0.84], [0, 1]);
  const vis = useTransform(p, (v) => (v < 0.775 ? "hidden" : "visible"));
  const pointerEvents = useTransform(p, (v) => (v > 0.84 ? "auto" : "none"));
  const carsY = useTransform(p, [0.78, 0.92], ["35%", "0%"]);
  const carsScale = useTransform(p, [0.78, 0.95], [0.6, 0.74]);
  const headY = useTransform(p, [0.8, 0.9], [60, 0]);

  return (
    <motion.div
      style={{ opacity, visibility: vis, pointerEvents }}
      className="absolute inset-0"
    >
      <Spotlight />
      <motion.div
        style={{ y: headY }}
        className="absolute inset-x-0 top-[15%] z-20 flex flex-col items-center gap-6 px-5 text-center"
      >
        <span className={cn(SMALL, "text-[#1c2330]")}>Ready when you are</span>
        <h2
          style={T3_DISPLAY}
          className="text-[clamp(52px,8vw,128px)] leading-[0.92] tracking-[-0.01em]"
        >
          Refuse ordinary.
        </h2>
        <p className="max-w-[44ch] text-[15px] text-[#1c2330] sm:text-[16px]">
          {fromDaily
            ? `Cars from ${fromDaily} a day, delivered to your door and insured from the first mile.`
            : "Delivered to your door and insured from the first mile."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/booking"
            className={cn(
              "inline-flex h-12 items-center gap-2 rounded-full bg-[var(--t3-accent)] px-7 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110",
              FOCUS,
            )}
          >
            Book a car
            <ArrowUpRight className="size-4" />
          </Link>
          <Link
            href="/fleet"
            className={cn(
              "inline-flex h-12 items-center rounded-full border border-[#d5d8de] bg-white px-7 text-[14px] font-semibold text-[#111216] transition-colors hover:border-[#111216]",
              FOCUS,
            )}
          >
            See the fleet
          </Link>
        </div>
      </motion.div>

      <motion.div
        style={{ y: carsY, scale: carsScale }}
        className={cn(ROW, "bottom-[6%] origin-bottom sm:bottom-[5%]")}
      >
        {(["farLeft", "farRight", "left", "right"] as const).map((slot) => {
          const ring = slot.startsWith("far") ? 2 : 1;
          return (
            <div
              key={slot}
              style={slotStyle(slot.endsWith("ight") ? 1 : -1, ring)}
              className={slotClass(ring)}
            >
              <StagedCar car={cars[slot]} sizes="30vw" />
            </div>
          );
        })}
        <div
          style={{ width: "var(--c)" }}
          className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2"
        >
          <StagedCar car={cars.centre} sizes="40vw" />
        </div>
      </motion.div>
      <Floor />
    </motion.div>
  );
}

/* ───────────────────────────────── progress ────────────────────────────── */

function Progress({ p }: { p: MotionValue<number> }) {
  const scaleX = useTransform(p, [0, 1], [0, 1]);
  const [beat, setBeat] = useState(0);
  useMotionValueEvent(p, "change", (v) => {
    const next = BEATS.reduce(
      (found, item, index) => (v >= item.at ? index : found),
      0,
    );
    setBeat((current) => (current === next ? current : next));
  });
  const shown = useTransform(p, [0, 0.02], [0, 1]);

  return (
    <motion.div
      style={{ opacity: shown }}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30"
    >
      <div className="mx-auto hidden max-w-[1600px] items-center justify-between px-8 pb-4 sm:flex">
        <span className={cn(SMALL, "tabular-nums text-[#5b5f69]")}>
          {String(beat + 1).padStart(2, "0")} /{" "}
          {String(BEATS.length).padStart(2, "0")}
        </span>
        <span className={cn(SMALL, "text-[#5b5f69]")}>{BEATS[beat].label}</span>
      </div>
      <div className="h-px w-full bg-black/10">
        <motion.div
          style={{ scaleX }}
          className="h-px origin-left bg-[var(--t3-accent)]"
        />
      </div>
    </motion.div>
  );
}

/* ───────────────────────────────── pieces ──────────────────────────────── */

/** Letters that go from dim, through the accent, to ink as the scroll passes `from`→`to`. */
function ScrollLetters({
  p,
  text,
  from,
  to,
  accent,
}: {
  p: MotionValue<number>;
  text: string;
  from: number;
  to: number;
  accent: string;
}) {
  const words = text.split(" ");
  const step = (to - from) / Math.max(text.length, 1);
  // Each letter's moment, counting the spaces so the pace follows the line as read.
  let offset = 0;
  const timed = words.map((word) => {
    const letters = Array.from(word).map((letter, i) => ({
      letter,
      at: from + (offset + i) * step,
    }));
    offset += word.length + 1;
    return letters;
  });
  // Words stay whole (nowrap) so a line never breaks inside one.
  return (
    <span aria-label={text}>
      {timed.map((letters, w) => (
        <Fragment key={w}>
          <span aria-hidden className="inline-block whitespace-nowrap">
            {letters.map(({ letter, at }) => (
              <Letter
                key={at}
                p={p}
                letter={letter}
                at={at}
                span={step * 5}
                accent={accent}
              />
            ))}
          </span>
          {w < timed.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

function Letter({
  p,
  letter,
  at,
  span,
  accent,
}: {
  p: MotionValue<number>;
  letter: string;
  at: number;
  span: number;
  accent: string;
}) {
  const color = useTransform(
    p,
    [at, at + span * 0.35, at + span],
    [DIM, accent, INK],
  );
  return <motion.span style={{ color }}>{letter}</motion.span>;
}

/** A line whose words rise into place once, on load. */
function RiseLine({ text, delay }: { text: string; delay: number }) {
  return (
    <span className="block">
      {text.split(" ").map((word, index) => (
        <span
          key={index}
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
        >
          <motion.span
            className="inline-block"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{
              duration: 1.1,
              delay: delay + index * 0.08,
              ease: EASE,
            }}
          >
            {word}
            {index < text.split(" ").length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Rises out of the dark once, on load. */
function Entrance({
  delay,
  children,
}: {
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 50, filter: "blur(14px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 1.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Slot sizes for the five-car row, as CSS variables so they can change by
 * breakpoint: --c centre width, --i/--o inner and outer widths, --di/--do how
 * far their centres sit from the middle. On desktop the inner pair tucks just
 * behind the centre car and the outer pair runs half off the screen; widths
 * are capped by height too, so on a wide, short screen the cars never climb
 * into the headline. Phones hide the outer pair.
 */
const ROW =
  "absolute inset-x-0 bottom-[13%] z-10 sm:bottom-[8%] [--c:80vw] [--i:56vw] [--o:40vw] [--di:44vw] [--do:80vw] sm:[--c:min(38vw,52vh)] sm:[--i:min(29vw,42vh)] sm:[--o:min(23vw,34vh)] sm:[--di:min(31vw,46vh)] sm:[--do:min(49vw,76vh)]";

/** Further back stands higher on the floor. */
function slotStyle(side: -1 | 1, ring: 1 | 2): CSSProperties {
  const w = ring === 1 ? "var(--i)" : "var(--o)";
  const d = ring === 1 ? "var(--di)" : "var(--do)";
  return {
    width: w,
    left: `calc(50% ${side < 0 ? "-" : "+"} ${d} - ${w} / 2)`,
    bottom: ring === 1 ? "2.5vh" : "5vh",
  };
}

const slotClass = (ring: 1 | 2) =>
  cn("absolute", ring === 1 ? "z-[5]" : "z-0 hidden sm:block");

function SideCar({
  car,
  side,
  ring,
  p,
  delay,
}: {
  car: Car;
  side: -1 | 1;
  ring: 1 | 2;
  p: MotionValue<number>;
  delay: number;
}) {
  // The pairs part sideways as the centre car comes forward; the outer pair goes first.
  const x = useTransform(
    p,
    [0, 0.18],
    ["0vw", `${side * (ring === 1 ? 42 : 30)}vw`],
  );
  const opacity = useTransform(
    p,
    ring === 1 ? [0.02, 0.15] : [0.01, 0.1],
    [1, 0],
  );
  return (
    <motion.div
      style={{ ...slotStyle(side, ring), x, opacity }}
      className={slotClass(ring)}
    >
      <Entrance delay={delay}>
        <StagedCar
          car={car}
          sizes={ring === 1 ? "(min-width: 640px) 29vw, 56vw" : "23vw"}
        />
      </Entrance>
    </motion.div>
  );
}

/**
 * A car standing on the showroom floor: a soft contact shadow under the
 * wheels, the car, and a faint mirror of its lower half on the floor.
 */
function StagedCar({
  car,
  priority = false,
  sizes,
}: {
  car: Car;
  priority?: boolean;
  sizes: string;
}) {
  if (!car) return null;
  const fade = "linear-gradient(to bottom, rgba(0,0,0,0.2), transparent 75%)";
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-x-[4%] bottom-[-4%] h-[16%] rounded-[50%] blur-md"
        style={{
          background:
            "radial-gradient(closest-side, rgba(17,18,22,0.5), rgba(17,18,22,0.12) 60%, transparent)",
        }}
      />
      <CarImage car={car} priority={priority} sizes={sizes} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-[38%] overflow-hidden"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        <CarImage
          car={car}
          decorative
          sizes={sizes}
          className="-scale-y-100 blur-[1.5px]"
        />
      </div>
    </div>
  );
}

function CarImage({
  car,
  priority = false,
  decorative = false,
  sizes,
  className,
}: {
  car: Car;
  priority?: boolean;
  decorative?: boolean;
  sizes: string;
  className?: string;
}) {
  if (!car) return null;
  return (
    <Image
      src={car.src}
      alt={decorative ? "" : car.alt}
      width={car.w}
      height={car.h}
      priority={priority}
      sizes={sizes}
      draggable={false}
      className={cn("relative h-auto w-full select-none", className)}
    />
  );
}

/**
 * The backdrop: one vertical gradient, drawn in CSS so it is sharp at any
 * size. Medium-dark blue at the top, light across the middle where the cars'
 * roofs meet it, and deepening to dark blue at the bottom where they stand.
 */
function Spotlight() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(180deg, #7ea6d8 0%, #a6c3e7 26%, #dce8f6 46%, #f3f7fc 56%, #c9d9ee 70%, #7c9cca 86%, #3a5a8c 100%)",
      }}
    />
  );
}

function Floor() {
  return <FloorFade />;
}

function FloorFade() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-[8%] bg-linear-to-t from-[#3a5a8c]/70 to-transparent"
    />
  );
}

/* ─────────────────────────────── reduced motion ────────────────────────── */

function StillHero({
  fromDaily,
  cars,
}: {
  fromDaily: string | null;
  cars: Cars;
}) {
  return (
    <section
      aria-label="Introduction"
      className="relative flex min-h-dvh flex-col items-center overflow-hidden pt-32 text-center"
    >
      <Spotlight />
      <div className="relative z-20 flex flex-col items-center gap-6 px-5">
        <h1
          style={T3_DISPLAY}
          className="text-[clamp(46px,8vw,128px)] leading-[0.92]"
        >
          For those who
          <br />
          refuse ordinary
        </h1>
        <p className="max-w-[44ch] text-[15px] text-[#5b5f69]">
          {fromDaily
            ? `Cars from ${fromDaily} a day, delivered to your door and insured from the first mile.`
            : "Delivered to your door and insured from the first mile."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/booking"
            className={cn(
              "inline-flex h-12 items-center gap-2 rounded-full bg-[var(--t3-accent)] px-7 text-[14px] font-semibold text-white",
              FOCUS,
            )}
          >
            Book a car
            <ArrowUpRight className="size-4" />
          </Link>
          <Link
            href="/fleet"
            className={cn(
              "inline-flex h-12 items-center rounded-full border border-[#d5d8de] bg-white px-7 text-[14px] font-semibold text-[#111216]",
              FOCUS,
            )}
          >
            See the fleet
          </Link>
        </div>
      </div>
      <div className="relative mt-auto h-[40vh] w-full">
        <div className="absolute bottom-0 left-1/2 z-10 w-[72%] -translate-x-1/2 sm:w-[36%]">
          <StagedCar car={cars.centre} sizes="36vw" />
        </div>
      </div>
    </section>
  );
}
