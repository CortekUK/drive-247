"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import "./hero-stage.css";

/*
 * Six real screens of one rental business, with one booking running through them
 * on a loop: booked on the site, agreement signed, paid, site edited, results read.
 * The screens are captures of the v2 product; the moving overlays and the names in
 * them are demo content.
 */

const WINDOWS = [
  { id: "editor", label: "Website editor", src: "/v2/hero/editor", aspect: "1440 / 900" },
  { id: "agreements", label: "Agreements", src: "/v2/hero/agreements", aspect: "1168 / 640", bottom: true },
  { id: "site", label: "yourrentals.com", src: "/v2/site-main", aspect: "1917 / 992" },
  { id: "booking", label: "Booking flow", src: "/v2/hero-booking", aspect: "1440 / 828" },
  { id: "dashboard", label: "Dashboard", src: "/v2/hero/dashboard", aspect: "1440 / 900" },
  { id: "marketing", label: "Marketing", src: "/v2/hero/marketing", aspect: "1168 / 660" },
  { id: "insights", label: "Insights", src: "/v2/slide-revenue", aspect: "1917 / 992" },
  { id: "fleet", label: "Fleet", src: "/v2/slide-fleet", aspect: "1917 / 992" },
  { id: "renter", label: "Renter portal", src: "/v2/phone-renter", aspect: "390 / 844" },
] as const;

export function HeroStage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const q = gsap.utils.selector(el);
    const stage = q(".hs-stage")[0] as HTMLElement;
    const win = (id: string) => q(`.hs-${id}`)[0] as HTMLElement;
    const pick = (id: string) => q(`[data-h="${id}"]`)[0] as HTMLElement;

    let tl: gsap.core.Timeline | null = null;
    let onScreen = true;

    const build = () => {
      tl?.kill();
      const overlays = q(".hs-ov");
      const ink = q(".hs-sheet path")[0];
      const hidden = { autoAlpha: 0, y: 12 };
      const shown = { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" };

      gsap.set(overlays, hidden);
      gsap.set(ink, { strokeDashoffset: 1 });

      const t = gsap.timeline({ repeat: -1, repeatDelay: 0.4, defaults: { ease: "power2.inOut" } });
      const active = (id: string | null) =>
        t.call(() => {
          for (const w of WINDOWS) win(w.id).dataset.active = String(w.id === id);
        });
      const hold = (duration: number) => t.to({}, { duration });

      // 1. The customer books on the site, and it reaches the operator's requests
      active("site");
      hold(0.9);
      active("dashboard");
      t.to(pick("request"), shown);
      hold(1);

      // 2. Signed on the customer's phone, and the agreements list follows
      active("renter");
      t.to(pick("sheet"), shown);
      t.to(ink, { strokeDashoffset: 0, duration: 1, ease: "none" });
      active("agreements");
      t.to(pick("signed"), shown);
      hold(1);

      // 3. Paid, and the operator takes over
      active("dashboard");
      t.to(pick("paid"), shown);
      hold(1.2);

      // 4. The operator changes the site
      active("editor");
      t.to(pick("editor-head"), shown);
      hold(0.9);
      t.to(pick("published"), shown);
      hold(1);

      // 5. And reads the results
      active("marketing");
      t.to(pick("funnel"), shown);
      hold(1.8);

      // Clear the desk for the next booking
      active(null);
      t.to(overlays, { autoAlpha: 0, duration: 0.25, ease: "power2.in" });
      t.set(ink, { strokeDashoffset: 1 });
      t.set(overlays, { y: 12 });

      if (!onScreen) t.pause();
      tl = t;
    };

    // Images give the windows their size, so build once they have laid out.
    build();

    // Each screen drifts slowly on its own beat, so the desk never sits dead still.
    const drift = WINDOWS.map((w, i) =>
      gsap.to(win(w.id), {
        y: i % 2 ? 4 : -4,
        duration: 3.2 + i * 0.45,
        delay: 1 + i * 0.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      }),
    );
    const seen = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) tl?.play();
      else tl?.pause();
      drift.forEach((d) => (onScreen ? d.play() : d.pause()));
    });
    seen.observe(stage);

    let timer: ReturnType<typeof setTimeout>;
    const size = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(build, 200);
    });
    size.observe(stage);

    return () => {
      clearTimeout(timer);
      size.disconnect();
      seen.disconnect();
      tl?.kill();
      drift.forEach((d) => d.kill());
    };
  }, []);

  return (
    <section ref={root} className="hs-hero">
      <div className="hs-copy">
        {children}
      </div>

      <div className="hs-stage" role="img" aria-label="Drive247 screens working together: website editor, dashboard, marketing, insights, fleet, agreements, booking site and renter portal">
        <div className="hs-desk">
        {WINDOWS.map((w) => (
          <div key={w.id} className={`hs-win hs-${w.id}${w.id === "renter" ? " is-phone" : ""}`}>
            <div className="hs-bar">{w.label}</div>
            <div className="hs-shot">
              <div className={`hs-pic${"bottom" in w ? " at-bottom" : ""}`} style={{ aspectRatio: w.aspect }}>
              <Image src={`${w.src}.png`} alt="" fill sizes="(max-width: 767px) 70vw, 45vw" className="dark:hidden" priority={w.id === "dashboard" || w.id === "booking"} />
              <Image src={`${w.src}-dark.png`} alt="" fill sizes="(max-width: 767px) 70vw, 45vw" className="hidden dark:block" />

              {w.id === "dashboard" && (
                <>
                  <div data-h="request" className="hs-ov hs-row" style={{ left: "46.5%", top: "42%", width: "25%" }}>
                    <b>Maya Patel</b>
                    <span className="hs-tag">Booking</span>
                  </div>
                  <div data-h="paid" className="hs-ov hs-row" style={{ left: "3%", top: "50%" }}>
                    <span className="hs-good">Payment received</span>
                    <b>$412.00</b>
                  </div>
                </>
              )}

              {w.id === "agreements" && (
                <div data-h="signed" className="hs-ov hs-row" style={{ left: "2%", right: "32%", top: "72%" }}>
                  <b>Maya Patel</b>
                  <span className="hs-good">Signed</span>
                </div>
              )}

              {w.id === "renter" && (
                <div data-h="sheet" className="hs-ov hs-sheet">
                  <b>Rental agreement</b>
                  <svg viewBox="0 0 120 30" fill="none" aria-hidden>
                    <path pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1 }} d="M6 20c8-14 12-16 14-10s-4 14 2 10 8-12 12-8-2 10 4 8 8-8 12-6 2 8 8 6 12-8 18-6 8 4 34 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              )}

              {w.id === "editor" && (
                <>
                  <div data-h="editor-head" className="hs-ov hs-outline" style={{ left: "22.5%", top: "38%", width: "33%", height: "16%" }} />
                  <div data-h="published" className="hs-ov hs-row" style={{ left: "58%", top: "14%" }}>
                    <span className="hs-good">Published</span>
                  </div>
                </>
              )}

              {w.id === "marketing" && <div data-h="funnel" className="hs-ov hs-outline" style={{ left: "27%", top: "22%", width: "21.8%", height: "23%" }} />}
              </div>
            </div>
          </div>
        ))}
        </div>
        <div className="hs-veil" />

      </div>
    </section>
  );
}
