"use client";

import { useEffect, useRef, useState } from "react";
import { Instrument_Serif } from "next/font/google";
import { ArrowRight, Pause, Play, Volume2 } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import type { Testimonial } from "@/lib/testimonials-server";
import "./testimonials-section.css";
import { CAPTIONS, CaptionLine, cueAt, wordCount } from "./testimonials-captions";

/*
 * The founder on film beside the reasons for building it, then operators' words below.
 *
 *   Films    real footage of the founder, labelled as the founder.
 *   Quotes   only what admins publish in `operator_testimonials`, signed by that name.
 *            No faces go with them: we have no photos of these operators.
 */
const film = (slug: string, title: string, length: string) => ({
  slug,
  src: `/landing-v4/testimonials/${slug}.mp4`,
  poster: `/landing-v4/testimonials/${slug}.webp`,
  title,
  length,
});

// The italic serif the quote cards share with the blog's callout ((reading)/layout.tsx).
const cursive = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-cursive", display: "swap" });

/*
 * MOCK PHOTOS. Stock portraits (randomuser.me) stand in until operators send their own
 * photos with their testimonials; picked by name so each person keeps the same face.
 * Replace with the real photo (and drop this) before the real testimonials go live.
 */
const MOCK_FACES = [
  "men/32", "women/44", "men/46", "women/65", "men/75", "women/12", "men/22", "women/68",
].map((path) => `https://randomuser.me/api/portraits/${path}.jpg`);

/* The sample quotes on the page today, each given a fitting stock face. */
const MOCK_FACE_FOR: Record<string, string> = {
  "Marcus Thompson": "https://randomuser.me/api/portraits/men/32.jpg",
  "Sarah Alvarez": "https://randomuser.me/api/portraits/women/44.jpg",
  "James Reilly": "https://randomuser.me/api/portraits/men/46.jpg",
};

function mockFace(name: string): string {
  if (MOCK_FACE_FOR[name]) return MOCK_FACE_FOR[name];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MOCK_FACES[hash % MOCK_FACES.length];
}

/* The marquee needs enough cards to run past the screen twice over; few quotes are repeated. */
const MARQUEE_MIN = 8;

const FILMS = [
  film("founder-turo", "What if your Turo account went tomorrow?", "0:17"),
  film("founder-own-customers", "The customer isn't yours", "0:15"),
  film("founder-trust", "Why renters trust your own site", "0:17"),
  film("founder-who-for", "Who we built this for", "0:13"),
];

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  const { ref, visible } = useFadeIn();
  const frame = useRef<HTMLButtonElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  // One film plays silently while on screen, until someone asks for sound.
  const [active, setActive] = useState(0);
  const [sound, setSound] = useState(false);
  const [stopped, setStopped] = useState(false);
  // Where the film is, for the captions (testimonials-captions.tsx).
  const [time, setTime] = useState(0);
  useEffect(() => setTime(0), [active]);

  useEffect(() => {
    const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(noMotion);
    if (noMotion) setStopped(true);
    const el = frame.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = player.current;
    if (!el) return;
    el.muted = !sound;
    if (inView && !stopped) void el.play().catch(() => {});
    else el.pause();
  }, [active, sound, stopped, inView]);

  const choose = (index: number) => {
    setActive(index);
    setStopped(false);
    setSound(true);
  };

  const pressFrame = () => {
    if (sound && !stopped) {
      setStopped(true);
      setSound(false);
    } else {
      choose(active);
    }
  };

  const ended = () => {
    setSound(false);
    if (reduced) setStopped(true);
    else setActive((i) => (i + 1) % FILMS.length);
  };

  const trackProgress = () => {
    const el = player.current;
    if (el?.duration && bar.current) bar.current.style.transform = `scaleX(${el.currentTime / el.duration})`;
    if (el) setTime(el.currentTime);
  };

  const current = FILMS[active];
  const cues = CAPTIONS[current.slug];
  const cue = cueAt(cues, time);
  // Words light up through the line as it is said.
  // The words fill the first 70% of the line's time, so the whole line (and its purple key
  // words, often last) then holds on screen to be read rather than flashing at the end.
  const said = cue ? Math.ceil(((time - cue.from) / ((cue.to - cue.from) * 0.7)) * wordCount(cue)) : 0;
  const withSound = sound && !stopped;

  return (
    <section id="testimonials" className={`ts-section ${cursive.variable}`}>
      <div ref={ref} className={`ts-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="ts-feature">
          <button
            ref={frame}
            type="button"
            className="ts-frame"
            // The page line comes down onto this film and draws a frame round it (tour-layout.ts).
            data-line-frame
            aria-label={`${withSound ? "Stop" : "Play with sound"}: ${current.title}, from our founder`}
            onClick={pressFrame}
          >
            <video
              ref={player}
              src={current.src}
              poster={current.poster}
              muted
              playsInline
              preload="none"
              onEnded={ended}
              onTimeUpdate={trackProgress}
            />
            {cue && (
              <span key={`${current.slug}-${cue.from}`} className="ts-caption" aria-hidden>
                <CaptionLine cue={cue} said={said} />
              </span>
            )}
            <span className="ts-control" aria-hidden>
              {withSound ? <Pause /> : stopped ? <Play /> : <Volume2 />}
            </span>
          </button>

          <div className="ts-head">
            <h2 className="ts-title font-medium tracking-tighter">
              Built for <span className="ts-brand">operators</span>
            </h2>
            <p className="ts-sub">Why rental businesses run on Drive247.</p>
          </div>

          <div className="ts-films">
            <p className="ts-label">From our founder</p>
            <ul>
              {FILMS.map((item, i) => (
                <li key={item.src}>
                  <button
                    type="button"
                    className="ts-film"
                    aria-current={i === active || undefined}
                    onClick={() => choose(i)}
                  >
                    <span className="ts-film-title">{item.title}</span>
                    <span className="ts-film-length">{item.length}</span>
                    {i === active && (
                      <span className="ts-progress" aria-hidden>
                        <span key={item.src} ref={bar} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <a href="/strategy-call" className="ts-link">
              See how Drive247 works for your fleet
              <ArrowRight aria-hidden />
            </a>
          </div>
        </div>

        {testimonials.length > 0 && <QuoteMarquee testimonials={testimonials} />}
      </div>
    </section>
  );
}

/*
 * What operators say, on a marquee that drifts left and pauses under the pointer. Each card
 * is set like the blog's callout (post-article.css .ar-callout): solid brand purple, bold
 * white type, the key words in the italic serif.
 */
function QuoteMarquee({ testimonials }: { testimonials: Testimonial[] }) {
  const set: Testimonial[] = [];
  while (set.length < MARQUEE_MIN) set.push(...testimonials);
  return (
    <div className="ts-quotes" aria-label="What operators say">
      {/* Read once by screen readers; the moving copies are hidden from them. */}
      <ul className="sr-only">
        {testimonials.map((quote) => (
          <li key={quote.id}>
            {quote.before}
            {quote.bold}
            {quote.after} {quote.name}
          </li>
        ))}
      </ul>
      <div className="ts-quotes-track" aria-hidden>
        {[0, 1].map((copy) =>
          set.map((quote, i) => (
            <figure key={`${copy}-${i}-${quote.id}`} className="ts-quote">
              <p className="ts-quote-label ts-cursive">{quote.location ? `From ${quote.location}` : "From an operator"}</p>
              <p className="ts-quote-text">
                {quote.before}
                {quote.bold && <span className="ts-cursive">{quote.bold}</span>}
                {quote.after}
              </p>
              <figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mockFace(quote.name)} alt="" width={44} height={44} loading="lazy" />
                <span>
                  <strong>{quote.name}</strong>
                  {[quote.role, quote.fleetSize, quote.location].filter(Boolean).join(" · ")}
                </span>
              </figcaption>
            </figure>
          )),
        )}
      </div>
    </div>
  );
}
