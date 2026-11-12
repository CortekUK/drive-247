import type { ProofNumber } from "@/content/proof";

/*
 * A dashboard dial for one of the landing page's numbers: a 240° sweep of ticks with a
 * redline, a progress arc in the brand and a needle, plus a small line picture in the
 * dial's open foot. The needle's resting point is decoration only (the dial has no
 * scale), so it never claims anything the number beside it does not.
 *
 * Drawn in the calm house style: thin light outlines, one accent, no hard shadows.
 */

const CX = 100;
const CY = 96;
const R = 78;
const START = -120;
const SWEEP = 240;
const TICKS = 40;
/** The last ticks, before the end of the sweep, are the redline. */
const REDLINE_FROM = 0.84;

/** Where each dial's needle comes to rest, as a share of the sweep. */
const REST: Record<ProofNumber["icon"], number> = {
  money: 0.9,
  days: 0.82,
  agreement: 0.86,
  verified: 0.78,
  operators: 0.72,
};

const point = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return [CX + radius * Math.sin(rad), CY - radius * Math.cos(rad)] as const;
};

function arc(radius: number) {
  const [x1, y1] = point(START, radius);
  const [x2, y2] = point(START + SWEEP, radius);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const TRACK = arc(R);
const TICK_MARKS = Array.from({ length: TICKS + 1 }, (_, index) => {
  const share = index / TICKS;
  const major = index % 5 === 0;
  const angle = START + SWEEP * share;
  const [x1, y1] = point(angle, R - 9);
  const [x2, y2] = point(angle, R - (major ? 19 : 14));
  // Rounded: Node and the browser can differ in the last digits of sin/cos, and the raw
  // floats then failed hydration (a server/client attribute mismatch on every tick).
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), major, red: share >= REDLINE_FROM };
});

/** The line pictures, each drawn in a 24×24 box. */
function Icon({ name }: { name: ProofNumber["icon"] }) {
  switch (name) {
    case "money":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M14.8 8.6c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.6 5.8 4.6 0 1.3-1.2 2.3-3 2.3-1.3 0-2.4-.5-3-1.4M12 5.8v1.6M12 16.4V18" />
        </>
      );
    case "days":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          <path d="m8.8 14.4 2.2 2.1 4.2-4.2" />
        </>
      );
    case "agreement":
      return (
        <>
          <path d="M6 3h8.5L19 7.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5M7.5 12h8M7.5 15h4" />
          <path d="M7.5 18.4c1-.9 1.7-.9 2.3 0 .6.9 1.3.9 2.3 0" />
        </>
      );
    case "verified":
      return (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <circle cx="8.5" cy="11" r="2.2" />
          <path d="M5.2 16c.6-1.6 1.8-2.4 3.3-2.4s2.7.8 3.3 2.4M14 10h4.5M14 13h3" />
        </>
      );
    case "operators":
      return (
        <>
          <path d="M3.5 20h17M5 20V9.5M19 20V9.5" />
          <path d="M3.5 9.5 5.2 4h13.6l1.7 5.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5c0 1.4-1.1 2.5-2.5 2.5S3.5 10.9 3.5 9.5Z" />
          <path d="M10 20v-4.5h4V20" />
        </>
      );
  }
}

/** `progress` runs 0 → 1 with the count-up; the needle and the arc follow it. */
export function NumberGauge({ icon, progress }: { icon: ProofNumber["icon"]; progress: number }) {
  const reach = REST[icon] * Math.min(1, Math.max(0, progress));
  const angle = START + SWEEP * reach;

  return (
    <svg className="nm-gauge" viewBox="0 0 200 190" aria-hidden focusable="false">
      {/* The dial face, softly lifted off the page. */}
      <circle className="nm-gauge-face" cx={CX} cy={CY} r={R + 10} />
      <path className="nm-gauge-track" d={TRACK} />
      <path className="nm-gauge-fill" d={TRACK} pathLength={1} strokeDasharray={`${reach} 1`} />
      {TICK_MARKS.map((tick, index) => (
        <line
          key={index}
          className={`nm-gauge-tick${tick.major ? " is-major" : ""}${tick.red ? " is-red" : ""}`}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
        />
      ))}
      {/* The needle, then its hub. */}
      <g transform={`rotate(${angle.toFixed(2)} ${CX} ${CY})`}>
        <path className="nm-gauge-needle" d={`M ${CX - 2.6} ${CY} L ${CX} ${CY - R + 20} L ${CX + 2.6} ${CY} Z`} />
      </g>
      <circle className="nm-gauge-hub" cx={CX} cy={CY} r="7" />
      <circle className="nm-gauge-hub-dot" cx={CX} cy={CY} r="2.2" />
      {/* The picture sits in the dial's open foot, like a gauge's symbol. */}
      <g className="nm-gauge-icon" transform={`translate(${CX - 13} ${CY + 40}) scale(1.08)`}>
        <Icon name={icon} />
      </g>
    </svg>
  );
}
