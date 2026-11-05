"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Pause, Play, Volume2 } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import type { Testimonial } from "@/lib/testimonials-server";
import "./testimonials-section.css";

/*
 * The founder on film beside the reasons for building it, then operators' words below.
 *
 *   Films    real footage of the founder, labelled as the founder.
 *   Quotes   only what admins publish in `operator_testimonials`, signed by that name.
 *            No faces go with them: we have no photos of these operators.
 */
const film = (slug: string, title: string, length: string) => ({
  src: `/landing-v4/testimonials/${slug}.mp4`,
  poster: `/landing-v4/testimonials/${slug}.webp`,
  title,
  length,
});

const FILMS = [
  film("founder-turo", "What if your Turo account went tomorrow?", "0:17"),
  film("founder-own-customers", "The customer isn't yours", "0:15"),
  film("founder-trust", "Why renters trust your own site", "0:17"),
  film("founder-who-for", "Who we built this for", "0:13"),
];

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  const { ref, visible } = useFadeIn();
  const frame = useRef<HTMLButtonElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  // One film plays silently while on screen, until someone asks for sound.
  const [active, setActive] = useState(0);
  const [sound, setSound] = useState(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(noMotion);
    if (noMotion) setStopped(true);
    const el = frame.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = player.current;
    if (!el) return;
    el.muted = !sound;
    if (inView && !stopped) void el.play().catch(() => {});
    else el.pause();
  }, [active, sound, stopped, inView]);

  const choose = (index: number) => {
    setActive(index);
    setStopped(false);
    setSound(true);
  };

  const pressFrame = () => {
    if (sound && !stopped) {
      setStopped(true);
      setSound(false);
    } else {
      choose(active);
    }
  };

  const ended = () => {
    setSound(false);
    if (reduced) setStopped(true);
    else setActive((i) => (i + 1) % FILMS.length);
  };

  const trackProgress = () => {
    const el = player.current;
    if (el?.duration && bar.current) bar.current.style.transform = `scaleX(${el.currentTime / el.duration})`;
  };

  const current = FILMS[active];
  const withSound = sound && !stopped;

  return (
    <section id="testimonials" className="ts-section">
      <div ref={ref} className={`ts-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="ts-feature">
          <button
            ref={frame}
            type="button"
            className="ts-frame"
            aria-label={`${withSound ? "Stop" : "Play with sound"}: ${current.title}, from our founder`}
            onClick={pressFrame}
          >
            <video
              ref={player}
              src={current.src}
              poster={current.poster}
              muted
              playsInline
              preload="none"
              onEnded={ended}
              onTimeUpdate={trackProgress}
            />
            <span className="ts-control" aria-hidden>
              {withSound ? <Pause /> : stopped ? <Play /> : <Volume2 />}
              {withSound ? "Stop" : stopped ? "Play" : "Turn on sound"}
            </span>
          </button>

          <div className="ts-head">
            <h2 className="ts-title font-medium tracking-tighter">
              Built for <span className="ts-brand">operators</span>
            </h2>
            <p className="ts-sub">Why rental businesses run on Drive247.</p>
          </div>

          <div className="ts-films">
            <p className="ts-label">From our founder</p>
            <ul>
              {FILMS.map((item, i) => (
                <li key={item.src}>
                  <button
                    type="button"
                    className="ts-film"
                    aria-current={i === active || undefined}
                    onClick={() => choose(i)}
                  >
                    <span className="ts-film-title">{item.title}</span>
                    <span className="ts-film-length">{item.length}</span>
                    {i === active && (
                      <span className="ts-progress" aria-hidden>
                        <span key={item.src} ref={bar} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <a href="/strategy-call" className="ts-link">
              See how Drive247 works for your fleet
              <ArrowRight aria-hidden />
            </a>
          </div>
        </div>

        {testimonials.length > 0 && (
          <div className="ts-quotes">
            {testimonials.map((quote) => (
              <blockquote key={quote.id} className="ts-quote">
                <p>
                  {quote.before}
                  {quote.bold && <strong>{quote.bold}</strong>}
                  {quote.after}
                </p>
                <footer>
                  <span>{quote.name}</span>
                  {[quote.role, quote.fleetSize, quote.location].filter(Boolean).join(" · ")}
                </footer>
              </blockquote>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
