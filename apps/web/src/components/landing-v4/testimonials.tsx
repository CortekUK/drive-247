"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { V3_TESTIMONIALS } from "./v3-markup";
import {
  TESTIMONIALS,
  type TextTestimonial,
  type VideoTestimonial,
} from "./testimonials-data";

/*
 * Testimonials — a three-column wall of text and video cards on the old
 * section's background artwork. Nine cards show at a time and they keep
 * changing: every 2–3s one text card is swapped, and a video card (its clip
 * plays on its own, muted; click it to pause, hover for sound) when the clip ends. A swap can bring in either kind, never a testimonial
 * already on screen (nor one that just left), and keeps 3–4 videos showing
 * on desktop.
 * Hovering a card holds it. Content lives in testimonials-data.ts.
 */

// The dashed curves and rings behind the section, exactly as the old markup drew them.
const DECO = (() => {
  const at = V3_TESTIMONIALS.indexOf('<div class="tc-deco"');
  return at < 0
    ? ""
    : V3_TESTIMONIALS.slice(
        at,
        V3_TESTIMONIALS.indexOf("</div>", at) + "</div>".length,
      );
})();

const SLOTS = 9;
// The slots each column shows at each width, top to bottom.
const COLUMNS: Record<number, number[][]> = {
  3: [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
  ],
  2: [
    [0, 1, 2],
    [6, 7, 8],
  ],
  1: [[0, 1, 7, 2, 3, 5]], // one row that slides sideways on phones
};
const START_VIDEO_SLOTS = [0, 7]; // first and last columns, staggered
// How many videos stay on screen, by column count: always at least two on
// desktop and tablet, at most three. Where they sit is random.
const MIN_VIDEOS: Record<number, number> = { 3: 2, 2: 2, 1: 1 };
const MAX_VIDEOS: Record<number, number> = { 3: 3, 2: 3, 1: 2 };
const SWAP_EVERY = [2200, 3200]; // ms between text-card swaps
const REST = 5000; // a card that just changed stays at least this long
const VIDEO_REST = 9000; // a video card nobody has played stays a little longer
const FADE = 380; // ms, matches .tw-slot.out in landing-v4.css

const isVideo = (id: number) => TESTIMONIALS[id]?.kind === "video";
const VIDEO_IDS = TESTIMONIALS.flatMap((t, i) =>
  t.kind === "video" ? [i] : [],
);
const TEXT_IDS = TESTIMONIALS.flatMap((t, i) => (t.kind === "text" ? [i] : []));

// Deterministic first render (it is server-rendered); the shuffling starts on the client.
function initialSlots() {
  const v = [...VIDEO_IDS],
    t = [...TEXT_IDS];
  return Array.from(
    { length: SLOTS },
    (_, s) =>
      (START_VIDEO_SLOTS.includes(s)
        ? (v.shift() ?? t.shift())
        : (t.shift() ?? v.shift())) ?? -1,
  );
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function initials(name: string) {
  const p = name.split(" ");
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function useColumnCount() {
  const [n, setN] = useState(3);
  useEffect(() => {
    const wide = matchMedia("(min-width: 1000px)"),
      mid = matchMedia("(min-width: 640px)");
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

// The person's photo with the hero tiles' name bar; the clip plays over it, muted,
// once the card is on screen, and the card moves on when the clip ends. Clicking
// the card pauses and resumes it; the speaker that shows on hover turns its sound
// on or off (one card at a time). Nothing sits on the card until it is hovered.
function VideoCard({
  t,
  active,
  muted,
  onToggleSound,
  onPlaying,
  onEnded,
  loop,
}: {
  t: VideoTestimonial;
  active: boolean;
  muted: boolean;
  onToggleSound: () => void;
  onPlaying: (playing: boolean) => void;
  onEnded: () => void;
  loop?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [held, setHeld] = useState(false); // paused by the viewer

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (active && !held) v.play().catch(() => {});
    else v.pause();
  }, [active, held, muted]);

  return (
    <article
      className={`tw-card tw-video${held ? " is-held" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={held ? `Play ${t.name}'s video` : `Pause ${t.name}'s video`}
      onClick={() => setHeld((h) => !h)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setHeld((h) => !h);
        }
      }}
    >
      <img className="tw-photo" src={t.photo} alt="" loading="lazy" />
      <video
        ref={ref}
        src={t.video}
        poster={t.photo}
        muted
        loop={loop}
        playsInline
        preload="metadata"
        onPlay={() => onPlaying(true)}
        onPause={() => onPlaying(false)}
        onEnded={() => {
          onPlaying(false);
          onEnded();
        }}
        onError={onEnded}
      />
      <span className="tw-shade" />
      {/* the centre button: Pause shows while the card is hovered, Play stays while it is paused */}
      <span className="tw-held" aria-hidden="true">
        {held ? <Play /> : <Pause />}
      </span>
      <button
        type="button"
        className="tw-snd"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSound();
        }}
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </button>
      <div className="tw-cap">
        <h3>{t.title}</h3>
        <span className="tw-bar">
          <img className="av" src={t.photo} alt="" />
          <span>
            <b>{t.name}</b>
            <small>
              {t.role}, {t.company}
            </small>
          </span>
        </span>
      </div>
    </article>
  );
}

// A slot animates its height to whatever card it holds, so the column below glides rather than jumps.
function Slot({
  out,
  children,
  onEnter,
  onLeave,
}: {
  out: boolean;
  children: ReactNode;
  onEnter: () => void;
  onLeave: () => void;
}) {
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
    <div
      className={`tw-slot${out ? " out" : ""}`}
      style={{ height: h }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
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
  const playing = useRef(new Set<number>()); // slots whose clip is playing — never swapped mid-clip
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
    const videosOn = visibleRef.current.filter(
      (s) => s !== slot && isVideo(cur[s]),
    ).length;
    let pool = TESTIMONIALS.map((_, i) => i).filter((i) => !cur.includes(i));
    // below the minimum it must be a video, at the maximum a text card;
    // in between it is a coin toss, so either kind can land anywhere
    const wantVideo =
      videosOn < MIN_VIDEOS[colsRef.current]
        ? true
        : videosOn >= MAX_VIDEOS[colsRef.current]
          ? false
          : Math.random() < 0.5;
    const kind = pool.filter((i) => isVideo(i) === wantVideo);
    if (kind.length) pool = kind;
    const fresh = pool.filter((i) => !recent.current.includes(i));
    const next = pick(fresh.length ? fresh : pool);
    if (next === undefined) return;

    recent.current = [cur[slot], ...recent.current].slice(0, 6);
    target.current = cur.map((id, s) => (s === slot ? next : id));
    lastSwap.current[slot] = performance.now();
    busy.current.add(slot);
    endedWhileHovered.current.delete(slot);
    playing.current.delete(slot);
    setLeaving((l) => [...l, slot]);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(
      () => {
        setShown((s) => s.map((id, i) => (i === slot ? next : id)));
        setLeaving((l) => l.filter((x) => x !== slot));
        busy.current.delete(slot);
      },
      reduce ? 0 : FADE,
    );
  };

  // The first render is fixed (it is server-rendered); straight after, the
  // videos move to random slots so the wall never opens the same way twice.
  useEffect(() => {
    const vis = COLUMNS[colsRef.current].flat();
    const n = MIN_VIDEOS[colsRef.current] + (Math.random() < 0.5 ? 1 : 0);
    const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    const vSlots = shuffle(vis).slice(0, Math.min(n, VIDEO_IDS.length));
    const v = shuffle(VIDEO_IDS),
      t = shuffle(TEXT_IDS);
    const next = Array.from({ length: SLOTS }, (_, s) => (vSlots.includes(s) ? v.shift() : t.shift()) ?? t.shift() ?? -1);
    target.current = next;
    setShown(next);
  }, []);

  // The phone strip: a real sideways scroller, so a finger can swipe it either way,
  // moved on by script at the Integrations marquee's speed. It holds while touched
  // or hovered and picks up again a moment after; at either end of the first copy
  // it jumps by one copy, which looks the same, so it never runs out.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (cols !== 1 || !inView || !el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const SPEED = 24; // px a second
    let pos = el.scrollLeft;
    let held = false;
    let resume = 0;
    let last = 0;
    let raf = 0;
    const hold = () => {
      held = true;
      clearTimeout(resume);
    };
    const release = () => {
      clearTimeout(resume);
      resume = window.setTimeout(() => {
        held = false;
        pos = el.scrollLeft;
      }, 1200);
    };
    const wrap = () => {
      const half = el.scrollWidth / 2;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
      else if (el.scrollLeft <= 0) el.scrollLeft += half;
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!held) {
        pos += SPEED * dt;
        const half = el.scrollWidth / 2;
        if (pos >= half) pos -= half;
        el.scrollLeft = pos;
      }
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("touchend", release);
    el.addEventListener("touchcancel", release);
    el.addEventListener("mouseenter", hold);
    el.addEventListener("mouseleave", release);
    const onScroll = () => held && wrap();
    el.addEventListener("scroll", onScroll, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resume);
      el.removeEventListener("touchstart", hold);
      el.removeEventListener("touchend", release);
      el.removeEventListener("touchcancel", release);
      el.removeEventListener("mouseenter", hold);
      el.removeEventListener("mouseleave", release);
      el.removeEventListener("scroll", onScroll);
    };
  }, [cols, inView]);

  // Only run (and only play videos) while the section is on screen.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Every 2–3s, swap one card that isn't hovered, playing, or freshly changed.
  const swapOneText = useEffectEvent(() => {
    const now = performance.now();
    const ready = visibleRef.current.filter(
      (s) =>
        !hovered.current.has(s) &&
        !busy.current.has(s) &&
        !playing.current.has(s) &&
        now - lastSwap.current[s] >
          (isVideo(target.current[s]) ? VIDEO_REST : REST),
    );
    if (ready.length && !document.hidden) swap(pick(ready));
  });
  useEffect(() => {
    if (!inView) return;
    let id = 0;
    const tick = () => {
      id = window.setTimeout(
        () => {
          swapOneText();
          tick();
        },
        SWAP_EVERY[0] + Math.random() * (SWAP_EVERY[1] - SWAP_EVERY[0]),
      );
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
        <section
          className="tc tw"
          id="x-love"
          data-screen-label="Testimonials"
          ref={section}
        >
          <div
            dangerouslySetInnerHTML={{ __html: DECO }}
            style={{ display: "contents" }}
          />
          <div className="tw-panel x-rv">
            <div className="tw-head">
              <span className="y-kick">Testimonials</span>
              <h2 className="tw-h">What operators are saying</h2>
            </div>
            {/* phones: every testimonial on one strip that scrolls right to left on its
                own, endlessly, and can be swiped either way (the cards go twice) */}
            {cols === 1 ? (
              <div className="tw-marquee" ref={strip}>
                <div className="tw-mtrack">
                  {[0, 1].flatMap((copy) =>
                    TESTIMONIALS.map((t, id) => (
                      <div className="tw-mslot" key={`${copy}-${id}`} aria-hidden={copy ? true : undefined}>
                        {t.kind === "video" ? (
                          <VideoCard
                            t={t}
                            active={inView}
                            loop
                            muted={audible !== id}
                            onToggleSound={() => setAudible((a) => (a === id ? null : id))}
                            onPlaying={() => {}}
                            onEnded={() => {}}
                          />
                        ) : (
                          <TextCard t={t} />
                        )}
                      </div>
                    )),
                  )}
                </div>
              </div>
            ) : (
            <div
              className={`tw-grid c${cols}`}
              style={{ ["--cols" as string]: cols }}
            >
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
                            onPlaying={(on) =>
                              on
                                ? playing.current.add(slot)
                                : playing.current.delete(slot)
                            }
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
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
