"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { threadEndX } from "./operations-dashboard";
import "./launch-section.css";

/*
 * Opening a shop, in four scenes, with no people or car in them. Each sits at the top of
 * its card. Colours come from .ls-art-base and .ls-art-lit, so one drawing serves both layers.
 */
const ART_W = 300;
const ART_H = 212;
const RAIL_Y = 52;
const INK = "var(--la-ink)";
const CARD = "var(--la-card)";
const ACC = "var(--la-acc)";
const DEEP = "var(--la-deep)";
const MID = "var(--la-mid)";
const SOFT = "var(--la-soft)";
const ON = "var(--la-on)";
const WARM = "var(--la-warm)"; // the lightest strong tint of the accent; the art stays in one colour
const TEXT = "var(--la-text)";
const outline = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Art({ rail, children }: { rail?: [number, number]; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${ART_W} ${ART_H}`} fill="none" aria-hidden>
      {rail && <path d={`M${rail[0]} ${RAIL_Y}H${rail[1]}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />}
      {children}
    </svg>
  );
}

function Tick({ x, y, r = 13 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={ACC} {...outline} />
      <path d={`m${x - r * 0.42} ${y} ${r * 0.32} ${r * 0.32} ${r * 0.58} ${-r * 0.62}`} stroke={ON} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Sparkle({ x, y, r, fill = ACC }: { x: number; y: number; r: number; fill?: string }) {
  const k = r * 0.2;
  return <path d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`} fill={fill} />;
}

/* What clips a thing onto the thread. */
function Clip({ x }: { x: number }) {
  return <rect x={x - 3} y={RAIL_Y - 6} width={6} height={15} rx={3} fill={ACC} {...outline} />;
}

/* A real key: round bow with a hole for the ring, shaft, and cut teeth. */
function Key({ x, y, tilt, length = 30, fill = CARD }: { x: number; y: number; tilt: number; length?: number; fill?: string }) {
  const shaft = y + 15;
  const end = shaft + length;
  return (
    <g transform={`rotate(${tilt} ${x} ${y})`}>
      <path
        d={`M${x - 2.4} ${shaft}V${end - 1}l2.4 3 2.4-3v-3h3.6v-3.4h-2.4v-3h2.4v-3.4h-3.6V${shaft}Z`}
        fill={fill}
        {...outline}
      />
      <circle cx={x} cy={y + 8} r={7.5} fill={fill} {...outline} />
      <circle cx={x} cy={y + 7} r={2.2} fill={SOFT} {...outline} strokeWidth={1} />
    </g>
  );
}

/* The plans are sized by fleet, so a small ring, a full ring, and a very full ring. */
function PlanArt() {
  return (
    <Art rail={[18, 282]}>
      {/* Small fleet */}
      <g>
        <Clip x={52} />
        <circle cx={52} cy={68} r={8} {...outline} />
        <Key x={52} y={70} tilt={40} length={30} fill={MID} />
        <Key x={52} y={70} tilt={-10} length={36} />
      </g>

      {/* Big fleet */}
      <g>
        <Clip x={248} />
        <circle cx={248} cy={68} r={9} {...outline} />
        {[-46, -24, 24, 46].map((tilt) => (
          <Key key={tilt} x={248} y={72} tilt={tilt} length={28} fill={Math.abs(tilt) > 30 ? MID : CARD} />
        ))}
        <Key x={248} y={72} tilt={0} length={36} />
      </g>

      {/* The one being taken: it hangs forward, carrying its terms with it */}
      <g className="ls-swing" style={{ transformOrigin: `150px ${RAIL_Y}px` }}>
        <Clip x={150} />
        <circle cx={150} cy={70} r={10} strokeWidth={2.2} stroke={INK} />
        <Key x={150} y={70} tilt={-66} length={40} fill={MID} />
        <rect x={120} y={82} width={60} height={92} rx={16} fill={ACC} {...outline} />
        <rect x={125} y={87} width={50} height={82} rx={12} stroke={ON} strokeOpacity={0.55} strokeDasharray="3 3" />
        <circle cx={150} cy={96} r={4} fill={CARD} {...outline} />
        <text x={150} y={124} textAnchor="middle" fontSize={18} fontWeight={700} letterSpacing="-0.02em" fill={ON}>Free</text>
        <text x={150} y={144} textAnchor="middle" fontSize={18} fontWeight={700} letterSpacing="-0.02em" fill={ON}>trial</text>
        <path d="M150 174c0 7 12 6 20 10" {...outline} />
        <g transform="rotate(8 196 190)">
          <path d="M170 182l8-7h52a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4h-52l-8-7Z" fill={WARM} {...outline} />
          <circle cx={177} cy={190} r={2.4} fill={CARD} {...outline} />
          <text x={207} y={194} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing="-0.02em" fill={DEEP}>$0 today</text>
        </g>
      </g>

      <Sparkle x={92} y={146} r={8} />
      <Sparkle x={108} y={170} r={4.5} fill={WARM} />
      <Sparkle x={206} y={132} r={5.5} fill={MID} />
    </Art>
  );
}

/* The name goes up on a sign, the web address hangs under it, and the portal starts building. */
function NameArt() {
  return (
    <Art rail={[50, 250]}>
      {/* The sign, hung from its bar */}
      <g className="ls-swing" style={{ transformOrigin: `150px ${RAIL_Y}px` }}>
        <Clip x={72} />
        <Clip x={228} />
        <path d="M72 60V76M228 60V76" {...outline} strokeWidth={2} strokeDasharray="3.5 3" />
        <path d="M34 92a16 16 0 0 0 16-16h200a16 16 0 0 0 16 16v28a16 16 0 0 0-16 16H50a16 16 0 0 0-16-16Z" fill={DEEP} {...outline} />
        <path d="M42 95a18 18 0 0 0 14-13h188a18 18 0 0 0 14 13v22a18 18 0 0 0-14 13H56a18 18 0 0 0-14-13Z" stroke={WARM} strokeWidth={1.2} />
        <text x={150} y={113} textAnchor="middle" fontSize={23} fontWeight={700} letterSpacing="-0.035em" fill={ON}>Summit Rentals</text>
        <Sparkle x={55} y={106} r={3.5} fill={WARM} />
        <Sparkle x={245} y={106} r={3.5} fill={WARM} />

        {/* The address it becomes */}
        <path d="M108 136v9M192 136v9" {...outline} />
        <rect x={62} y={145} width={176} height={22} rx={11} fill={CARD} {...outline} />
        <rect x={72} y={153} width={8} height={7} rx={1.5} fill={ACC} />
        <path d="M73.5 153v-2a2.5 2.5 0 0 1 5 0v2" stroke={ACC} strokeWidth={1.4} />
        <text x={85} y={160} fontSize={10.5} fontWeight={600} letterSpacing="-0.01em" fill={TEXT}>summit-rentals.drive-247.com</text>
      </g>

      {/* The portal, already coming together */}
      <g>
        <rect x={12} y={172} width={58} height={32} rx={4} fill={CARD} {...outline} />
        <path d="M12 180v-4a4 4 0 0 1 4-4h50a4 4 0 0 1 4 4v4Z" fill={ACC} {...outline} />
        <path d="M26 180v24" {...outline} />
        <rect x={31} y={185} width={14} height={8} rx={1.5} fill={ACC} />
        <rect x={49} y={185} width={15} height={8} rx={1.5} fill={SOFT} />
        <rect x={31} y={196} width={33} height={3.5} rx={1.75} fill={MID} />
        <circle cx={72} cy={178} r={8} fill={CARD} {...outline} />
        <circle cx={72} cy={178} r={4} stroke={ACC} strokeWidth={3} strokeDasharray="2.4 1.6" />
      </g>

      {/* The paint that did it */}
      <g>
        <path d="M250 176v24a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4v-24Z" fill={ACC} {...outline} />
        <ellipse cx={267} cy={176} rx={17} ry={5} fill={WARM} {...outline} />
        <path d="M250 182c0 6 3 6 3 11 0 3 4 3 4 0v-7" fill={WARM} {...outline} />
        <path d="M266 192h12" stroke={ON} strokeWidth={3} strokeLinecap="round" strokeOpacity={0.7} />
        <g transform="rotate(30 268 170)">
          <rect x={265} y={126} width={6} height={32} rx={3} fill={MID} {...outline} />
          <rect x={263} y={157} width={10} height={8} fill={CARD} {...outline} />
          <path d="M263 165h10c1 5-2 9-5 12-3-3-6-7-5-12Z" fill={WARM} {...outline} />
        </g>
      </g>
    </Art>
  );
}

/* A card tapped, the sale approved, and the money on its way to your bank. */
function ConnectArt() {
  const keys = [0, 1, 2, 3].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));
  return (
    <Art>
      {/* The receipt, curling out of the top */}
      <path d="M124 34V6l5.2 4 5.2-4 5.2 4 5.2-4 5.2 4 5.2-4 5.2 4 5.2-4 5 4v28Z" fill={CARD} {...outline} />
      <path d="M131 18h22M131 25h14" stroke={MID} strokeWidth={3} strokeLinecap="round" />

      {/* The machine */}
      <path d="M124 26h52a12 12 0 0 1 12 12v146a14 14 0 0 1-14 14h-48a14 14 0 0 1-14-14V38a12 12 0 0 1 12-12Z" fill={DEEP} {...outline} />
      <rect x={118} y={32} width={64} height={3} rx={1.5} fill={ON} fillOpacity={0.4} />
      <rect x={120} y={40} width={60} height={54} rx={7} fill={CARD} {...outline} />
      <Tick x={150} y={58} r={10} />
      <text x={150} y={84} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing="-0.01em" fill={TEXT}>Approved</text>
      {keys.map(({ row, col }) => (
        <rect
          key={`${row}${col}`}
          x={122 + col * 20}
          y={102 + row * 18}
          width={16}
          height={13}
          rx={3.5}
          fill={row === 3 && col === 2 ? WARM : ON}
          fillOpacity={row === 3 && col === 2 ? 1 : 0.26}
        />
      ))}
      <rect x={100} y={196} width={100} height={10} rx={5} fill={MID} {...outline} />

      {/* The card, and the tap */}
      <path d="M100 84a14 14 0 0 1 0 18M107 79a22 22 0 0 1 0 28" stroke={ACC} strokeWidth={2} strokeLinecap="round" />
      <g transform="rotate(-12 50 108)">
        <rect x={8} y={80} width={84} height={54} rx={8} fill={ACC} {...outline} />
        <rect x={8.8} y={91} width={82.4} height={10} fill={DEEP} />
        <rect x={18} y={108} width={15} height={12} rx={2.5} fill={WARM} {...outline} />
        <path d="M18 114h15M25.5 108v12" stroke={INK} strokeWidth={0.9} />
        <path d="M42 112h40M42 120h24" stroke={ON} strokeOpacity={0.7} strokeWidth={3} strokeLinecap="round" />
      </g>

      {/* Held safe */}
      <path d="M38 160l16 6v14c0 10-7 18-16 22-9-4-16-12-16-22v-14Z" fill={CARD} {...outline} />
      <path d="m31 180 5 5 10-11" stroke={ACC} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />

      {/* Paid out to your bank */}
      <path d="M194 128c16-6 34-4 48 4" stroke={ACC} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="1 6.5" />
      <path d="m238 125 6 8-9 3" stroke={ACC} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M212 158l34-20 34 20Z" fill={ACC} {...outline} />
      <circle cx={246} cy={150} r={4} fill={WARM} {...outline} />
      <rect x={212} y={158} width={68} height={7} rx={1.5} fill={CARD} {...outline} />
      {[220, 240, 260].map((x) => (
        <rect key={x} x={x} y={165} width={12} height={29} fill={SOFT} {...outline} />
      ))}
      <rect x={208} y={194} width={76} height={10} rx={2} fill={CARD} {...outline} />
      <Sparkle x={272} y={124} r={6} fill={WARM} />
    </Art>
  );
}

/* Grand opening: the bunting is up and the lights are on. */
function LiveArt() {
  const stripes = Array.from({ length: 9 }, (_, i) => 49 + i * 22);
  const flags = [31, 44];
  return (
    <Art>
      <path d="M8 204H292" {...outline} strokeWidth={2} />

      {/* Bunting, from the lamp to the shop */}
      <path d="M26 72 60 52" {...outline} />
      {flags.map((x, i) => (
        <path key={x} d={`M${x} ${72 - (x - 26) * 0.588}l10-5.9 1 12.5Z`} fill={i % 2 ? WARM : ACC} {...outline} />
      ))}

      {/* A street lamp, on the same supply */}
      <path d="M26 204V96" {...outline} strokeWidth={2.4} />
      <path d="M18 204h16" {...outline} strokeWidth={3} />
      <path d="M16 96h20l-3-16H19Z" fill={SOFT} {...outline} />
      <path className="ls-lights" d="M16 96h20l-3-16H19Z" fill={WARM} {...outline} />
      <path d="M17 80h18l-9-8Z" fill={DEEP} {...outline} />

      {/* The shop, built like a browser window */}
      <path d="M60 204V38a12 12 0 0 1 12-12h156a12 12 0 0 1 12 12v166Z" fill={CARD} {...outline} />
      <path d="M60 64V38a12 12 0 0 1 12-12h156a12 12 0 0 1 12 12v26Z" fill={DEEP} {...outline} />
      {[72, 81, 90].map((cx) => (
        <circle key={cx} cx={cx} cy={45} r={2.6} fill={ON} fillOpacity={0.75} />
      ))}
      <rect x={98} y={36} width={122} height={18} rx={9} fill={CARD} {...outline} />
      <text x={159} y={49} textAnchor="middle" fontSize={8.2} fontWeight={600} fill={TEXT}>summit-rentals.drive-247.com</text>

      {/* Door */}
      <rect x={72} y={106} width={52} height={98} rx={3} fill={DEEP} {...outline} />
      <rect x={79} y={113} width={38} height={60} rx={2} fill={SOFT} />
      <rect className="ls-lights" x={79} y={113} width={38} height={60} rx={2} fill={WARM} />
      <rect x={79} y={180} width={38} height={16} rx={2} fill={ON} fillOpacity={0.18} />
      <rect x={112} y={150} width={3.5} height={18} rx={1.75} fill={INK} />
      <g className="ls-swing" style={{ transformOrigin: "98px 116px" }}>
        <path d="M88 130l10-14 10 14" {...outline} />
        <rect x={80} y={129} width={36} height={19} rx={3} fill={ON} {...outline} />
        <text x={98} y={143} textAnchor="middle" fontSize={11.5} fontWeight={700} letterSpacing="-0.02em" fill={DEEP}>Open</text>
      </g>

      {/* Shop window, with a day's bookings on show */}
      <rect x={134} y={106} width={94} height={66} rx={3} fill={SOFT} {...outline} />
      <rect className="ls-lights" x={134} y={106} width={94} height={66} rx={3} fill={WARM} />
      <rect x={134} y={106} width={94} height={66} rx={3} {...outline} />
      {[156, 206].map((x) => (
        <g key={x}>
          <path d={`M${x} 106v8`} {...outline} />
          <path d={`M${x - 7} 121a7 7 0 0 1 14 0Z`} fill={DEEP} {...outline} />
        </g>
      ))}
      <rect x={146} y={130} width={40} height={36} rx={4} fill={CARD} {...outline} />
      <rect x={146} y={130} width={40} height={9} rx={3} fill={ACC} />
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect key={`${row}${col}`} x={150 + col * 8.4} y={143 + row * 7.2} width={6} height={5} rx={1.2} fill={row === 1 && col > 0 ? ACC : SOFT} />
        )),
      )}
      <rect x={190} y={144} width={32} height={16} rx={8} fill={ACC} {...outline} />
      <text x={206} y={155.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={ON}>Book</text>

      {/* Planter under the window */}
      {[[146, 186, 10, MID], [162, 182, 12, ACC], [180, 186, 10, MID], [197, 182, 12, ACC], [215, 186, 10, MID]].map(([cx, cy, radius, fill]) => (
        <circle key={String(cx)} cx={cx} cy={cy} r={radius} fill={String(fill)} {...outline} />
      ))}
      <rect x={134} y={190} width={94} height={14} rx={2} fill={DEEP} {...outline} />

      {/* Awning */}
      {stripes.map((x, i) => (
        <path key={x} d={`M${x} 68h22v22a11 9 0 0 1-22 0Z`} fill={i % 2 === 0 ? ACC : CARD} {...outline} />
      ))}

      {/* Sign on the pavement */}
      <path d="M254 204l8-46h20l8 46" fill={CARD} {...outline} />
      <text x={272} y={176} textAnchor="middle" fontSize={8} fontWeight={700} fill={TEXT}>Book</text>
      <text x={272} y={186} textAnchor="middle" fontSize={8} fontWeight={700} fill={TEXT}>online</text>

      <Tick x={240} y={28} r={14} />
      <Sparkle x={280} y={72} r={8} />
      <Sparkle x={268} y={104} r={4.5} fill={WARM} />
      <Sparkle x={46} y={18} r={5.5} fill={WARM} />
    </Art>
  );
}

const STEPS = [
  { art: PlanArt, title: "Pick your plan", body: "Start with a free trial." },
  { art: NameArt, title: "Name your business", body: "Your name becomes your web address, and your portal is built." },
  { art: ConnectArt, title: "Connect Stripe or Square", body: "So you can take payments from day one." },
  { art: LiveArt, title: "You're launched", body: "Your booking site is live. Add your cars and take bookings." },
];

/* Must match the media query that shows .ls-line in launch-section.css. */
export const LINE_MEDIA = "(min-width: 1200px) and (min-height: 640px)";
/* The share of the pinned scroll that draws the line; the rest holds on the finished row. */
const DRAW_SHARE = 0.86;
/* Half the width of .ls-step-no, which sits centred on each card's left edge. */
const NODE_R = 18;

/*
 * The features thread, carried on. It comes in along the left of the heading, turns into the
 * row, and runs from card to card, passing behind each. A card fills as a whole the moment the
 * tip reaches it. Where the row can't sit in one line, the cards fill as they scroll in.
 */
function useLaunchLine() {
  const trackRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const [line, setLine] = useState<{ w: number; h: number; d: string; enters: number[]; endX: number; y: number; tail: number } | null>(null);
  const [reached, setReached] = useState(0);

  useEffect(() => {
    const pin = pinRef.current;
    if (!pin) return;
    const media = matchMedia(LINE_MEDIA);

    const measure = () => {
      const startX = threadEndX();
      if (!media.matches || startX === null) {
        setLine(null);
        return;
      }
      const box = pin.getBoundingClientRect();
      const tiles = [...pin.querySelectorAll(".ls-card")].map((card) => card.getBoundingClientRect());
      const left = tiles[0].left - box.left;
      const y = tiles[0].top + tiles[0].height / 2 - box.top;
      const nodeLeft = left - NODE_R;
      const lane = nodeLeft / 2;
      const turn = Math.min(36, lane);
      const last = tiles[tiles.length - 1];
      const endX = last.left + last.width / 2 - box.left;
      // On behind the last card and down out of the section, to where Trax picks it up.
      const track = trackRef.current!;
      const bottom = box.height + track.parentElement!.offsetHeight - track.offsetHeight;
      setLine({
        w: box.width,
        h: box.height,
        d: `M${startX} 0C${startX} 84 ${lane} 56 ${lane} 150L${lane} ${y - turn}Q${lane} ${y} ${lane + turn} ${y}L${endX} ${y}L${endX} ${bottom}`,
        // Each card lights as the tip touches its number.
        enters: tiles.map((tile) => tile.left - box.left - NODE_R),
        endX,
        y,
        tail: bottom - y,
      });
    };

    measure();
    const size = new ResizeObserver(measure);
    size.observe(pin);
    pin.querySelectorAll(".ls-head, .ls-steps").forEach((el) => size.observe(el));
    media.addEventListener("change", measure);
    return () => {
      size.disconnect();
      media.removeEventListener("change", measure);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin) return;
    const live = liveRef.current;
    const tip = tipRef.current;

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReached(STEPS.length);
      if (live) live.style.strokeDashoffset = "0";
      if (tip) tip.style.display = "none";
      return;
    }

    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!line || !live || !tip) {
        const tiles = [...pin.querySelectorAll(".ls-card")];
        const seen = tiles.findIndex((tile) => tile.getBoundingClientRect().top > innerHeight * 0.75);
        setReached(seen < 0 ? tiles.length : seen);
        return;
      }
      const total = live.getTotalLength();
      const run = total - line.tail;
      const enters = line.enters.map((x) => run - (line.endX - x));
      const top = track.getBoundingClientRect().top;
      // Takes over exactly where the features thread stops: this section's top at 70% of the screen.
      const start = innerHeight * 0.7;
      const pinned = (track.offsetHeight - pin.offsetHeight) * DRAW_SHARE;
      // Across the cards while the screen holds; then down and out, its tip at 70% of the screen like the rest of the thread.
      const across = -top / pinned;
      const length =
        top > 0
          ? enters[0] * Math.max(0, (start - top) / start)
          : across <= 1
            ? enters[0] + (run - enters[0]) * across
            : run + Math.min(line.tail, Math.max(0, start - pin.getBoundingClientRect().top - line.y));
      live.style.strokeDashoffset = String(1 - length / total);
      const at = live.getPointAtLength(length);
      tip.setAttribute("cx", String(at.x));
      tip.setAttribute("cy", String(at.y));
      tip.style.visibility = length > 0 && length < total ? "visible" : "hidden";
      setReached(enters.filter((enter) => length >= enter).length);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [line]);

  return { trackRef, pinRef, liveRef, tipRef, line, reached };
}

export function LaunchSection() {
  const { trackRef, pinRef, liveRef, tipRef, line, reached } = useLaunchLine();

  return (
    <section id="launch" aria-labelledby="launch-heading" className="ls-section">
      <div ref={trackRef} className="ls-track">
        <div ref={pinRef} className="ls-pin">
          {line && (
            <svg className="ls-line" viewBox={`0 0 ${line.w} ${line.h}`} width={line.w} height={line.h} fill="none" aria-hidden>
              <path className="pg-thread-rest" d={line.d} />
              <path ref={liveRef} className="pg-thread-live" pathLength={1} d={line.d} />
              <circle ref={tipRef} className="pg-thread-tip" r="5" />
            </svg>
          )}

          <div className="ls-head ls-inner">
            <h2
              id="launch-heading"
              className="text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[56px] lg:leading-[1.05]"
            >
              Launch in minutes.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Pick a plan and name your business. Your portal and booking site are built and online in minutes,
              ready for your cars.
            </p>
          </div>

          <ol className="ls-steps">
            {STEPS.map((step, i) => {
              const Picture = step.art;
              return (
                <li key={step.title} className={`ls-step${i < reached ? " is-lit" : ""}`}>
                  <p className="ls-step-no">{i + 1}</p>
                  <div className="ls-card">
                    <div className="ls-tile" aria-hidden>
                      <div className="ls-art-base">
                        <Picture />
                      </div>
                      <div className="ls-art-lit">
                        <Picture />
                      </div>
                    </div>
                    <div className="ls-step-words">
                      <b>{step.title}</b>
                      <span>{step.body}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
