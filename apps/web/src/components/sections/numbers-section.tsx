"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { NUMBERS, type ProofNumber } from "@/content/proof";
import "@/components/content/content.css";
import "./numbers-section.css";
import { ArrowIntro } from "./demo-intro";
import { Accent } from "./section-heading";
import { NumberGauge } from "./numbers-gauge";
import { LINE_MEDIA } from "./launch-section";

/*
 * Drive247 in numbers, as a car's instrument cluster: each figure sits under its own
 * dial, and the needle sweeps up with the count. Every figure is real (see
 * content/proof.ts); the dials are decoration and carry no scale. The count-up is the
 * section's one animation and runs once, the first time the numbers come into view.
 */

const FORMAT = new Intl.NumberFormat("en-US");
const COUNT_MS = 1600;
const STAGGER_MS = 140;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

function Stat({ stat, run, delay }: { stat: ProofNumber; run: boolean; delay: number }) {
  // The server renders the final figure, so the page reads right without JavaScript.
  // Before the first paint the client winds it back to zero, ready to count.
  const [shown, setShown] = useState(stat.value);
  const wound = useRef(false);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    wound.current = true;
    setShown(0);
  }, []);

  useEffect(() => {
    if (!run || !wound.current) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
      setShown(Math.round(stat.value * easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, delay, stat.value]);

  const final = `${stat.prefix ?? ""}${FORMAT.format(stat.value)}${stat.suffix ?? ""}`;

  return (
    <li className="nm-stat">
      <NumberGauge icon={stat.icon} progress={stat.value ? shown / stat.value : 1} />
      <p className="nm-value">
        <span aria-hidden>
          {stat.prefix && <span className="nm-unit">{stat.prefix}</span>}
          {FORMAT.format(shown)}
          {stat.suffix && <span className="nm-unit">{stat.suffix}</span>}
        </span>
        <span className="sr-only">{final}</span>
      </p>
      <p className="nm-label">
        <span className="nm-label-full">{stat.label}</span>
        <span className="nm-label-short" aria-hidden>{stat.short}</span>
      </p>
      <p className="nm-detail">{stat.detail}</p>
    </li>
  );
}

/* The words before the numbers, with the page line turning into an arrow at them (demo-intro.tsx). */
export function NumbersIntro() {
  return (
    <ArrowIntro
      id="numbers-intro"
      headingId="nm-title"
      title={
        <>
          Real operators run on Drive247. <Accent>Every single day.</Accent>
        </>
      }
      sub="Real bookings, real payments and real renters, from rental businesses already on Drive247."
    />
  );
}

export function NumbersSection() {
  const listRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [run, setRun] = useState(false);

  // The page line skips the cards: the arrow above ends it, and it starts again from the
  // middle of the last card's bottom edge (data-line-*, page px; tour-layout.ts).
  useEffect(() => {
    const section = sectionRef.current;
    const list = listRef.current;
    if (!section || !list) return;
    const media = matchMedia(LINE_MEDIA);
    const measure = () => {
      const last = list.lastElementChild?.getBoundingClientRect();
      if (!media.matches || !last) {
        delete section.dataset.lineIn;
        delete section.dataset.lineOut;
        delete section.dataset.lineOutY;
        return;
      }
      const x = String(Math.round(last.left + last.width / 2 + scrollX));
      // In where the arrow above let the line go, so nothing is drawn joining the two.
      const above = section.previousElementSibling instanceof HTMLElement ? section.previousElementSibling.dataset.lineOut : undefined;
      section.dataset.lineIn = above ?? x;
      section.dataset.lineOut = x;
      section.dataset.lineOutY = String(Math.round(last.bottom + scrollY));
    };
    measure();
    const size = new ResizeObserver(measure);
    size.observe(list);
    const marks = new MutationObserver(measure);
    if (section.previousElementSibling) marks.observe(section.previousElementSibling, { attributes: true, attributeFilter: ["data-line-out"] });
    media.addEventListener("change", measure);
    return () => {
      size.disconnect();
      marks.disconnect();
      media.removeEventListener("change", measure);
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRun(true);
        observer.disconnect();
      },
      { threshold: matchMedia("(max-width: 767.98px)").matches ? 0.1 : 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="nm" aria-label="Drive247 in numbers">
      <div className="ct-inner">
        <ul ref={listRef} className="nm-grid">
          {NUMBERS.map((stat, index) => (
            <Stat key={stat.label} stat={stat} run={run} delay={index * STAGGER_MS} />
          ))}
        </ul>

      </div>
    </section>
  );
}
