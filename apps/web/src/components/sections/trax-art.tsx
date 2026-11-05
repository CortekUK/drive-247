import type { ReactNode } from "react";

/*
 * One scene for each part of the business Trax reads, drawn to the same standard as the
 * launch section's: real objects, ink outlines, every tone an indigo. No people and no car.
 * The colours are CSS variables set by .tm-section, so one drawing serves both themes.
 */

const INK = "var(--ta-ink)";
const CARD = "var(--ta-card)";
const ACC = "var(--ta-acc)";
const DEEP = "var(--ta-deep)";
const PALE = "var(--ta-pale)";
const MID = "var(--ta-mid)";
const SOFT = "var(--ta-soft)";
const ON = "var(--ta-on)";

const outline = { stroke: INK, strokeWidth: 1.8, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Art({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 220 96" fill="none" aria-hidden className="tm-art-svg">
      {children}
    </svg>
  );
}

function Bar({ x, y, w, fill = SOFT, h = 5 }: { x: number; y: number; w: number; fill?: string; h?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;
}

function Tick({ x, y, r = 10 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={ACC} {...outline} />
      <path d={`m${x - r * 0.42} ${y} ${r * 0.32} ${r * 0.32} ${r * 0.58} ${-r * 0.62}`} stroke={ON} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Sparkle({ x, y, r, fill = ACC }: { x: number; y: number; r: number; fill?: string }) {
  const k = r * 0.2;
  return <path d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`} fill={fill} />;
}

/* A stack of coins, standing on `base`. */
function Coins({ x, base, count, r = 19 }: { x: number; base: number; count: number; r?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const y = base - i * 12;
        const top = i === count - 1;
        return (
          <g key={i}>
            <path d={`M${x - r} ${y - 8}v8c0 4 ${r * 0.45} 7 ${r} 7s${r} -3 ${r} -7v-8Z`} fill={top ? PALE : CARD} {...outline} />
            <ellipse cx={x} cy={y - 8} rx={r} ry={7} fill={top ? PALE : CARD} {...outline} />
          </g>
        );
      })}
    </>
  );
}

/* The wall calendar: a booking across the week, its handover time, and the tag for the keys. */
export function RentalsArt() {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((col) => ({ row, col })));
  return (
    <Art>
      <path d="M62 62C50 62 48 54 42 50" {...outline} />
      <g transform="rotate(-10 30 62)">
        <path d="M20 50l10-8 10 8v26a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3Z" fill={PALE} {...outline} />
        <circle cx={30} cy={51} r={2.6} fill={CARD} {...outline} />
        <Bar x={25} y={60} w={10} fill={DEEP} h={3.5} />
        <Bar x={25} y={67} w={7} fill={DEEP} h={3.5} />
      </g>

      <rect x={62} y={14} width={96} height={74} rx={10} fill={CARD} {...outline} />
      <path d="M62 33V24a10 10 0 0 1 10-10h76a10 10 0 0 1 10 10v9Z" fill={DEEP} {...outline} />
      {[84, 136].map((x) => (
        <rect key={x} x={x - 2.5} y={7} width={5} height={14} rx={2.5} fill={MID} {...outline} />
      ))}
      {cells.map(({ row, col }) => (
        <rect key={`${row}${col}`} x={69.5 + col * 16.4} y={39 + row * 15.5} width={12} height={10} rx={3} fill={SOFT} />
      ))}
      <rect x={85} y={53.5} width={46} height={12} rx={6} fill={ACC} {...outline} />
      <circle cx={92} cy={59.5} r={2.2} fill={ON} />
      <circle cx={124} cy={59.5} r={2.2} fill={ON} />

      <circle cx={166} cy={68} r={18} fill={CARD} {...outline} />
      <circle cx={166} cy={68} r={13} fill={SOFT} />
      <path d="M166 59v9l6 4" stroke={DEEP} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={194} y={26} r={7} />
      <Sparkle x={206} y={46} r={3.5} fill={PALE} />
    </Art>
  );
}

/* The card file, with one customer's record pulled up: their history and how they rate. */
export function CustomersArt() {
  return (
    <Art>
      <rect x={58} y={30} width={104} height={40} rx={5} fill={SOFT} {...outline} />
      <path d="M128 30v-5a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v5Z" fill={MID} {...outline} />
      <path d="M66 30v-5a3 3 0 0 1 3-3h14v8Z" fill={PALE} {...outline} />

      <rect x={72} y={6} width={76} height={60} rx={6} fill={CARD} {...outline} />
      <Bar x={81} y={15} w={34} fill={DEEP} />
      <Bar x={81} y={26} w={56} />
      <Bar x={81} y={35} w={44} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Sparkle key={i} x={85 + i * 11} y={48} r={4.5} fill={i < 4 ? ACC : MID} />
      ))}
      <Tick x={148} y={10} />

      <path d="M50 56h120l-5 32a3 3 0 0 1-3 2.6H58a3 3 0 0 1-3-2.6Z" fill={DEEP} {...outline} />
      <rect x={92} y={65} width={36} height={15} rx={3} fill={CARD} {...outline} />
      <text x={110} y={76} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={INK}>A–Z</text>

      <Sparkle x={30} y={30} r={7} />
      <Sparkle x={192} y={40} r={4.5} fill={PALE} />
    </Art>
  );
}

/* The yard: numbered bays with a light over each, one standing open and free. */
export function FleetArt() {
  return (
    <Art>
      <path d="M8 90H212" {...outline} strokeWidth={2.2} />
      <rect x={32} y={26} width={156} height={64} fill={CARD} {...outline} />
      <path d="M22 30 110 6l88 24Z" fill={DEEP} {...outline} />
      <circle cx={110} cy={20} r={4} fill={PALE} {...outline} />

      {[
        { x: 42, n: 1, open: false },
        { x: 88, n: 2, open: true },
        { x: 134, n: 3, open: false },
      ].map(({ x, n, open }) => (
        <g key={n}>
          <circle cx={x + 22} cy={35} r={3} fill={open ? ACC : MID} {...outline} strokeWidth={1.2} />
          <rect x={x} y={42} width={44} height={48} fill={open ? DEEP : SOFT} {...outline} />
          {open ? (
            <>
              <rect x={x} y={42} width={44} height={11} fill={MID} {...outline} />
              <path d={`M${x + 8} 90l5-26h18l5 26`} stroke={ON} strokeOpacity={0.35} strokeWidth={1.4} strokeDasharray="3 3" />
            </>
          ) : (
            <>
              <path d={`M${x} 52h44M${x} 62h44M${x} 72h44M${x} 82h44`} stroke={INK} strokeOpacity={0.4} strokeWidth={1.2} />
              <rect x={x + 15} y={59} width={14} height={13} rx={2.5} fill={CARD} {...outline} strokeWidth={1.4} />
              <text x={x + 22} y={69} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={INK}>{n}</text>
            </>
          )}
        </g>
      ))}

      <path d="M203 90l-6-1 5-20h4l5 20-6 1Z" fill={ACC} {...outline} />
      <path d="M199.5 80h9" stroke={ON} strokeWidth={2.2} />
      <path d="M14 90V60" {...outline} strokeWidth={2.2} />
      <circle cx={14} cy={54} r={8} fill={PALE} {...outline} />
      <Sparkle x={196} y={50} r={4.5} />
      <Sparkle x={24} y={24} r={6} />
    </Art>
  );
}

/* The toolbox open, a cog being seen to, and the job card ticked off. */
export function MaintenanceArt() {
  return (
    <Art>
      <g transform="translate(82 20) rotate(-22)">
        <path d="M-4 8H4V44H-4Z" fill={MID} {...outline} />
        <path d="M-4 -10.3-4 -2 4 -2 4 -10.3A11 11 0 1 1 -4 -10.3Z" fill={MID} {...outline} />
      </g>
      <g transform="translate(134 8) rotate(16)">
        <rect x={-1.8} y={18} width={3.6} height={30} fill={INK} />
        <rect x={-6} y={0} width={12} height={20} rx={5} fill={PALE} {...outline} />
      </g>

      <path d="M90 38v-7a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v7" {...outline} strokeWidth={3} />
      <rect x={52} y={48} width={112} height={42} rx={6} fill={ACC} {...outline} />
      <rect x={48} y={36} width={120} height={18} rx={5} fill={DEEP} {...outline} />
      <rect x={100} y={48} width={16} height={13} rx={2.5} fill={PALE} {...outline} />
      <Bar x={62} y={72} w={26} fill={ON} h={3.5} />
      <Bar x={128} y={72} w={26} fill={ON} h={3.5} />

      <circle cx={26} cy={68} r={13} stroke={ACC} strokeWidth={6} strokeDasharray="4.6 3.6" />
      <circle cx={26} cy={68} r={10} fill={CARD} {...outline} />
      <circle cx={26} cy={68} r={3.5} fill={DEEP} />

      <g transform="rotate(5 194 60)">
        <rect x={178} y={32} width={32} height={54} rx={4} fill={CARD} {...outline} />
        <rect x={187} y={28} width={14} height={8} rx={2} fill={DEEP} {...outline} />
        {[46, 58, 70].map((y) => (
          <g key={y}>
            <path d={`m183 ${y} 2.4 2.4 4-4.6`} stroke={ACC} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Bar x={193} y={y - 2} w={11} h={4} />
          </g>
        ))}
      </g>
      <Sparkle x={34} y={30} r={6} />
    </Art>
  );
}

/* A card tapped, and the money landing on your stack. */
export function PaymentsArt() {
  return (
    <Art>
      <g transform="rotate(-8 62 52)">
        <rect x={18} y={24} width={88} height={54} rx={8} fill={ACC} {...outline} />
        <rect x={18.9} y={35} width={86.2} height={11} fill={DEEP} />
        <rect x={28} y={54} width={15} height={12} rx={2.5} fill={PALE} {...outline} />
        <path d="M28 60h15M35.5 54v12" stroke={INK} strokeWidth={0.9} />
        <Bar x={52} y={55} w={42} fill={ON} h={3.5} />
        <Bar x={52} y={63} w={26} fill={ON} h={3.5} />
      </g>
      <path d="M112 46a14 14 0 0 1 0 18M119 41a22 22 0 0 1 0 28" stroke={ACC} strokeWidth={2} strokeLinecap="round" />
      <path d="M116 22c12-9 28-11 42-6" stroke={ACC} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 6" />
      <path d="m153 10 7 7-9 3" stroke={ACC} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Coins x={176} base={84} count={4} />
      <text x={176} y={51} textAnchor="middle" fontSize={11} fontWeight={700} fill={DEEP}>$</text>
      <Sparkle x={208} y={22} r={6} />
      <Sparkle x={14} y={16} r={4} fill={PALE} />
    </Art>
  );
}

/* The invoice, its total picked out, the stamp ready and the envelope it goes out in. */
export function InvoicesArt() {
  const teeth = Array.from({ length: 6 }, () => "l-6.33 5l-6.33-5").join("");
  return (
    <Art>
      <g transform="rotate(-7 42 66)">
        <rect x={14} y={48} width={56} height={36} rx={4} fill={CARD} {...outline} />
        <path d="m14 52 28 18 28-18" fill={SOFT} {...outline} />
      </g>

      <path d={`M70 5H146V85${teeth}Z`} fill={CARD} {...outline} />
      <Bar x={79} y={14} w={30} fill={DEEP} />
      <circle cx={132} cy={17} r={5} fill={ACC} />
      <Bar x={79} y={28} w={58} />
      <Bar x={79} y={38} w={46} />
      <Bar x={79} y={48} w={52} />
      <rect x={79} y={60} width={58} height={14} rx={4} fill={ACC} {...outline} />
      <Bar x={85} y={65} w={22} fill={ON} h={3.5} />
      <Bar x={118} y={65} w={13} fill={ON} h={3.5} />

      <circle cx={178} cy={30} r={11} fill={ACC} {...outline} />
      <path d="M171 40h14l2 22h-18Z" fill={MID} {...outline} />
      <rect x={160} y={62} width={36} height={12} rx={3} fill={DEEP} {...outline} />
      <rect x={156} y={82} width={44} height={7} rx={3.5} fill={PALE} {...outline} />
      <Sparkle x={204} y={22} r={6} />
    </Art>
  );
}

/* The renter's card, locked: the money is held, not spent. */
export function DepositsArt() {
  return (
    <Art>
      <g transform="rotate(-6 80 56)">
        <rect x={22} y={26} width={104} height={62} rx={9} fill={MID} {...outline} />
        <rect x={22.9} y={39} width={102.2} height={12} fill={DEEP} />
        <rect x={33} y={60} width={16} height={13} rx={2.5} fill={CARD} {...outline} />
        <Bar x={57} y={62} w={34} fill={DEEP} h={3.5} />
        <Bar x={57} y={70} w={22} fill={DEEP} h={3.5} />
      </g>

      <path d="M126 50V30a18 18 0 0 1 36 0v20" stroke={INK} strokeWidth={9.5} strokeLinecap="round" />
      <path d="M126 50V30a18 18 0 0 1 36 0v20" stroke={PALE} strokeWidth={6} strokeLinecap="round" />
      <rect x={112} y={44} width={64} height={46} rx={10} fill={ACC} {...outline} />
      <rect x={117} y={49} width={54} height={36} rx={6} stroke={ON} strokeOpacity={0.55} strokeDasharray="3 3" />
      <circle cx={144} cy={62} r={6} fill={ON} />
      <path d="M141 64h6l1.5 11h-9Z" fill={ON} />

      <Sparkle x={194} y={30} r={7} />
      <Sparkle x={200} y={60} r={4} fill={PALE} />
      <Sparkle x={22} y={16} r={5} />
    </Art>
  );
}

/* What running a fleet costs: the fuel, the receipt, and the money on its way out. */
export function ExpensesArt() {
  const teeth = Array.from({ length: 5 }, () => "l-5.2 5l-5.2-5").join("");
  return (
    <Art>
      <rect x={24} y={84} width={58} height={7} rx={3} fill={MID} {...outline} />
      <rect x={30} y={14} width={44} height={70} rx={7} fill={DEEP} {...outline} />
      <rect x={37} y={22} width={30} height={20} rx={3} fill={CARD} {...outline} />
      <Bar x={42} y={29} w={20} fill={ACC} h={5} />
      <rect x={42} y={52} width={20} height={16} rx={3} fill={ACC} />
      <path d="M74 38h7a6 6 0 0 1 6 6v28a5 5 0 0 0 10 0V38l-8-9" {...outline} strokeWidth={2.4} />

      <path d={`M112 6H164V84${teeth}Z`} fill={CARD} {...outline} />
      <Bar x={120} y={15} w={22} fill={DEEP} />
      <Bar x={120} y={27} w={36} />
      <Bar x={120} y={37} w={28} />
      <Bar x={120} y={47} w={32} />
      <rect x={120} y={60} width={36} height={12} rx={4} fill={ACC} {...outline} />

      <path d="M168 50c8-1 16-6 21-14" stroke={ACC} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 6" />
      <circle cx={196} cy={21} r={13} fill={PALE} {...outline} />
      <text x={196} y={25.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={DEEP}>$</text>
      <Sparkle x={184} y={72} r={5.5} />
      <Sparkle x={14} y={22} r={4} fill={PALE} />
    </Art>
  );
}
