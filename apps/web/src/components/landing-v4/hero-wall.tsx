"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, CalendarCheck } from "lucide-react";

/*
 * Hero — copy on the left, a straight wall of video testimonials on the right:
 * each card plays a person talking to camera (muted, looping) with their words,
 * name and city at the bottom. Each column alternates tall and short cards
 * (offset from its neighbours, so the wall has a rhythm) and loops slowly,
 * alternately up and down. The wall fades in at its top and at its edge next to
 * the copy — not at the bottom, and never over the middle. Scrolling parts the
 * two halves; the nav stays tucked away until the hero has gone.
 *
 * Numbers in the copy: 24/7 booking and the cheapest plan's price (read from the
 * plan catalogue) are facts; the renter count (RENTERS_JOINED) is the team's
 * figure and still needs confirming. "Free 20-minute call" is the strategy-call
 * page's own offer.
 *
 * PLACEHOLDERS: the clips are free-licence stock footage (Pexels) and the names,
 * cities and quotes are demo copy (PEOPLE below); swap in real customers' videos
 * and words before go-live. The "Works with" row is the integrations Drive247 really
 * ships; swap in partner logos when there are some.
 */

type Size = "big" | "small";
type Person = { id: string; name: string; place: string; quote: string };

const P = "/landing-v4/hero/people";
// Nine people, each a short silent loop of them talking to camera (Pexels, free
// licence) with a one-line testimonial. PLACEHOLDERS: the clips are stock footage
// and the names and words are demo copy — swap in real customers' videos and
// words before go-live.
const PEOPLE: Person[] = [
  { id: "4962731", name: "Chloe M.", place: "Austin, TX", quote: "I wake up to bookings that are already paid." },
  { id: "7261920", name: "Ryan P.", place: "Chicago, IL", quote: "The money lands upfront. No more chasing deposits." },
  { id: "5940726", name: "Emma R.", place: "Denver, CO", quote: "Every renter is ID-checked before they get the keys." },
  { id: "6332572", name: "Lukas B.", place: "Seattle, WA", quote: "My own booking site, my brand, no marketplace cut." },
  { id: "6965116", name: "Grace L.", place: "San Francisco, CA", quote: "Agreements get signed on their phone before pickup." },
  { id: "4994156", name: "Marcus J.", place: "Atlanta, GA", quote: "Lockbox pickups gave me my weekends back." },
  { id: "9032398", name: "Sofia D.", place: "Miami, FL", quote: "Renters book at 2am and I don't lift a finger." },
  { id: "7643836", name: "Kevin T.", place: "Houston, TX", quote: "Trax tells me what needs me first every morning." },
  { id: "8048247", name: "Jason L.", place: "Phoenix, AZ", quote: "Live in a week, taking direct bookings ever since." },
];

// 7 columns of 6 cards, tall and short in turn; even columns start tall, odd ones
// short, so a tall card always sits beside a short one. Column c starts c·4 into
// the list, so a face never sits next to itself, across or down.
const COLUMNS: { t: Person; size: Size }[][] = Array.from({ length: 7 }, (_, c) =>
  Array.from({ length: 6 }, (_, k) => ({
    t: PEOPLE[(c * 4 + k) % PEOPLE.length],
    size: (k + c) % 2 === 0 ? ("big" as const) : ("small" as const),
  })),
);

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

function TileView({ t, size, i }: { t: Person; size: Size; i: number }) {
  return (
    <figure className={`hw-tile ${size}`} style={{ ["--i" as string]: i }}>
      <video src={`${P}/p-${t.id}.mp4`} poster={`${P}/p-${t.id}.webp`} muted loop playsInline preload="none" />
      <figcaption className="hw-quote">
        <q>{t.quote}</q>
        <span>
          <b>{t.name}</b> · {t.place}
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
