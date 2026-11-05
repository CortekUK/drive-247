"use client";

import { useEffect, useRef, useState } from "react";

/* Each word gets its turn, then the headline rests on the motto as written. */
const WORDS = ["bookings", "payments", "fleet", "website", "business"];
const WORD_MS = 1300;
const LAST = WORDS.length - 1;

export function HeroTitle() {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number>();
  const words = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIndex(LAST);
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((i) => {
        if (i + 1 >= LAST) window.clearInterval(timer);
        return Math.min(i + 1, LAST);
      });
    }, WORD_MS);
    return () => window.clearInterval(timer);
  }, []);

  // The slot takes the width of the word showing, so the headline stays centred on it.
  useEffect(() => {
    const measure = () => setWidth(words.current[index]?.offsetWidth);
    measure();
    document.fonts?.ready.then(measure);
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [index]);

  return (
    <h1
      className="hg-title font-medium tracking-tighter text-white"
      aria-label="Your business. Driven forward."
      data-landed={index === LAST ? "" : undefined}
    >
      <span aria-hidden>
        <span className="hg-your">
          Your{" "}
          <span className="hg-words" style={{ width }}>
            {WORDS.map((word, i) => (
              <span
                key={word}
                ref={(el) => {
                  words.current[i] = el;
                }}
                className={`hg-word${i === index ? " is-on" : i < index ? " is-past" : ""}`}
              >
                {word}
              </span>
            ))}
          </span>
          .
        </span>{" "}
        <span className="hg-forward">Driven forward.</span>
      </span>
    </h1>
  );
}
