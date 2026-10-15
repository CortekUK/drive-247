"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  Bell,
  Calendar,
  Car,
  Check,
  ChevronsUpDown,
  CirclePlus,
  CreditCard,
  Crown,
  EllipsisVertical,
  FileText,
  Gauge,
  Info,
  KeyRound,
  Lock,
  Maximize2,
  MessageCircle,
  MessageSquare,
  Play,
  Puzzle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import "./hero-247-tour.css";

/*
 * Hero · 24/7 tour — the landing v2 hero, ported from Claude Design
 * (`ui_kits/landing/Hero 24-7 Tour.html`). Markup, copy, data and the GSAP
 * choreography are the design file's; only the plumbing changed:
 *
 *   - the design's default tweaks are baked in (step mode, full 8-stop tour,
 *     speed 1); the Tweaks panel is a design-tool control and is not shipped;
 *   - lucide's CDN script is replaced by the same icons from lucide-react, and
 *     GSAP comes from npm. Lenis and ScrollTrigger only served the "free
 *     scroll" tweak, so they are not loaded;
 *   - ids are prefixed `h247-` and every GSAP selector is scoped to this
 *     section (gsap.context), so nothing reaches into the rest of the page;
 *   - the design was a one-screen document, so it locked the whole page and
 *     took every wheel tick. Here the hero only steps while the page is at the
 *     top: scrolling past the last stop ("Start") hands the wheel back to the
 *     page, and scrolling back up to the top steps backwards through the tour.
 */

const STEPS: ReadonlyArray<readonly [string, number]> = [
  ["Car", 0],
  ["Split", 1.25],
  ["Portal", 3.7],
  ["Revenue", 4.75],
  ["Trax", 6.05],
  ["Requests", 7.35],
  ["To do", 8.65],
  ["Start", 10.4],
];
const STOPS: ReadonlyArray<readonly [string, number]> = [
  ["#h247-cRev", 4.0],
  ["#h247-cTrax", 5.3],
  ["#h247-cReq", 6.6],
  ["#h247-cTodo", 7.9],
];
const CARDS = ["#h247-cRev", "#h247-cFeat", "#h247-cTrax", "#h247-cReq", "#h247-cTodo"];

const RQ = [
  ["Maya Okafor", "M", "#5b5bd6", "Booking", "#ece9fb", "#442DD7", "Wants the Tesla Model 3 · Fri 17 Oct – Tue 21 Oct", "5h"],
  ["Daniel Reyes", "D", "#f76b15", "Extension", "#fdf3e7", "#b45309", "Keep the Lexus RX 350 until Sun 19 Oct", "2h"],
  ["Priya Shah", "P", "#8e4ec6", "Booking", "#ece9fb", "#442DD7", "Wants the BMW 3 Series · Sat 18 Oct – Mon 20 Oct", "48m"],
  ["Tom Lindqvist", "T", "#0090ff", "Cancellation", "#fdeceb", "#d93025", "Cancel the Audi Q5 · “Flight moved”", "12m"],
] as const;

const TD = [
  ["Call Jonas about the X5 return", "Rental R-1041", "Today", "var(--wait)"],
  ["Renew insurance on LK21 XYZ", "Expires Fri 24 Oct", "Fri", "var(--mu)"],
  ["Approve Maya’s booking", "", "Today", "var(--wait)"],
  ["Send October owner payouts", "", "", ""],
] as const;

const CAPS = [
  ["01 · MONEY", "Revenue you can actually trust.", "Only money collected counts — drawn against last month, with the next 7 days forecast."],
  ["02 · TRAX AI", "A morning brief, written for you.", "Trax reads every booking, payment and return — then tells you what needs you today."],
  ["03 · REQUESTS", "Every request, oldest first.", "Bookings, extensions and cancellations in one queue, with how long each has waited."],
  ["04 · TO DO", "Nothing slips through.", "Late returns and expiring insurance become tasks automatically. Tick them off."],
] as const;

/* Revenue chart — the design's series and geometry, computed once. */
const P = [0, 180, 420, 520, 780, 1100, 1240, 1600, 1890, 2050, 2400, 2900, 3300, 3480, 3900, 4400, 4720, 5100, 5600, 6050, 6400, 6900, 7400, 8000, 8600, 9100, 9900, 10600, 11500, 12480];
const PV = P.map((v, i) => v * 0.8 + Math.sin(i * 1.3) * 140);
const FC = [12480, 12950, 13400, 13900, 14300, 14800, 15400];
const CW = 620;
const CH = 150;
const CM = 16000;
const cx = (i: number) => (i / 36) * CW;
const cy = (v: number) => CH - (v / CM) * CH + 6;
const ln = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${cy(v).toFixed(1)}`).join(" ");
const PATH_P = ln(P);
const PATH_PV = ln(PV);
const PATH_FC = FC.map((v, i) => `${i ? "L" : "M"}${cx(i + 29).toFixed(1)},${cy(v).toFixed(1)}`).join(" ");

export function Hero247Tour() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
    const $$ = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const win = $("#h247-win");
    const car = $("#h247-car");
    const num = $("#h247-num");
    const copy = $("#h247-copy");
    const skip = $("#h247-skip");
    const prog = $("#h247-prog");
    const capF = $("#h247-capF");
    const openEl = $("#h247-open");
    const sheenEl = $("#h247-sheen");
    const railButtons = $$(".rail button");

    const cleanups: Array<() => void> = [];
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    const sheen = () => {
      sheenEl.classList.remove("go");
      void sheenEl.offsetWidth;
      sheenEl.classList.add("go");
    };
    const openCount = () => {
      openEl.textContent = `${$$(".td:not(.dn)").length} open`;
    };

    /* dashboard interactions */
    $$(".td").forEach((t) =>
      on(t, "click", () => {
        t.classList.toggle("dn");
        t.dataset.user = "1";
        openCount();
      }),
    );
    const items = $$(".it");
    items.forEach((it) => on(it, "click", () => items.forEach((x) => x.classList.toggle("on", x === it))));

    /* layout */
    let K = 1;
    const layout = () => {
      const top = 96;
      const bot = 110;
      K = Math.min((innerWidth * 0.84) / 1280, (innerHeight - top - bot) / 800);
      win.style.top = `${top + (innerHeight - top - bot) / 2}px`;
    };
    const carDY = () => innerHeight * 0.5 - (car.offsetTop + car.offsetHeight * 0.5) + innerHeight * 0.02;
    const rel = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      let node: HTMLElement | null = el;
      while (node && node !== win) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return { x, y };
    };
    const aim = (sel: string, S: number, f = 0.7) => {
      const el = $(sel);
      const r = rel(el);
      const ex = r.x + el.offsetWidth / 2 - 640;
      const ey = r.y + el.offsetHeight / 2 - 400;
      return { x: -ex * K * S * f, y: -ey * K * S * f };
    };

    /* state that follows the timeline */
    const nearest = (t: number) => {
      let k = 0;
      STEPS.forEach(([, T], i) => {
        if (t >= T - 0.05) k = i;
      });
      return k;
    };
    const rail = (t: number) => {
      const k = nearest(t);
      railButtons.forEach((b, i) => b.classList.toggle("on", i === k));
    };
    let lastPhase = -1;
    const state = (t: number) => {
      let act = -1;
      STOPS.forEach(([, T], i) => {
        if (t >= T + 0.25 && t < T + 1.05) act = i;
      });
      if (t >= 9.1) act = -1;
      CARDS.forEach((s) => {
        const el = $(s);
        el.classList.toggle("hl", act >= 0 && s === STOPS[act][0]);
        el.classList.toggle("dim", act >= 0 && s !== STOPS[act][0]);
      });
      $$(".rw").forEach((r, i) => r.classList.toggle("hl", act === 2 && t >= 6.9 + i * 0.18 && t < 7.07 + i * 0.18));
      const td = $$(".td")[2];
      if (!td.dataset.user) {
        td.classList.toggle("dn", t >= 8.35);
        openCount();
      }
      const ph = t < 1 ? 0 : t < 9.4 ? 1 : 2;
      if (ph !== lastPhase) {
        lastPhase = ph;
        capF.classList.toggle("is-on", ph === 2);
      }
      const show = t > 2.4 && t < 9.2;
      skip.style.opacity = show ? "1" : "0";
      skip.style.pointerEvents = show ? "auto" : "none";
      copy.style.pointerEvents = t > 0.3 ? "none" : "auto";
      root.classList.toggle("open", t > 0.75);
      prog.style.transform = `scaleX(${t / 10.4})`;
      rail(t);
    };

    /* choreography */
    const cnt = { v: 0 };
    let tl!: gsap.core.Timeline;
    let ctx!: gsap.Context;
    const build = () => {
      ctx = gsap.context(() => {
        gsap.set(car, { xPercent: -50 });
        gsap.set(win, { transformPerspective: 2200 });
        gsap.set(["#h247-tb", "#h247-sb .org", "#h247-sb .sw", "#h247-sb .it", "#h247-sb .sep", "#h247-sb .live"], {
          opacity: 0,
          y: 10,
        });
        gsap.set(CARDS, { opacity: 0, y: 24 });
        gsap.set([".rw", ".td", ".trx .ln", ".chips"], { opacity: 0, x: -10 });
        tl = gsap.timeline({ paused: true, onUpdate: () => state(tl.time()) });
        /* 1 · 24/7 separates, car takes centre */
        tl.to("#h247-copy h1", { opacity: 0, y: -30, duration: 0.55, ease: "power2.in" }, 0)
          .to("#h247-copy p", { opacity: 0, y: -18, duration: 0.5, ease: "power2.in" }, 0.04)
          .to("#h247-copy .ctas", { opacity: 0, y: -10, duration: 0.45, ease: "power2.in" }, 0.08)
          .to(["#h247-cone", "#h247-pool"], { opacity: 0, duration: 0.6 }, 0);
        tl.to("#h247-doorL", { xPercent: -64, duration: 1.25, ease: "power3.inOut" }, 0.1)
          .to("#h247-doorR", { xPercent: 64, duration: 1.25, ease: "power3.inOut" }, 0.1)
          .to(".vig", { opacity: 0, duration: 0.8, ease: "none" }, 0.35)
          .to(car, { y: carDY, scale: 1.06, duration: 1.1, ease: "power2.inOut" }, 0.1)
          .add(sheen, 0.8);
        /* 2 · the portal opens out of the car */
        tl.to(car, { scale: 0.34, y: () => carDY() + 40, opacity: 0, duration: 0.9, ease: "power2.in" }, 1.3).fromTo(
          win,
          { opacity: 0, scale: () => K * 0.32, rotateX: 22, borderRadius: 60 },
          { opacity: 1, scale: () => K, rotateX: 0, borderRadius: 24, duration: 1.15, ease: "power3.out" },
          1.45,
        );
        /* 3 · panel builds */
        tl.to("#h247-tb", { opacity: 1, y: 0, duration: 0.3 }, 2.2)
          .to(["#h247-sb .org", "#h247-sb .sw", "#h247-sb .it", "#h247-sb .sep", "#h247-sb .live"], {
            opacity: 1,
            y: 0,
            stagger: 0.03,
            duration: 0.25,
          }, 2.2)
          .to("#h247-cRev", { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 2.35)
          .fromTo(
            cnt,
            { v: 0 },
            {
              v: 12480,
              duration: 0.9,
              ease: "power2.out",
              onUpdate: () => {
                num.textContent = `$${Math.round(cnt.v).toLocaleString("en-US")}`;
              },
            },
            2.45,
          )
          .to("#h247-l1", { strokeDashoffset: 0, duration: 0.9, ease: "none" }, 2.5)
          .to(["#h247-area", "#h247-lp"], { opacity: 1, duration: 0.5 }, 2.8)
          .to(["#h247-lf", "#h247-dot"], { opacity: 1, duration: 0.3 }, 3.3)
          .to("#h247-cFeat", { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 2.55)
          .to(["#h247-cTrax", "#h247-cReq", "#h247-cTodo"], { opacity: 1, y: 0, stagger: 0.12, duration: 0.4, ease: "power2.out" }, 2.75)
          .to([".trx .ln", ".chips"], { opacity: 1, x: 0, stagger: 0.05, duration: 0.22 }, 3.0)
          .to(".rw", { opacity: 1, x: 0, stagger: 0.06, duration: 0.22 }, 3.1)
          .to(".td", { opacity: 1, x: 0, stagger: 0.06, duration: 0.22 }, 3.2);
        /* 4 · guided stops */
        STOPS.forEach(([s, T], i) => {
          const S = i === 0 ? 1.12 : 1.2;
          tl.to(win, { x: () => aim(s, S).x, y: () => aim(s, S).y, scale: () => K * S, duration: 0.6, ease: "power2.inOut" }, T)
            .fromTo(`#h247-cap${i}`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, T + 0.3)
            .to(`#h247-cap${i}`, { opacity: 0, y: -12, duration: 0.25 }, T + 1.05);
        });
        /* 5 · settle + CTA */
        tl.to(win, { x: 0, y: 0, scale: () => K * 0.94, duration: 0.7, ease: "power2.inOut" }, 9.1)
          .fromTo("#h247-capF", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.35 }, 9.45)
          .to({}, { duration: 0.6 }, 9.8);
      }, root);
    };

    /* step mode — a critically-damped spring chases the target time, so every
       move eases in and out and can be redirected mid-flight */
    const LAST = STEPS.length - 1;
    let idx = 0;
    let target = 0;
    let vel = 0;
    let maxV: number | null = null;
    let lastWheel = 0;
    const stepTo = (i: number, cap?: number) => {
      idx = Math.max(0, Math.min(LAST, i));
      target = STEPS[idx][1];
      maxV = cap || null;
      if (reduce) {
        tl.time(target);
        vel = 0;
      }
    };
    const tick = (_time: number, dt: number) => {
      if (reduce) return;
      const x = tl.time();
      const d = target - x;
      if (Math.abs(d) < 0.0005 && Math.abs(vel) < 0.0005) {
        if (x !== target) tl.time(target);
        vel = 0;
        return;
      }
      const w = 5.2;
      const h = Math.min(dt, 50) / 1000;
      vel += (w * w * d - 2 * w * vel) * h;
      const lim = maxV || 2.6;
      vel = Math.max(-lim, Math.min(lim, vel));
      tl.time(Math.max(0, Math.min(tl.duration(), x + vel * h)));
    };
    gsap.ticker.add(tick);
    cleanups.push(() => gsap.ticker.remove(tick));

    const next = () => {
      if (idx - nearest(tl.time()) < 2) stepTo(idx + 1);
    };
    const prev = () => {
      if (nearest(tl.time()) - idx < 2) stepTo(idx - 1);
    };

    /* The hero owns the wheel only while the page is at the top, and hands it
       back once the tour has landed on its last stop. */
    const atTop = () => window.scrollY <= 1;
    const atEnd = () => idx === LAST && Math.abs(tl.time() - STEPS[LAST][1]) < 0.05;

    on(
      window,
      "wheel",
      (e) => {
        if (!atTop()) return;
        if (e.deltaY > 0 && atEnd()) return;
        e.preventDefault();
        const now = performance.now();
        const gap = now - lastWheel;
        lastWheel = now;
        if (Math.abs(e.deltaY) < 4 || gap < 180) return;
        if (e.deltaY > 0) next();
        else prev();
      },
      { passive: false },
    );
    let ty: number | null = null;
    on(window, "touchstart", (e) => {
      ty = e.touches[0].clientY;
    }, { passive: true });
    on(
      window,
      "touchmove",
      (e) => {
        if (!atTop() || ty == null) return;
        if (ty - e.touches[0].clientY > 0 && atEnd()) return;
        e.preventDefault();
      },
      { passive: false },
    );
    on(window, "touchend", (e) => {
      if (ty == null) return;
      const dy = ty - e.changedTouches[0].clientY;
      ty = null;
      if (!atTop() || Math.abs(dy) < 40) return;
      if (dy > 0) {
        if (!atEnd()) next();
      } else prev();
    });
    on(window, "keydown", (e) => {
      const el = e.target as HTMLElement;
      if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) || !atTop()) return;
      if (e.key === " " && /BUTTON|A/.test(el.tagName)) return;
      if (["ArrowDown", "PageDown", " "].includes(e.key)) {
        if (atEnd()) return;
        e.preventDefault();
        next();
      }
      if (["ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        prev();
      }
      if (e.key === "Home") {
        e.preventDefault();
        stepTo(0);
      }
      if (e.key === "End" && !atEnd()) {
        e.preventDefault();
        stepTo(LAST);
      }
    });

    const toEnd = () => stepTo(LAST, 1.15);
    const toStart = () => stepTo(0, 4);
    let replayTimer: ReturnType<typeof setTimeout> | undefined;
    on($("#h247-tour"), "click", toEnd);
    on($("#h247-replay"), "click", () => {
      vel = 0;
      tl.time(0);
      idx = 0;
      target = 0;
      clearTimeout(replayTimer);
      replayTimer = setTimeout(toEnd, 250);
    });
    on(skip, "click", toStart);
    railButtons.forEach((b, i) => on(b, "click", () => stepTo(i)));

    const settle = (cur: number) => {
      tl.time(cur);
      idx = nearest(cur);
      target = STEPS[idx][1];
      vel = 0;
      rail(cur);
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    on(window, "resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const cur = tl.time();
        ctx.revert();
        layout();
        build();
        settle(cur);
      }, 150);
    });

    layout();
    build();
    settle(0);
    state(0);

    return () => {
      clearTimeout(resizeTimer);
      clearTimeout(replayTimer);
      cleanups.forEach((fn) => fn());
      ctx.revert();
    };
  }, []);

  return (
    <section ref={rootRef} className="h247" id="hero" data-screen-label="Hero 24/7 tour">
      <div className="prog" id="h247-prog" />
      <div className="L stage" />
      <div className="L door dl" id="h247-doorL">
        <div className="tt">
          <span>24</span>
          <span>/7</span>
        </div>
      </div>
      <div className="L door dr" id="h247-doorR">
        <div className="tt">
          <span>24</span>
          <span>/7</span>
        </div>
      </div>
      <div className="L cone" id="h247-cone" />
      <div className="L pool" id="h247-pool" />
      <div className="car" id="h247-car">
        {/* eslint-disable-next-line @next/next/no-img-element -- sized and masked by the design's CSS */}
        <img className="main" src="/landing-v2/hero-car.webp" alt="Black luxury SUV" />
        <div className="msk tint" />
        <div className="msk sheen" id="h247-sheen" />
        <div className="shade" />
        {/* eslint-disable-next-line @next/next/no-img-element -- the reflection */}
        <img className="ref" src="/landing-v2/hero-car.webp" alt="" />
      </div>

      <div className="win" id="h247-win">
        <div className="wbar">
          <i />
          <i />
          <i />
          <div className="url">
            <Lock />
            northwind.portal.drive-247.com
          </div>
        </div>
        <div className="app">
          <aside className="sb" id="h247-sb">
            <div className="org it-x">
              <i className="l">N</i>Northwind Rentals
              <ChevronsUpDown />
            </div>
            <div className="sw">
              <span className="on">
                Portal<kbd>⌥1</kbd>
              </span>
              <span>
                Website<kbd>⌥2</kbd>
              </span>
            </div>
            <div className="it on">
              <Gauge />
              Dashboard
            </div>
            <div className="it">
              <Puzzle />
              Integrations
            </div>
            <div className="it">
              <Crown />
              Billing
            </div>
            <div className="sep" />
            <div className="it">
              <Users />
              Customers
            </div>
            <div className="it">
              <Car />
              Vehicles
            </div>
            <div className="it">
              <KeyRound />
              Rentals
            </div>
            <div className="sep" />
            <div className="it">
              <Activity />
              Insights
            </div>
            <div className="it">
              <ShieldCheck />
              Insurances
            </div>
            <div className="it">
              <FileText />
              Agreements
            </div>
            <div className="it">
              <Calendar />
              Availability
            </div>
            <div className="it">
              <CreditCard />
              Finances
            </div>
            <div className="it">
              <MessageSquare />
              Support<em>2</em>
            </div>
            <div className="live">
              <Zap />
              Live
            </div>
          </aside>
          <div className="mn">
            <div className="tb" id="h247-tb">
              <div className="srch">
                <Search />
                Search bookings, customers, vehicles…<kbd>⌘K</kbd>
              </div>
              <span className="sp" />
              <span className="hp">
                <Sparkles />
                Help
              </span>
              <span className="ib">
                <MessageCircle />
              </span>
              <span className="ib">
                <Bell />
              </span>
              <span className="av">IG</span>
            </div>
            <div className="g1">
              <div className="cd rev" id="h247-cRev">
                <div className="hdr">
                  <span className="ey">Revenue · last 30 days</span>
                  <Info />
                  <span className="r">
                    <EllipsisVertical />
                  </span>
                </div>
                <div className="big">
                  <b id="h247-num">$12,480</b>
                  <span>collected</span>
                  <em>↑ 18% on the 30 days before</em>
                </div>
                <div className="chart">
                  <svg viewBox={`0 0 ${CW} ${CH + 12}`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="h247-fa" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#442DD7" stopOpacity=".16" />
                        <stop offset="1" stopColor="#442DD7" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      id="h247-area"
                      d={`${PATH_P} L${cx(29)},${CH + 12} L0,${CH + 12}Z`}
                      fill="url(#h247-fa)"
                      opacity="0"
                    />
                    <path
                      id="h247-lp"
                      d={PATH_PV}
                      fill="none"
                      stroke="#8f85ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                      opacity="0"
                    />
                    <path
                      id="h247-l1"
                      d={PATH_P}
                      pathLength={1}
                      fill="none"
                      stroke="#442DD7"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
                    />
                    <path
                      id="h247-lf"
                      d={PATH_FC}
                      fill="none"
                      stroke="#442DD7"
                      strokeWidth="2"
                      strokeDasharray="1 5"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      opacity="0"
                    />
                    <g id="h247-dot" opacity="0">
                      <circle cx={cx(29)} cy={cy(12480)} r="9" fill="#442DD7" opacity=".16" />
                      <circle cx={cx(29)} cy={cy(12480)} r="4" fill="#442DD7" stroke="#fff" strokeWidth="2" />
                    </g>
                  </svg>
                </div>
                <div className="leg">
                  <span>— This period</span>
                  <span>- - The period before</span>
                  <span>··· Expected next 7 days</span>
                </div>
              </div>
              <div className="cd feat" id="h247-cFeat">
                <span className="ey">New</span>
                <h3>Lockbox handovers</h3>
                <p>Send the code by email or SMS the moment a rental starts — no one at the counter.</p>
                <a href="#">Set it up →</a>
                <i className="kb" />
              </div>
            </div>
            <div className="g2">
              <div className="cd" id="h247-cTrax">
                <div className="hdr">
                  <span className="ey">Your business today</span>
                  <span className="r">Trax</span>
                </div>
                <div className="trx">
                  <h4>A busy Tuesday — one late return needs a call.</h4>
                  <ul>
                    <li className="ln">
                      <i style={{ background: "var(--late)" }} />
                      Jonas Weber is 2h late returning the BMW X5.
                    </li>
                    <li className="ln">
                      <i style={{ background: "var(--wait)" }} />3 requests are waiting on you, the oldest for 5h.
                    </li>
                    <li className="ln">
                      <i />
                      $1,840 is due this week across 4 rentals.
                    </li>
                    <li className="ln">
                      <i />6 of 8 cars are out today.
                    </li>
                  </ul>
                  <div className="chips">
                    <span>Who owes me money?</span>
                    <span>Which cars are free Friday?</span>
                  </div>
                </div>
                <div className="foot">
                  Ask Trax
                  <ArrowRight />
                </div>
              </div>
              <div className="cd req" id="h247-cReq">
                <div className="hdr">
                  <span className="ey">Requests</span>
                  <span style={{ fontSize: 11, color: "#474747", fontWeight: 600 }}>4</span>
                  <span className="r">
                    <Maximize2 />
                  </span>
                </div>
                <ul className="rq">
                  {RQ.map((r) => (
                    <li className="rw" key={r[0]}>
                      <span className="av" style={{ background: r[2] }}>
                        {r[1]}
                      </span>
                      <span className="tx">
                        <span className="nm">
                          {r[0]}
                          <span className="tg" style={{ background: r[4], color: r[5] }}>
                            {r[3]}
                          </span>
                        </span>
                        <span className="as">{r[6]}</span>
                      </span>
                      <span className="wt">{r[7]}</span>
                    </li>
                  ))}
                </ul>
                <div className="foot">
                  See all requests
                  <ArrowRight />
                </div>
              </div>
              <div className="cd" id="h247-cTodo">
                <div className="hdr" style={{ paddingBottom: 6 }}>
                  <span className="ey">To do</span>
                  <span className="r" id="h247-open">
                    3 open
                  </span>
                </div>
                <div>
                  {TD.map((t, i) => (
                    <div className={`td${i === 3 ? " dn" : ""}`} data-i={i} key={t[0]}>
                      <span className="bx">
                        <Check />
                      </span>
                      <span className="t">
                        {t[0]}
                        {t[1] ? <small>{t[1]}</small> : null}
                      </span>
                      <span className="du" style={{ color: t[3] || undefined }}>
                        {t[2]}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="foot" style={{ justifyContent: "flex-start", gap: 10, color: "var(--mu)" }}>
                  <CirclePlus />
                  Add a note
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <nav className="k">
        {/* eslint-disable-next-line @next/next/no-img-element -- recoloured by CSS filter */}
        <img src="/logo-dark.png" alt="Drive247" />
        <div className="links">
          <a href="#bookings">Product</a>
          <a href="#trax">Trax</a>
          <a href="#integrations">Integrations</a>
          <a href="#">FAQ</a>
        </div>
        <a className="w" href="/strategy-call">
          Book a demo <ArrowRight />
        </a>
      </nav>
      <div className="copy" id="h247-copy">
        <h1>Rent cars while you sleep.</h1>
        <p>Your booking site, driver checks, agreements, keys and payments run themselves — day and night.</p>
        <div className="ctas">
          <a className="w" href="#">
            Start free trial <ArrowRight />
          </a>
          <button className="w gh" id="h247-tour" type="button">
            <span className="pl">
              <Play />
            </span>
            Watch the tour
          </button>
        </div>
      </div>
      <button className="skip" id="h247-skip" type="button">
        <ArrowUp />
        Back to the car
      </button>
      <div className="caps">
        {CAPS.map((c, i) => (
          <div className="cap" id={`h247-cap${i}`} key={c[0]}>
            <span className="n">{c[0]}</span>
            <div className="tx">
              <b>{c[1]}</b>
              <span>{c[2]}</span>
            </div>
            <div className="dots">
              {CAPS.map((d, j) => (
                <i className={j === i ? "on" : ""} key={d[0]} />
              ))}
            </div>
          </div>
        ))}
        <div className="cap" id="h247-capF">
          <div className="tx">
            <b>Your rental business, open 24/7.</b>
            <span>Set up in an afternoon. Bring your fleet, we’ll do the rest.</span>
          </div>
          <div className="acts">
            <a className="w in" href="#">
              Start free trial <ArrowRight />
            </a>
            <button className="w gh" id="h247-replay" type="button">
              <RotateCcw />
              Replay
            </button>
          </div>
        </div>
      </div>
      <div className="L vig" />
      <div className="L grain" />
      <div className="rail">
        {STEPS.map(([n], i) => (
          <button type="button" aria-label={n} key={n} className={i === 0 ? "on" : undefined}>
            <i />
            <span>{n}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
