"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PortalScreen } from "./portal-glass";

/* Everything here is theirs: each row starts with "Your". Type and real screens only. */
const ROWS: {
  your: string;
  big: string;
  lead: ReactNode;
  body: string;
  points: [string, string][];
  src: string;
  phone: string;
  phoneAlt: string;
  aspect: string;
  tab: string;
  url: string;
  alt: string;
}[] = [
  {
    your: "Your own",
    big: "domain.",
    lead: <>Customers book at an address you own, like <b>yourrentals.com</b>.</>,
    body: "Your name is what renters see in the address bar and on every link you send them, not ours. Put it on your cars, your cards and your ads, and every booking comes back to you.",
    points: [
      ["Connect it yourself", "two DNS records, from your portal"],
      ["Not ready yet?", "start on a Drive247 address"],
      ["Your ads", "point them at your own site"],
    ],
    src: "/v2/site-main",
    phone: "/v2/rows/phone-domain",
    phoneAlt: "Connecting your own domain on a phone",
    aspect: "1917 / 992",
    tab: "Your Rentals",
    url: "yourrentals.com",
    alt: "A rental company's booking site at its own web address",
  },
  {
    your: "Your own",
    big: "booking site.",
    lead: <>Your brand and your cars, with <b>online booking and payments</b> built in.</>,
    body: "Renters pick their dates, choose a car and check out under your name. It comes with pages for your fleet and pricing, promotions, reviews, about and contact, so it works as your whole website.",
    points: [
      ["Edit it yourself", "no waiting on a developer"],
      ["Publish when ready", "see each change as you make it"],
      ["Three steps to book", "dates, car, checkout"],
    ],
    src: "/v2/hero-booking",
    phone: "/v2/phone-booking-site",
    phoneAlt: "The booking site on a phone",
    aspect: "1440 / 828",
    tab: "Book a car",
    url: "yourrentals.com/booking",
    alt: "The booking flow on a rental company's own site",
  },
  {
    your: "Your own",
    big: "portal.",
    lead: <>A <b>full rental admin dashboard</b> for your rentals, money, fleet and to-dos.</>,
    body: "Customers, vehicles, availability, agreements, finances and insights all sit in one place. Log in, see how the business is doing, and get straight to what needs you.",
    points: [
      ["Your staff", "their own login and role"],
      ["Your managers", "access set tab by tab"],
      ["Trax", "ask about your own business"],
    ],
    src: "/v2/hero/dashboard",
    phone: "/v2/phone-dashboard",
    phoneAlt: "The dashboard on a phone",
    aspect: "1440 / 900",
    tab: "Your portal",
    url: "northwind.portal.drive-247.com",
    alt: "The rental admin dashboard",
  },
  {
    your: "Your customers\u2019",
    big: "own portal.",
    lead: <>Renters log in to see their <b>bookings, payments, agreements and documents</b>.</>,
    body: "Each renter gets their own login on your site, with their rentals, payments, agreements, documents and insurance together. They can check the details themselves instead of calling you to ask.",
    points: [
      ["Messages", "they reach you from their portal"],
      ["Their records", "there whenever they need them"],
      ["Your name", "on your site, not a marketplace"],
    ],
    src: "/v2/hero-renter",
    phone: "/v2/phone-renter",
    phoneAlt: "The customer portal on a phone",
    aspect: "1440 / 828",
    tab: "Customer portal",
    url: "northwind.drive-247.com/portal",
    alt: "The customer portal",
  },
];

/*
 * True once the row's top is well into the screen, so the build happens where it can be
 * seen rather than at the bottom edge. False again once the row is back below the screen,
 * so scrolling down to it plays again; a row passed upward stays built.
 */
export function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trigger = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "0px 0px -30% 0px" },
    );
    const reset = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) setVisible(false);
    });
    trigger.observe(el);
    reset.observe(el);
    return () => {
      trigger.disconnect();
      reset.disconnect();
    };
  }, []);

  return { ref, visible };
}

function Row({ row, flipped }: { row: (typeof ROWS)[number]; flipped: boolean }) {
  const { ref, visible } = useReveal();

  return (
    <div
      ref={ref}
      className={`pg-row${flipped ? " is-flipped" : ""}${visible ? " is-in" : ""}`}
    >
      <div className="pg-copy">
        <h2 className="pg-title">
          <span>{row.your}</span> <strong>{row.big}</strong>
        </h2>
        <p className="pg-lead">{row.lead}</p>
        <p className="pg-body">{row.body}</p>
        <dl className="pg-points">
          {row.points.map(([term, detail]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <PortalScreen src={row.src} alt={row.alt} aspect={row.aspect} tab={row.tab} url={row.url} phone={row.phone} phoneAlt={row.phoneAlt} />
    </div>
  );
}

/*
 * One thread down the whole area, through the gap between words and window in each row,
 * so it never runs behind anything. It draws itself as you scroll, tip leading. Measured
 * from the rows because their heights differ; `offsetLeft` and `offsetTop` ignore the
 * reveal's `translate`, so a row part-way through building does not move the line.
 */
function rowGapX(row: HTMLElement) {
  const [a, b] = [row.querySelector<HTMLElement>(".pg-copy")!, row.querySelector<HTMLElement>(".pg-device")!];
  const [first, second] = a.offsetLeft < b.offsetLeft ? [a, b] : [b, a];
  return (first.offsetLeft + first.offsetWidth + second.offsetLeft) / 2;
}

/* Where the thread leaves this area, for the section that carries it on. */
export function threadEndX() {
  // The next section's rail, when it is showing: the thread runs straight on down it.
  const rail = document.querySelector<HTMLElement>(".rc-rail")?.getBoundingClientRect();
  if (rail?.width) return rail.left + rail.width / 2;
  const rows = document.querySelectorAll<HTMLElement>("#features .pg-row");
  return rows.length ? rowGapX(rows[rows.length - 1]) : null;
}

function useThread() {
  const sectionRef = useRef<HTMLElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const [thread, setThread] = useState<{ w: number; h: number; d: string; stops: [number, number][] } | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const measure = () => {
      const stops = [...section.querySelectorAll<HTMLElement>(".pg-row")].map((row): [number, number] => [rowGapX(row), row.offsetTop + row.offsetHeight / 2]);
      if (!stops.length) return;
      const h = section.offsetHeight;
      // Straight down each row, well clear of its window and phone; it only bends in the open space between rows.
      const spans = [...section.querySelectorAll<HTMLElement>(".pg-row")].flatMap((row): [number, number][] => {
        const x = rowGapX(row);
        return [[x, row.offsetTop - 24], [x, row.offsetTop + row.offsetHeight + 56]];
      });
      const points: [number, number][] = [[stops[0][0], 0], ...spans, [threadEndX() ?? stops[stops.length - 1][0], h]];
      const d = points.reduce((path, [x, y], i) => {
        if (i === 0) return `M${x} ${y}`;
        const [px, py] = points[i - 1];
        const mid = (py + y) / 2;
        return `${path}C${px} ${mid} ${x} ${mid} ${x} ${y}`;
      }, "");
      setThread({ w: section.offsetWidth, h, d, stops });
    };

    measure();
    const size = new ResizeObserver(measure);
    size.observe(section);
    return () => size.disconnect();
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const live = liveRef.current;
    const tip = tipRef.current;
    if (!section || !live || !tip || !thread) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      live.style.strokeDashoffset = "0";
      tip.style.display = "none";
      return;
    }

    let frame = 0;
    const paint = () => {
      frame = 0;
      const box = section.getBoundingClientRect();
      const done = Math.min(1, Math.max(0, (innerHeight * 0.7 - box.top) / box.height));
      live.style.strokeDashoffset = String(1 - done);
      const at = live.getPointAtLength(live.getTotalLength() * done);
      tip.setAttribute("cx", String(at.x));
      tip.setAttribute("cy", String(at.y));
      // The launch section's tip takes over from here.
      tip.style.visibility = done >= 1 ? "hidden" : "visible";
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [thread]);

  return { sectionRef, liveRef, tipRef, thread };
}

export function OperationsDashboard() {
  const { sectionRef, liveRef, tipRef, thread } = useThread();

  return (
    <section ref={sectionRef} id="features" className="pg-area">
      <span id="dashboard" />
      {thread && (
        <svg className="pg-thread" viewBox={`0 0 ${thread.w} ${thread.h}`} width={thread.w} height={thread.h} fill="none" aria-hidden>
          <path className="pg-thread-rest" d={thread.d} />
          <path ref={liveRef} className="pg-thread-live" pathLength={1} d={thread.d} />
          {thread.stops.map(([x, y]) => (
            <circle key={y} className="pg-thread-stop" cx={x} cy={y} r="5" />
          ))}
          <circle ref={tipRef} className="pg-thread-tip" r="5" />
        </svg>
      )}
      <div className="pg-rows">
        {ROWS.map((row, i) => (
          <Row key={row.src} row={row} flipped={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
