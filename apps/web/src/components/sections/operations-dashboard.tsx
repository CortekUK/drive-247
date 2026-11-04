"use client";

import { useEffect, useRef, useState } from "react";
import {
  AgreementsArt,
  InsightsArt,
  MarketingArt,
  PortalScreen,
  SixToolsArt,
  WebsiteArt,
} from "./portal-glass";

const ROWS = [
  {
    art: SixToolsArt,
    title: "Stop juggling six tools to run one business.",
    body: "Bookings, vehicle availability, payments and deposits, e-signed agreements, customer messages and staff roles in one portal, under your brand and, if you choose, on your own domain.",
    src: "/v2/hero/dashboard",
    phone: "/v2/phone-dashboard",
    phoneAlt: "The same dashboard on a phone",
    aspect: "1440 / 900",
    tab: "Dashboard",
    url: "northwind.portal.drive-247.com",
    alt: "The Drive247 operator dashboard",
  },
  {
    art: WebsiteArt,
    title: "Change your website without waiting on a developer.",
    body: "Edit your booking site's pages yourself, see the change as you make it, and publish when you're ready.",
    src: "/v2/hero/editor",
    phone: "/v2/phone-booking-site",
    phoneAlt: "The live booking site on a phone",
    aspect: "1440 / 900",
    tab: "Website editor",
    url: "northwind.portal.drive-247.com/cms",
    alt: "The Drive247 website editor",
  },
  {
    art: AgreementsArt,
    title: "Stop chasing signatures.",
    body: "Send agreements for e-signature and follow every one through to its signed copy. Renters sign from their phone.",
    src: "/v2/hero/agreements",
    phone: "/v2/phone-agreements",
    phoneAlt: "The agreements page on a phone",
    aspect: "1168 / 640",
    tab: "Agreements",
    url: "northwind.portal.drive-247.com/agreements",
    alt: "The Drive247 agreements page",
  },
  {
    art: InsightsArt,
    title: "Know what every car actually makes.",
    body: "Insights shows what you took in, gave back, spent and kept, with utilisation and profit for every car, so decisions start from your own numbers.",
    src: "/v2/slide-revenue",
    phone: "/v2/phone-insights",
    phoneAlt: "The Insights page on a phone",
    aspect: "1917 / 992",
    tab: "Insights",
    url: "northwind.portal.drive-247.com/insights",
    alt: "The Drive247 Insights page",
  },
  {
    art: MarketingArt,
    title: "See what your website brings in.",
    body: "Visitors, bookings from the site and the share of visitors who book, with every step from first visit to paid booking in one place.",
    src: "/v2/hero/marketing",
    phone: "/v2/phone-website-stats",
    phoneAlt: "The website analytics page on a phone",
    aspect: "1168 / 660",
    tab: "Your website",
    url: "northwind.portal.drive-247.com",
    alt: "The Drive247 website analytics page",
  },
];

/*
 * True once the row's top is well into the screen, so the build happens where it can be
 * seen rather than at the bottom edge. False again once the row is back below the screen,
 * so scrolling down to it plays again; a row passed upward stays built.
 */
function useReveal() {
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
  const Art = row.art;

  return (
    <div
      ref={ref}
      className={`pg-row${flipped ? " is-flipped" : ""}${visible ? " is-in" : ""}`}
    >
      <div className="pg-copy">
        <Art play={visible} />
        <h2 className="mt-10 text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          {row.title}
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{row.body}</p>
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
function useThread() {
  const sectionRef = useRef<HTMLElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const [thread, setThread] = useState<{ w: number; h: number; d: string; stops: [number, number][] } | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const measure = () => {
      const stops = [...section.querySelectorAll<HTMLElement>(".pg-row")].map((row): [number, number] => {
        const [a, b] = [row.querySelector<HTMLElement>(".pg-copy")!, row.querySelector<HTMLElement>(".pg-device")!];
        const [first, second] = a.offsetLeft < b.offsetLeft ? [a, b] : [b, a];
        return [(first.offsetLeft + first.offsetWidth + second.offsetLeft) / 2, row.offsetTop + row.offsetHeight / 2];
      });
      if (!stops.length) return;
      const h = section.offsetHeight;
      const points: [number, number][] = [[stops[0][0], 0], ...stops, [stops[stops.length - 1][0], h]];
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
