"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { TICKER } from "./d7-data";
import type { D7Vehicle } from "./use-d7-content";
import { Icon } from "./d7-icons";
import {
  BlurFade, BorderBeam, Card3D, Card3DItem, DotPattern, MagicCard, Marquee,
} from "./d7-ui";

/* ========================================================================== */

/** Infinite trust ribbon between the hero and the fleet. */
export function Ticker() {
  return (
    <div className="relative overflow-hidden border-y border-[var(--line)] bg-[var(--soft)] py-4">
      <Marquee duration={38} gap="0px">
        {TICKER.map(t => (
          <span key={t} className="flex items-center">
            <span className="whitespace-nowrap px-8 text-[12.5px] font-bold uppercase tracking-[.16em] text-[var(--ink-2)]">
              {t}
            </span>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full [background:var(--grad)]" />
          </span>
        ))}
      </Marquee>
      {/* fade the ends so the loop never shows a hard edge */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-[linear-gradient(90deg,var(--soft),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-[linear-gradient(270deg,var(--soft),transparent)]" />
    </div>
  );
}

/* ========================================================================== */

/**
 * Horizontal fleet rail. Native scroll with snap points does the work — the
 * arrows just nudge it by one card, so touch, trackpad and keyboard all
 * behave without a carousel dependency.
 */
/** Formats a daily rate in the tenant's own currency. */
function useRate(currency: string | null) {
  return (n: number | null) => {
    if (n == null) return null;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: currency || "USD", maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${currency || "$"}${Math.round(n).toLocaleString("en-US")}`;
    }
  };
}

export function Fleet({ vehicles, currency }: { vehicles: D7Vehicle[]; currency: string | null }) {
  const rail = useRef<HTMLDivElement | null>(null);
  const fmt = useRate(currency);
  const [edge, setEdge] = useState({ start: true, end: false });

  const sync = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft < 8,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    sync();
    const el = rail.current;
    el?.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => { el?.removeEventListener("scroll", sync); window.removeEventListener("resize", sync); };
  }, [sync]);

  const nudge = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const step = (card?.offsetWidth ?? 240) + 16;
    el.scrollBy({ left: dir * step * 2, behavior: "smooth" });
  };

  return (
    <section id="fleet" className="relative scroll-mt-24 py-16 sm:py-20">
      <DotPattern className="opacity-[.55] [mask-image:radial-gradient(560px_circle_at_center,white,transparent)]" />

      <div className="d7-wrap relative">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <BlurFade>
            <h2 className="d7-dis d7-h2 text-[var(--ink)]">Explore Our Premium Fleet</h2>
            <p className="d7-body mt-2 max-w-[34rem] text-[14px]">
              Hand-picked, meticulously serviced and ready when you are.
            </p>
          </BlurFade>

          <BlurFade delay={0.1}>
            <div className="flex items-center gap-3">
              <a href="/fleet" className="d7-link group hidden items-center gap-1.5 text-[13.5px] font-semibold text-[var(--v)] sm:flex">
                View all vehicles
                <Icon name="arrow" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </a>
              <div className="flex gap-2">
                <RailButton dir="left"  disabled={edge.start} onClick={() => nudge(-1)} />
                <RailButton dir="right" disabled={edge.end}   onClick={() => nudge(1)} />
              </div>
            </div>
          </BlurFade>
        </div>

        {/* rail */}
        <div ref={rail}
          className="d7-noscroll mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 pt-2
                     [scroll-padding-left:0px]">
          {vehicles.map((car, i) => (
            <FleetCard key={car.id} car={car} index={i} rate={fmt(car.rate)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RailButton({ dir, disabled, onClick }: {
  dir: "left" | "right"; disabled: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      aria-label={dir === "left" ? "Previous vehicles" : "Next vehicles"}
      className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--white)]
                 text-[var(--ink)] shadow-[var(--shadow)] transition
                 hover:-translate-y-0.5 hover:border-[var(--v)]/45 hover:text-[var(--v)]
                 disabled:pointer-events-none disabled:opacity-35">
      <Icon name={dir} className="h-[18px] w-[18px]" />
    </button>
  );
}

function FleetCard({ car, index, rate }: { car: D7Vehicle; index: number; rate: string | null }) {
  return (
    <motion.div
      data-card
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ delay: Math.min(index, 5) * 0.07, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="w-[min(80vw,246px)] shrink-0 snap-start">
      <Card3D max={8} className="h-full">
        <MagicCard className="d7-card group h-full rounded-[var(--r)]">
          <BorderBeam duration={7} delay={index * 0.9} size={70} radius={16}
            className="opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

          {/* photo — a tenant without a vehicle photo gets a branded placeholder
              rather than a broken image frame */}
          <div className="relative m-2.5 overflow-hidden rounded-xl bg-[var(--soft-2)]">
            <Card3DItem z={26}>
              {car.img ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={car.img} alt={car.name}
                  className="d7-zoom aspect-[16/11] w-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <span className="grid aspect-[16/11] w-full place-items-center text-[var(--v)]/35">
                  <Icon name="car" className="h-11 w-11" />
                </span>
              )}
            </Card3DItem>
            <span aria-hidden className="d7-sheen absolute inset-0" />
          </div>

          {/* body */}
          <Card3DItem z={16} className="px-4 pb-4 pt-1">
            <h3 className="d7-h3 d7-dis truncate text-[var(--ink)] transition-colors group-hover:text-[var(--v)]">
              {car.name}
            </h3>
            {car.category && <p className="mt-0.5 text-[12.5px] capitalize text-[var(--mute)]">{car.category}</p>}

            {car.fuel && (
              <div className="mt-3 flex items-center gap-4 border-t border-[var(--line-2)] pt-3 text-[12px] text-[var(--body)]">
                <span className="flex items-center gap-1.5 capitalize">
                  <Icon name="bolt" className="h-[15px] w-[15px] text-[var(--v)]" />{car.fuel}
                </span>
              </div>
            )}

            {rate && (
              <p className="mt-3 text-[19px] font-extrabold tracking-[-.02em] text-[var(--v)]">
                {rate}
                <span className="ml-1 text-[12px] font-semibold text-[var(--mute)]">/day</span>
              </p>
            )}

            <a href="#booking"
              className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-[var(--line)]
                         py-2 text-[12.5px] font-bold text-[var(--ink)] transition
                         group-hover:[background:var(--grad)] group-hover:border-transparent group-hover:text-white">
              Book this
              <Icon name="arrow" className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </Card3DItem>
        </MagicCard>
      </Card3D>
    </motion.div>
  );
}
