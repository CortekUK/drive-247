import { Button } from "@/components/ui/button";
import Image from "next/image";
import "./hero.css";

/* `crop` is a close-up of one card: picture width, then its shift as a share of itself. */
type Screen = { label: string; src: string; crop?: { width: string; shift: string } };
type Column = { shape: "wide" | "square" | "phone"; screens: Screen[] };

/* A mix of shapes: wide screens, stacked pairs, a phone and close-ups of one card. */
const COLUMNS: Column[] = [
  { shape: "wide", screens: [{ label: "Dashboard", src: "/v2/hero/dashboard" }] },
  {
    shape: "square",
    screens: [
      { label: "Agreements", src: "/v2/hero/agreements" },
      { label: "Insights", src: "/v2/slide-revenue" },
    ],
  },
  { shape: "phone", screens: [{ label: "Renter portal", src: "/v2/phone-renter" }] },
  { shape: "wide", screens: [{ label: "Website editor", src: "/v2/hero/editor" }] },
  { shape: "square", screens: [{ label: "Requests", src: "/v2/hero/dashboard", crop: { width: "370%", shift: "-47.2%, -37.6%" } }] },
  { shape: "wide", screens: [{ label: "Marketing", src: "/v2/hero/marketing" }] },
  {
    shape: "square",
    screens: [
      { label: "Fleet", src: "/v2/slide-fleet" },
      { label: "Booking flow", src: "/v2/hero-booking" },
    ],
  },
  { shape: "wide", screens: [{ label: "Your booking site", src: "/v2/site-main" }] },
  { shape: "square", screens: [{ label: "Your business today", src: "/v2/hero/dashboard", crop: { width: "370%", shift: "-19.2%, -37.6%" } }] },
];

export function Hero() {
  return (
    <section className="hg-hero">
      <div className="hg-grid" aria-hidden />

      {/* The white-lettered logo in both themes: the top of the hero is always midnight. */}
      <div className="hg-top">
        <a href="/" className="hg-logo" aria-label="Drive247 home">
          <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} priority />
        </a>
        <nav className="hg-nav" aria-label="Get started">
          <Button asChild size="sm" className="hg-ghost">
            <a href="/strategy-call">Book a demo</a>
          </Button>
          <Button asChild size="sm" className="hg-primary">
            <a href="#pricing">Start free trial</a>
          </Button>
        </nav>
      </div>

      <div className="hg-copy">
        <h1 className="hg-title font-medium tracking-tighter text-white">
          Your whole rental business.
        </h1>

        <p className="hg-sub text-base leading-relaxed text-white/85 sm:text-lg">
          Your booking site, agreements, payments and marketing, working together. No more spreadsheets, chasing signatures or waiting on a developer.
        </p>
      </div>

      {/* Real screens, edge to edge. The set is doubled so the loop has no seam. */}
      <div className="hg-marquee" role="img" aria-label="Drive247 screens: dashboard, agreements, insights, renter portal, website editor, requests, marketing, fleet, booking flow and booking site">
        <div className="hg-track">
          {[0, 1].map((set) => (
            <div key={set} className="hg-set">
              {COLUMNS.map((column, i) => (
                <div key={i} className={`hg-col is-${column.shape}`}>
                  {column.screens.map((s) => (
                    <div key={s.label} className="hg-tile">
                      <p>{s.label}</p>
                      <div className="hg-shot">
                        {s.crop ? (
                          <div className="hg-crop" style={{ width: s.crop.width, transform: `translate(${s.crop.shift})` }}>
                            <Image src={`${s.src}.png`} alt="" fill sizes="130vw" className="dark:hidden" />
                            <Image src={`${s.src}-dark.png`} alt="" fill sizes="130vw" className="hidden dark:block" />
                          </div>
                        ) : (
                          <>
                            <Image src={`${s.src}.png`} alt="" fill sizes="(max-width: 767px) 80vw, 45vw" className="dark:hidden" />
                            <Image src={`${s.src}-dark.png`} alt="" fill sizes="(max-width: 767px) 80vw, 45vw" className="hidden dark:block" />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
