"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Caveat, Reenie_Beanie } from "next/font/google";
import { ArrowRight, Pause, Play, Volume2 } from "lucide-react";
import type { Testimonial } from "@/lib/testimonials-server";
import "./testimonial-wall.css";

/*
 * A real wall on the page's own background: polaroids and scraps of paper pegged along twine.
 *
 * WHAT MAY GO ON IT:
 *   Quotes   only what admins publish in `operator_testimonials`, signed by that name.
 *            A quote is never paired with a face: we have no photos of these operators.
 *   Photos   stock portraits (Ghulam's call, 2026-11-04), NOT customers, so they carry no
 *            names or first-person words: only unsigned notes on what Drive247 does. The
 *            line under the wall says they're illustrative. Swap in real operators when
 *            there are some, with their consent.
 *   Videos   real footage of the founder, labelled as the founder.
 */

const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pw-hand", display: "swap" });
const scrawl = Reenie_Beanie({ subsets: ["latin"], weight: "400", variable: "--font-pw-scrawl", display: "swap" });

type Item =
  /** `name` is for a real, consenting person only, never a stock model. */
  | { kind: "photo"; src: string; note: string; name?: string }
  | { kind: "video"; src: string; poster: string; note: string }
  | { kind: "quote"; quote: Testimonial };

const P = (src: string, note: string): Item => ({ kind: "photo", src, note });
const V = (slug: string, note: string): Item => ({
  kind: "video",
  src: `/landing-v4/testimonials/${slug}.mp4`,
  poster: `/landing-v4/testimonials/${slug}.webp`,
  note,
});

const STUDIO = "/landing-v2/people"; // Unsplash, see CREDITS.md there
const CANDID = "/landing-v4/hero/people";

const PHOTO = {
  a: P(`${STUDIO}/person-1.jpg`, "your bookings, on your own site"),
  b: P(`${STUDIO}/person-5.jpg`, "no more spreadsheets"),
  c: P(`${STUDIO}/person-2.jpg`, "deposit held, then released"),
  d: P(`${STUDIO}/person-4.jpg`, "one calendar. every car."),
  e: P(`${STUDIO}/person-3.jpg`, "signed before pickup"),
  f: P(`${CANDID}/p-4962731.webp`, "your brand, your customers"),
  g: P(`${CANDID}/p-7643836.webp`, "0% commission. really."),
  h: P(`${CANDID}/p-9032398.webp`, "reminders go out by themselves"),
  i: P(`${CANDID}/p-7261920.webp`, "weekend rates, set once"),
  j: P(`${CANDID}/p-6332572.webp`, "ask Trax who owes you"),
};

const VIDEO = {
  turo: V("founder-turo", "if your Turo account went tomorrow?"),
  own: V("founder-own-customers", "the customer isn't yours"),
  trust: V("founder-trust", "why renters trust your own site"),
  who: V("founder-who-for", "who we built this for"),
};

/** `null` is a slot for the next published quote; it closes up if there isn't one. */
const ROWS: (Item | null)[][] = [
  [PHOTO.a, null, VIDEO.turo, PHOTO.b, PHOTO.f, VIDEO.trust],
  [PHOTO.c, VIDEO.own, PHOTO.g, null, PHOTO.d, PHOTO.h],
  [VIDEO.who, PHOTO.e, PHOTO.i, null, PHOTO.j],
];

function buildRows(quotes: Testimonial[]): Item[][] {
  const left = [...quotes];
  const rows = ROWS.map((row) =>
    row.flatMap((slot): Item[] => {
      if (slot) return [slot];
      const quote = left.shift();
      return quote ? [{ kind: "quote", quote }] : [];
    }),
  );
  // Any quotes beyond the slots still go up, a row at a time.
  left.forEach((quote, i) => rows[i % rows.length].push({ kind: "quote", quote }));
  return rows;
}

/* Fixed, not random: the server and the browser have to draw the same wall. */
const TILTS = [-3.2, 2.4, -1.4, 3.6, -2.6, 1.6, -3.8, 2.8, -1.8, 3.1, -2.2, 1.2];
const SAG = 36; // px at the middle of a row, matching the path in <Twine>
const ROW_LEFT = 6;

function Twine() {
  return (
    <svg className="pw-twine" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden>
      <path className="pw-twine-cast" d="M0 6 Q500 78 1000 6" />
      <path className="pw-twine-line" d="M0 6 Q500 78 1000 6" />
    </svg>
  );
}

export function TestimonialWall({ testimonials }: { testimonials: Testimonial[] }) {
  const rows = buildRows(testimonials);
  const videos = rows.flat().filter((item) => item.kind === "video");

  const wall = useRef<HTMLDivElement>(null);
  const players = useRef(new Map<string, HTMLVideoElement>());
  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(false);
  // One clip moves at a time, silently, until someone clicks one for sound.
  const [active, setActive] = useState(0);
  const [sound, setSound] = useState(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(noMotion);
    if (noMotion) setStopped(true);
    const el = wall.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const current = videos[active]?.kind === "video" ? videos[active].src : null;
    players.current.forEach((player, src) => {
      const on = src === current && running && !stopped;
      player.muted = !(on && sound);
      if (on) void player.play().catch(() => {});
      else player.pause();
    });
    // `videos` is rebuilt each render from the same props, so its length stands in for it.
  }, [active, sound, stopped, running, videos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (src: string) => {
    const index = videos.findIndex((v) => v.kind === "video" && v.src === src);
    if (index === active && sound && !stopped) {
      setStopped(true);
      setSound(false);
      return;
    }
    setActive(index);
    setStopped(false);
    setSound(true);
  };

  const ended = () => {
    setSound(false);
    if (reduced) setStopped(true);
    else setActive((i) => (i + 1) % videos.length);
  };

  let turn = 0;

  return (
    <section id="testimonials" className={`pw-section ${hand.variable} ${scrawl.variable}`}>
      <div className="pw-head">
        <h2 className="pw-title font-medium tracking-tighter">Built for <span className="pw-brand">operators</span></h2>
        <p className="pw-sub">Notes from the people running on it, and from the team building it.</p>
      </div>

      <div ref={wall} className="pw-scroll" tabIndex={0} role="group" aria-label="Testimonials, photos and videos">
        <div className="pw-wall">
          {rows.map((row, r) => (
            <div key={r} className="pw-row">
              <Twine />
              {row.map((item, i) => {
                const x = (i + 0.5) / row.length;
                const style = {
                  "--pw-tilt": `${TILTS[turn++ % TILTS.length]}deg`,
                  "--pw-drop": `${ROW_LEFT + 4 * SAG * x * (1 - x)}px`,
                } as CSSProperties;

                return (
                  <div key={i} className="pw-slot" style={style}>
                    <div className="pw-hang">
                      <i className="pw-peg" aria-hidden />

                      {item.kind === "quote" && (
                        <blockquote className="pw-note">
                          <p>
                            {item.quote.before}
                            {item.quote.bold && <mark>{item.quote.bold}</mark>}
                            {item.quote.after}
                          </p>
                          <footer>
                            {item.quote.name}
                            {item.quote.location ? `, ${item.quote.location}` : ""}
                          </footer>
                        </blockquote>
                      )}

                      {item.kind === "photo" && (
                        <figure className="pw-pola">
                          <div className="pw-photo">
                            {/* Small, fixed and heavily filtered, so these skip the optimiser. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.src} alt="" loading="lazy" />
                          </div>
                          <figcaption>
                            {item.note}
                            {item.name && <small>{item.name}</small>}
                          </figcaption>
                        </figure>
                      )}

                      {item.kind === "video" && (() => {
                        const isActive = videos[active]?.kind === "video" && videos[active].src === item.src;
                        const playing = isActive && !stopped;
                        return (
                          <figure className="pw-pola is-video">
                            <button
                              type="button"
                              className="pw-photo"
                              aria-label={`${playing && sound ? "Stop" : "Play with sound"}: ${item.note}, from our founder`}
                              onClick={() => press(item.src)}
                            >
                              <video
                                ref={(el) => {
                                  if (el) players.current.set(item.src, el);
                                  else players.current.delete(item.src);
                                }}
                                src={item.src}
                                poster={item.poster}
                                muted
                                playsInline
                                preload="none"
                                onEnded={ended}
                              />
                              <span className="pw-badge" aria-hidden>
                                {playing && sound ? <Pause /> : playing ? <Volume2 /> : <Play />}
                              </span>
                            </button>
                            <figcaption>
                              {item.note}
                              <small>our founder</small>
                            </figcaption>
                          </figure>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="pw-small">Photos are illustrative.</p>

      <a href="/strategy-call" className="pw-link">
        See how Drive247 works for your fleet
        <ArrowRight aria-hidden />
      </a>
    </section>
  );
}
