"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import "./typed-text.css";

/*
 * A heading that animates in, every time it comes into view (Ghulam, 2026-11-07): its words
 * rise into place one after another, quickly. Every word is laid out from the start (just
 * invisible), so nothing on the page moves. Screen readers get the whole sentence at once;
 * reduced motion shows it complete.
 *
 *   <TypedText parts={[{ text: "See every car… in " }, { text: "one calendar.", accent: true }]} />
 */

type Part = { text: string; accent?: boolean };

const STEP_MS = 55;

export function TypedText({ parts }: { parts: Part[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const total = parts.reduce((n, p) => n + p.text.split(/ +/).filter(Boolean).length, 0);
  const [shown, setShown] = useState(total);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShown(0);
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearInterval(timer);
        if (!entry.isIntersecting) {
          // Off screen: wind back, so it types again next time.
          setTyping(false);
          setShown(0);
          return;
        }
        setTyping(true);
        let n = 0;
        timer = window.setInterval(() => {
          n += 1;
          setShown(n);
          if (n >= total) {
            window.clearInterval(timer);
            setTyping(false);
          }
        }, STEP_MS);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [total]);

  // Words rise in one after another; `total` counts words here.
  let w = 0;
  return (
    <span ref={ref} className={`tw${typing ? " is-typing" : ""}`}>
      <span className="sr-only">{parts.map((p) => p.text).join("")}</span>
      <span aria-hidden>
        {parts.map((part, pi) => {
          const body = part.text.split(/( +)/).map((word, wi) => {
            if (/^ +$/.test(word) || !word) return <Fragment key={wi}>{word}</Fragment>;
            const at = w++;
            return (
              <span key={wi} className={`tw-word${at < shown ? " on" : ""}`}>
                {word}
              </span>
            );
          });
          return part.accent ? (
            <span key={pi} className="sh-accent">
              {body}
            </span>
          ) : (
            <Fragment key={pi}>{body}</Fragment>
          );
        })}
      </span>
    </span>
  );
}
