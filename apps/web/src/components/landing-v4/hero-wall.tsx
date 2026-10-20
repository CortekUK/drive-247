"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Play } from "lucide-react";

/*
 * Hero — copy on the left, a wall of operators, cars and product clips on the
 * right, kept clear of the copy and fading in at its own left edge. Each
 * column is an endless loop, alternately scrolling up and down, so the wall
 * always looks busy. Scrolling parts the two halves — the copy slides left,
 * the wall slides right — and the nav stays tucked away until the hero has
 * scrolled past, then slides down from the top.
 *
 * Numbers in the copy: 24/7 booking and the cheapest plan's price (read from the
 * plan catalogue) are facts; the renter count (RENTERS_JOINED) is the team's
 * figure and still needs confirming.
 *
 * PLACEHOLDERS: the people on the wall (names, cities, fleet sizes) are stand-ins
 * like the testimonials; replace them with real operators before go-live. The
 * clips are the product's own screen recordings and the founder's strategy-call
 * videos, cut to short loops (public/landing-v4/hero/). The "Works with" row is
 * the integrations Drive247 really ships; swap in partner logos when there are some.
 */

type Tile =
  | { kind: "person"; src: string; name: string; place: string; stat: string; unit: string; shape: Shape }
  | { kind: "video"; src: string; poster: string; label: string; shape: Shape }
  | { kind: "photo"; src: string; shape: Shape };
type Shape = "tall" | "square" | "wide";

const H = "/landing-v4/hero";
const vid = (name: string, label: string, shape: Shape): Tile => ({ kind: "video", src: `${H}/${name}.mp4`, poster: `${H}/${name}.webp`, label, shape });
const photo = (name: string, shape: Shape): Tile => ({ kind: "photo", src: `${H}/${name}.webp`, shape });

const person = (src: string, name: string, place: string, stat: string, unit: string, shape: Shape): Tile => ({ kind: "person", src, name, place, stat, unit, shape });

// Every tile once. Columns draw from this in steps of 3, so column c holds the
// tiles at one residue mod 3 and its neighbours hold the other two — adjacent
// columns never share a tile. Videos sit at 0/12, 4/16 and 8/20 to land two in each class.
const POOL: Tile[] = [
  vid("website", "Booking website", "wide"), //            0
  person("/landing-v2/people/person-5.jpg", "Maya O.", "Los Angeles, CA", "14", "cars", "tall"),
  photo("fleet-hero", "square"),
  person("/landing-v2/people/person-1.jpg", "Daniel R.", "Miami, FL", "22", "cars", "tall"),
  vid("founder-1", "Leaving the marketplace", "tall"), //   4
  photo("promo-ev-explorer", "wide"),
  photo("about-hero", "square"),
  person("/landing-v2/people/person-3.jpg", "Rachel K.", "Portland, OR", "18", "cars", "tall"),
  vid("trax", "Trax AI", "wide"), //                        8
  photo("promo-early-bird", "tall"),
  person("/landing-v3/avatars/a5.webp", "Aisha B.", "Austin, TX", "11", "vans", "square"),
  photo("promotions-hero", "wide"),
  vid("renter", "Renter portal", "tall"), //               12
  photo("contact-hero", "square"),
  person("/landing-v2/people/person-2.jpg", "Sofia R.", "Las Vegas, NV", "16", "cars", "tall"),
  photo("promo-business-class", "wide"),
  vid("dashboard", "Dashboard", "wide"), //                16
  person("/landing-v2/people/person-4.jpg", "Jonas W.", "Denver, CO", "9", "EVs", "tall"),
  photo("about-interior", "square"),
  photo("reviews-hero", "wide"),
  vid("founder-2", "Who it's for", "tall"), //             20
  person("/landing-v3/avatars/a4.webp", "Tom L.", "Phoenix, AZ", "40", "cars", "square"),
  photo("promo-weekend-escape", "wide"),
  person("/landing-v3/avatars/a3.webp", "Priya S.", "Dallas, TX", "32", "cars", "square"),
];
const COLUMNS: Tile[][] = Array.from({ length: 7 }, (_, c) => Array.from({ length: 8 }, (_, k) => POOL[(c * 7 + k * 3) % POOL.length]));

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

function TileView({ t, i }: { t: Tile; i: number }) {
  const style = { ["--i" as string]: i };
  if (t.kind === "photo")
    return (
      <figure className={`hw-tile ${t.shape}`} style={style}>
        <img src={t.src} alt="" />
      </figure>
    );
  if (t.kind === "video")
    return (
      <figure className={`hw-tile ${t.shape} vid`} style={style}>
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
    <figure className={`hw-tile ${t.shape} who`} style={style}>
      <img src={t.src} alt="" />
      <figcaption className="hw-bar">
        <img className="av" src={t.src} alt="" />
        <span>
          <b>{t.name}</b>
          <small>{t.place}</small>
        </span>
        <span className="n">
          <b>{t.stat}</b>
          <small>{t.unit}</small>
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

    return () => {
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
                    {col.map((t, k) => (
                      <TileView key={k} t={t} i={copy ? 0 : n++} />
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
          <a className="l4-btn primary" href="/strategy-call">
            Book a demo
            <ArrowRight size={16} />
          </a>
          <a className="l4-btn outline" href="#x-showcase">
            See the product
          </a>
        </div>
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
