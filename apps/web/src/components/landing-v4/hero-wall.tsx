"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, CalendarCheck, Play } from "lucide-react";

/*
 * Hero — copy on the left, a straight wall of operators, cars and the founder's
 * clips on the right. Each column alternates big and small tiles (offset from
 * its neighbours, so the wall has a rhythm) and loops slowly, alternately up
 * and down. The wall fades in at its top and at its edge next to the copy —
 * not at the bottom, and never over the middle. Scrolling parts the two halves
 * (copy left, wall right); the nav stays tucked away until the hero has gone.
 *
 * Numbers in the copy: 24/7 booking and the cheapest plan's price (read from the
 * plan catalogue) are facts; the renter count (RENTERS_JOINED) is the team's
 * figure and still needs confirming. "Free 20-minute call" is the strategy-call
 * page's own offer.
 *
 * PLACEHOLDERS: the people on the wall (names, cities) are stand-ins like the
 * testimonials; replace them with real operators before go-live. The clips are
 * the founder's strategy-call videos cut to short loops (public/landing-v4/hero/).
 * The product screen recordings that used to be here showed the portal before
 * v2, so they are gone. The "Works with" row is the integrations Drive247 really
 * ships; swap in partner logos when there are some.
 */

type Size = "big" | "small";
type Tile =
  | { kind: "person"; src: string; name: string; place: string }
  | { kind: "video"; src: string; poster: string; label: string }
  | { kind: "photo"; src: string };

const H = "/landing-v4/hero";
const vid = (name: string, label: string): Tile => ({ kind: "video", src: `${H}/${name}.mp4`, poster: `${H}/${name}.webp`, label });
const photo = (src: string): Tile => ({ kind: "photo", src });
const person = (src: string, name: string, place: string): Tile => ({ kind: "person", src, name, place });

// Big tiles want sharp, portrait-friendly images; small ones take the cars and
// the two low-resolution portraits.
const BIGS: Tile[] = [
  person("/landing-v2/people/person-5.jpg", "Maya O.", "Los Angeles, CA"),
  photo(`${H}/about-interior.webp`),
  person("/landing-v2/people/person-1.jpg", "Daniel R.", "Miami, FL"),
  vid("founder-1", "Leaving the marketplace"),
  person("/landing-v2/people/person-3.jpg", "Rachel K.", "Portland, OR"),
  photo(`${H}/promo-early-bird.webp`),
  person("/landing-v2/people/person-2.jpg", "Sofia R.", "Las Vegas, NV"),
  vid("founder-2", "Who it's for"),
  person("/landing-v2/people/person-4.jpg", "Jonas W.", "Denver, CO"),
  person(`${H}/reviews-hero.webp`, "Hannah B.", "San Diego, CA"),
];
const SMALLS: Tile[] = [
  photo(`${H}/fleet-hero.webp`),
  person("/landing-v3/avatars/a5.webp", "Aisha B.", "Austin, TX"),
  photo(`${H}/about-hero.webp`),
  photo(`${H}/promo-ev-explorer.webp`),
  photo("/landing-v4/site/car1.webp"),
  photo(`${H}/promotions-hero.webp`),
  person("/landing-v3/avatars/a3.webp", "Priya S.", "Dallas, TX"),
  photo(`${H}/promo-business-class.webp`),
  photo(`${H}/contact-hero.webp`),
  photo(`${H}/promo-weekend-escape.webp`),
];

// 7 columns of 6 tiles, big and small in turn; even columns start big, odd ones
// small, so a big tile always sits beside a small one. Column c takes three of
// BIGS and SMALLS from c·7 on: neighbouring columns never share a tile, and the
// same face is at least two columns away from itself.
const COLUMNS: { t: Tile; size: Size }[][] = Array.from({ length: 7 }, (_, c) => {
  let b = 0;
  let m = 0;
  return Array.from({ length: 6 }, (_, k) =>
    (k + c) % 2 === 0
      ? { t: BIGS[(c * 7 + b++) % BIGS.length], size: "big" as const }
      : { t: SMALLS[(c * 7 + m++ + 5) % SMALLS.length], size: "small" as const },
  );
});

// UNVERIFIED — the figure the team asked for. Confirm it against real booking data
// before go-live: a public user count has to be true.
const RENTERS_JOINED = "12k+";

const PARTNERS = [
  // `wordmark` logos carry the name; the others are icons, so the name is set beside them
  { name: "Stripe", src: "/landing-v3/partners/stripe-wordmark.svg", wordmark: true },
  { name: "Bonzah", src: "/landing-v3/partners/bonzah-logo.svg", wordmark: true },
  { name: "BoldSign", src: "/landing-v3/partners/boldsign-logo.svg", wordmark: false },
  { name: "Twilio", src: "/landing-v3/partners/twilio-logo.svg", wordmark: false },
];

function TileView({ t, size, i }: { t: Tile; size: Size; i: number }) {
  const style = { ["--i" as string]: i };
  if (t.kind === "photo")
    return (
      <figure className={`hw-tile ${size}`} style={style}>
        <img src={t.src} alt="" />
      </figure>
    );
  if (t.kind === "video")
    return (
      <figure className={`hw-tile ${size} vid`} style={style}>
        <video src={t.src} poster={t.poster} muted loop playsInline preload="metadata" />
        <span className="hw-play">
          <Play />
        </span>
        <figcaption className="hw-bar">
          <span>
            <b>{t.label}</b>
            <small>Drive247</small>
          </span>
        </figcaption>
      </figure>
    );
  return (
    <figure className={`hw-tile ${size} who`} style={style}>
      <img src={t.src} alt="" />
      <figcaption className="hw-bar">
        <img className="av" src={t.src} alt="" />
        <span>
          <b>{t.name}</b>
          <small>{t.place}</small>
        </span>
      </figcaption>
    </figure>
  );
}

export function HeroWall({ fromPrice }: { fromPrice: number | null }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const videos = [...el.querySelectorAll("video")];
    const nav = document.querySelector(".l4-nav");

    // scroll parts the halves: 0 at the top, 1 once the hero has scrolled away
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const part = Math.min(1, Math.max(0, window.scrollY / (el.offsetHeight * 0.85)));
        el.style.setProperty("--part", reduce ? "0" : part.toFixed(4));
        // the nav comes down once the next section reaches the top
        nav?.classList.toggle("is-tucked", window.scrollY < el.offsetHeight - 80);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // each clip plays only while it is on screen (the loops carry two copies of every tile)
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting && !reduce) v.play().catch(() => {});
        else v.pause();
      }),
      { threshold: 0.01 },
    );
    videos.forEach((v) => io.observe(v));

    // The drift. Each track moves in whole device pixels only — at sub-pixel positions
    // the browser rounds a card's text and photo separately, so the names shook against
    // the pictures. A column loops one set (half its track) every 140s + c·14s, starts
    // part-way through its loop, and stops while the pointer is over it.
    const cols = [...el.querySelectorAll<HTMLElement>(".hw-col")].map((col, c) => {
      const s = { col, track: col.querySelector<HTMLElement>(".hw-track")!, up: c % 2 === 0, secs: 140 + c * 14, pos: 0, held: false, last: NaN };
      s.pos = [42, 85, 0][c % 3] / s.secs; // fraction of the loop already run
      col.addEventListener("pointerenter", () => (s.held = true));
      col.addEventListener("pointerleave", () => (s.held = false));
      return s;
    });
    let drift = 0;
    let prev = 0;
    let onScreen = true;
    const step = (now: number) => {
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      const dpr = window.devicePixelRatio || 1;
      for (const s of cols) {
        if (!s.held) s.pos = (s.pos + dt / s.secs) % 1;
        const loop = s.track.offsetHeight / 2;
        const y = Math.round((s.up ? -s.pos : s.pos - 1) * loop * dpr) / dpr;
        if (y !== s.last) {
          s.track.style.transform = `translate3d(0, ${y}px, 0)`;
          s.last = y;
        }
      }
      drift = onScreen ? requestAnimationFrame(step) : 0;
    };
    // run only while the hero is on screen
    const seen = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !drift && !reduce) {
        prev = 0;
        drift = requestAnimationFrame(step);
      }
    });
    if (reduce) step(0);
    else seen.observe(el);

    return () => {
      cancelAnimationFrame(drift);
      seen.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      nav?.classList.remove("is-tucked");
    };
  }, []);

  let n = 0;
  return (
    <section ref={ref} className="l4-hw" id="top" aria-label="Drive247 — rent more cars, get paid upfront, while you sleep">
      <div className="hw-wall" aria-hidden>
        <div className="hw-plane">
          {COLUMNS.map((col, c) => (
            // the column's tiles twice over, so the loop wraps without a seam
            <div className={`hw-col ${c % 2 ? "down" : "up"}`} key={c} style={{ ["--c" as string]: c }}>
              <div className="hw-track">
                {[0, 1].map((copy) => (
                  <div className="hw-set" key={copy}>
                    {col.map(({ t, size }, k) => (
                      <TileView key={k} t={t} size={size} i={copy ? 0 : n++} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hw-left">
        <img className="hw-logo" src="/logo-light.png" alt="Drive247" />
        <h1 className="hw-h">
          Rent more cars
          <br />
          Get paid upfront
          <br />
          <em>While you sleep</em>
        </h1>
        <p className="hw-lead">
          Your own booking website, driver ID checks, e-signed agreements, payments and lockbox handovers, in one portal
          that takes bookings around the clock.
        </p>
        <div className="hw-ctas">
          <a className="l4-btn primary lg" href="/strategy-call">
            Book a demo
            <ArrowRight size={16} />
          </a>
          <a className="l4-btn outline lg" href="#x-showcase">
            See the product
          </a>
        </div>
        <p className="hw-cta-note">
          <CalendarCheck size={15} />
          Free 20-minute call with our team
        </p>
        <dl className="hw-stats">
          <div>
            <dt>24/7</dt>
            <dd>Bookings on your own site</dd>
          </div>
          <div>
            <dt>{RENTERS_JOINED}</dt>
            <dd>Renters already booking with Drive247</dd>
          </div>
          {fromPrice != null ? (
            <div>
              <dt>${fromPrice}</dt>
              <dd>A month to get started</dd>
            </div>
          ) : null}
        </dl>
        <div className="hw-partners">
          <span>Works with</span>
          <div>
            {PARTNERS.map((p) => (
              <span className="p" key={p.name}>
                <img src={p.src} alt={p.wordmark ? p.name : ""} />
                {p.wordmark ? null : p.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
