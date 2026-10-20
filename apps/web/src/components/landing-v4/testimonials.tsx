"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { V3_TESTIMONIALS } from "./v3-markup";
import { TESTIMONIALS, type TextTestimonial, type VideoTestimonial } from "./testimonials-data";

/*
 * Testimonials — a three-column wall of text and video cards on the old
 * section's background artwork. Nine cards show at a time and they keep
 * changing: every 2–3s one text card is swapped, and a video card is swapped
 * when its clip ends. A swap can bring in either kind, never a testimonial
 * already on screen (nor one that just left), and keeps 3–4 videos showing
 * on desktop.
 * Hovering a card holds it. Content lives in testimonials-data.ts.
 */

// The dashed curves and rings behind the section, exactly as the old markup drew them.
const DECO = (() => {
  const at = V3_TESTIMONIALS.indexOf('<div class="tc-deco"');
  return at < 0 ? "" : V3_TESTIMONIALS.slice(at, V3_TESTIMONIALS.indexOf("</div>", at) + "</div>".length);
})();

const SLOTS = 9;
// The slots each column shows at each width, top to bottom.
const COLUMNS: Record<number, number[][]> = {
  3: [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
  2: [[0, 1, 2], [6, 7, 8]],
  1: [[0, 1, 7, 2]],
};
const START_VIDEO_SLOTS = [0, 4, 7]; // one per column, staggered
// How many videos stay on screen, by column count.
const MIN_VIDEOS: Record<number, number> = { 3: 3, 2: 2, 1: 2 };
const MAX_VIDEOS: Record<number, number> = { 3: 4, 2: 3, 1: 2 };
const SWAP_EVERY = [2200, 3200]; // ms between text-card swaps
const REST = 5000; // a card that just changed stays at least this long
const FADE = 380; // ms, matches .tw-slot.out in landing-v4.css

const isVideo = (id: number) => TESTIMONIALS[id]?.kind === "video";
const VIDEO_IDS = TESTIMONIALS.flatMap((t, i) => (t.kind === "video" ? [i] : []));
const TEXT_IDS = TESTIMONIALS.flatMap((t, i) => (t.kind === "text" ? [i] : []));

// Deterministic first render (it is server-rendered); the shuffling starts on the client.
function initialSlots() {
  const v = [...VIDEO_IDS], t = [...TEXT_IDS];
  return Array.from({ length: SLOTS }, (_, s) => (START_VIDEO_SLOTS.includes(s) ? (v.shift() ?? t.shift()) : (t.shift() ?? v.shift())) ?? -1);
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function initials(name: string) {
  const p = name.split(" ");
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function useColumnCount() {
  const [n, setN] = useState(3);
  useEffect(() => {
    const wide = matchMedia("(min-width: 1000px)"), mid = matchMedia("(min-width: 640px)");
    const set = () => setN(wide.matches ? 3 : mid.matches ? 2 : 1);
    set();
    wide.addEventListener("change", set);
    mid.addEventListener("change", set);
    return () => {
      wide.removeEventListener("change", set);
      mid.removeEventListener("change", set);
    };
  }, []);
  return n;
}

function TextCard({ t }: { t: TextTestimonial }) {
  const paras = Array.isArray(t.quote) ? t.quote : [t.quote];
  return (
    <article className="tw-card tw-text">
      <span className="tw-q" aria-hidden>
        “
      </span>
      <span className="tw-av" style={{ ["--c" as string]: t.color }}>
        {initials(t.name)}
        {t.avatar ? <img src={t.avatar} alt="" loading="lazy" /> : null}
      </span>
      <b className="tw-name">{t.name}</b>
      <small className="tw-role">{t.role}</small>
      <div className="tw-quote">
        {paras.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </article>
  );
}

function VideoCard({
  t,
  active,
  muted,
  onToggleSound,
  onEnded,
}: {
  t: VideoTestimonial;
  active: boolean;
  muted: boolean;
  onToggleSound: () => void;
  onEnded: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [held, setHeld] = useState(false); // paused by the viewer
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (active && !held) v.play().catch(() => {});
    else v.pause();
  }, [active, held, muted]);

  return (
    <article className="tw-card tw-video">
      <video
        ref={ref}
        src={t.video}
        poster={t.poster}
        muted
        playsInline
        preload="metadata"
        onEnded={onEnded}
        onError={onEnded}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setProgress(v.currentTime / v.duration);
        }}
      />
      <span className="tw-shade" />
      <button type="button" className="tw-ctl tw-pp" onClick={() => setHeld((h) => !h)} aria-label={held ? `Play ${t.name}'s video` : `Pause ${t.name}'s video`}>
        {held ? <Play /> : <Pause />}
      </button>
      <button type="button" className="tw-ctl tw-snd" onClick={onToggleSound} aria-label={muted ? "Turn sound on" : "Turn sound off"}>
        {muted ? <VolumeX /> : <Volume2 />}
      </button>
      <div className="tw-cap">
        <span className="tw-co">
          <i>{initials(t.company)}</i>
          {t.company}
        </span>
        <h3>{t.title}</h3>
        <small>
          {t.name} · {t.role}
        </small>
      </div>
      <span className="tw-prog">
        <i style={{ transform: `scaleX(${progress})` }} />
      </span>
    </article>
  );
}

// A slot animates its height to whatever card it holds, so the column below glides rather than jumps.
function Slot({ out, children, onEnter, onLeave }: { out: boolean; children: ReactNode; onEnter: () => void; onLeave: () => void }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number>();
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={`tw-slot${out ? " out" : ""}`} style={{ height: h }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

export function Testimonials() {
  const cols = useColumnCount();
  const [shown, setShown] = useState(initialSlots); // what each slot displays
  const [leaving, setLeaving] = useState<number[]>([]);
  const [inView, setInView] = useState(false);
  const [audible, setAudible] = useState<number | null>(null); // the one video with sound on; turning one on mutes the rest
  const section = useRef<HTMLElement>(null);
  const target = useRef(shown); // what each slot holds or is about to — the source of truth for "on screen"
  const recent = useRef<number[]>([]);
  const lastSwap = useRef<number[]>(Array(SLOTS).fill(0));
  const hovered = useRef(new Set<number>());
  const endedWhileHovered = useRef(new Set<number>());
  const busy = useRef(new Set<number>());
  const visible = COLUMNS[cols].flat();
  const visibleRef = useRef(visible);
  const colsRef = useRef(cols);
  useEffect(() => {
    visibleRef.current = COLUMNS[cols].flat();
    colsRef.current = cols;
  }, [cols]);

  const swap = (slot: number) => {
    if (busy.current.has(slot)) return;
    const cur = target.current;
    const videosOn = visibleRef.current.filter((s) => s !== slot && isVideo(cur[s])).length;
    let pool = TESTIMONIALS.map((_, i) => i).filter((i) => !cur.includes(i));
    if (videosOn < MIN_VIDEOS[colsRef.current] && pool.some(isVideo)) pool = pool.filter(isVideo);
    else if (videosOn >= MAX_VIDEOS[colsRef.current]) pool = pool.filter((i) => !isVideo(i));
    const fresh = pool.filter((i) => !recent.current.includes(i));
    const next = pick(fresh.length ? fresh : pool);
    if (next === undefined) return;

    recent.current = [cur[slot], ...recent.current].slice(0, 6);
    target.current = cur.map((id, s) => (s === slot ? next : id));
    lastSwap.current[slot] = performance.now();
    busy.current.add(slot);
    endedWhileHovered.current.delete(slot);
    setLeaving((l) => [...l, slot]);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      setShown((s) => s.map((id, i) => (i === slot ? next : id)));
      setLeaving((l) => l.filter((x) => x !== slot));
      busy.current.delete(slot);
    }, reduce ? 0 : FADE);
  };

  // Only run (and only play videos) while the section is on screen.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Every 2–3s, swap one text card that isn't hovered and hasn't just changed.
  const swapOneText = useEffectEvent(() => {
    const now = performance.now();
    const ready = visibleRef.current.filter(
      (s) => !isVideo(target.current[s]) && !hovered.current.has(s) && !busy.current.has(s) && now - lastSwap.current[s] > REST,
    );
    if (ready.length && !document.hidden) swap(pick(ready));
  });
  useEffect(() => {
    if (!inView) return;
    let id = 0;
    const tick = () => {
      id = window.setTimeout(() => {
        swapOneText();
        tick();
      }, SWAP_EVERY[0] + Math.random() * (SWAP_EVERY[1] - SWAP_EVERY[0]));
    };
    tick();
    return () => window.clearTimeout(id);
  }, [inView]);

  const ended = (slot: number) => {
    if (hovered.current.has(slot)) endedWhileHovered.current.add(slot);
    else swap(slot);
  };

  return (
    <div className="d3s">
      <div className="d3-root">
        <section className="tc tw" id="x-love" data-screen-label="Testimonials" ref={section}>
          <div dangerouslySetInnerHTML={{ __html: DECO }} style={{ display: "contents" }} />
          <div className="tw-panel x-rv">
            <div className="tw-head">
              <span className="y-kick">Testimonials</span>
              <h2 className="tw-h">What operators are saying</h2>
            </div>
            <div className={`tw-grid c${cols}`} style={{ ["--cols" as string]: cols }}>
              {COLUMNS[cols].map((col, c) => (
                <div className="tw-col" key={c}>
                  {col.map((slot) => {
                    const t = TESTIMONIALS[shown[slot]];
                    if (!t) return null;
                    return (
                      <Slot
                        key={slot}
                        out={leaving.includes(slot)}
                        onEnter={() => hovered.current.add(slot)}
                        onLeave={() => {
                          hovered.current.delete(slot);
                          if (endedWhileHovered.current.has(slot)) swap(slot);
                        }}
                      >
                        {t.kind === "video" ? (
                          <VideoCard
                            key={shown[slot]}
                            t={t}
                            active={inView && visible.includes(slot)}
                            muted={audible !== shown[slot]}
                            onToggleSound={() => setAudible((a) => (a === shown[slot] ? null : shown[slot]))}
                            onEnded={() => ended(slot)}
                          />
                        ) : (
                          <TextCard key={shown[slot]} t={t} />
                        )}
                      </Slot>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
