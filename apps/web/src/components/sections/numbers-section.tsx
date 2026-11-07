"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { NUMBERS, PROOF_AS_OF, type ProofNumber } from "@/content/proof";
import "@/components/content/content.css";
import "./numbers-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Drive247 in numbers. Every figure is real (see content/proof.ts); the size and the
 * count-up are the emphasis, not the values. The count-up is the section's one
 * animation and runs once, the first time the numbers come into view.
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
      <p className="nm-value">
        <span aria-hidden>
          {stat.prefix && <span className="nm-unit">{stat.prefix}</span>}
          {FORMAT.format(shown)}
          {stat.suffix && <span className="nm-unit">{stat.suffix}</span>}
        </span>
        <span className="sr-only">{final}</span>
      </p>
      <p className="nm-label">{stat.label}</p>
      <p className="nm-detail">{stat.detail}</p>
    </li>
  );
}

export function NumbersSection() {
  const listRef = useRef<HTMLUListElement>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRun(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="nm" aria-labelledby="nm-title">
      <div className="ct-inner">
        <SectionHeading
          id="nm-title"
          title={
            <>
              Real rentals. <Accent>Real money.</Accent>
            </>
          }
          sub={
            <>
              What operators have run through Drive247 so far.
            </>
          }
        />

        <ul ref={listRef} className="nm-grid">
          {NUMBERS.map((stat, index) => (
            <Stat key={stat.label} stat={stat} run={run} delay={index * STAGGER_MS} />
          ))}
        </ul>

        <p className="nm-note">Live operators only, with test accounts left out. Figures as of {PROOF_AS_OF}.</p>
      </div>
    </section>
  );
}
