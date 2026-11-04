import { carSvg, MONO_PAINT } from "@/components/landing-v2/car-art";

/*
 * One small picture for each part of the business Trax reads, in the portal's scene
 * style (apps/portal/.../illustrations-v2/scene-kit.tsx, ILLUSTRATION_GUIDE.md §4a):
 * ink lines, white cards, the accent only where it matters. No words in the pictures.
 * The colours are CSS variables set by .tm-section, so one drawing serves both themes.
 */

const INK = "var(--ta-ink)";
const CARD = "var(--ta-card)";
const LITE = "var(--ta-lite)";
const ACC = "var(--ta-acc)";
const SOFT = "var(--ta-soft)";
const ON = "var(--ta-on)";

const outline = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const };

function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 150 84" aria-hidden className="tm-art-svg">
      {children}
    </svg>
  );
}

function Tick({ x, y, color = ON }: { x: number; y: number; color?: string }) {
  return <path d={`M${x} ${y} l4 4 l7 -8`} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />;
}

function Face({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={SOFT} />
      <circle cy={-r * 0.18} r={r * 0.38} fill="#d9a88a" />
      <path d={`M${-r * 0.65} ${r * 0.72} Q0 ${r * 0.05} ${r * 0.65} ${r * 0.72}`} fill={ACC} />
      <path
        d={`M${-r * 0.38} ${-r * 0.3} Q${-r * 0.36} ${-r * 0.66} 0 ${-r * 0.66} Q${r * 0.36} ${-r * 0.66} ${r * 0.38} ${-r * 0.3} Q${r * 0.18} ${-r * 0.48} 0 ${-r * 0.48} Q${-r * 0.18} ${-r * 0.48} ${-r * 0.38} ${-r * 0.3}Z`}
        fill="#1f2040"
      />
    </g>
  );
}

function Bar({ x, y, w, fill = LITE, h = 5 }: { x: number; y: number; w: number; fill?: string; h?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;
}

/* A calendar with a booking across it, and whose booking it is. */
export function RentalsArt() {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((col) => ({ row, col })));
  return (
    <Art>
      <rect x={32} y={8} width={86} height={68} rx={11} fill={CARD} {...outline} />
      <path d="M32 19 Q32 8 43 8 L107 8 Q118 8 118 19 L118 24 L32 24 Z" fill={INK} />
      <rect x={50} y={3} width={4} height={10} rx={2} fill={ACC} />
      <rect x={96} y={3} width={4} height={10} rx={2} fill={ACC} />
      {cells.map(({ row, col }) => (
        <rect key={`${row}${col}`} x={41 + col * 14.4} y={30 + row * 14} width={10.5} height={10} rx={3} fill={LITE} />
      ))}
      <rect x={55} y={43} width={54} height={12} rx={6} fill={ACC} />
      <Face x={109} y={49} r={11} />
    </Art>
  );
}

/* A customer's licence, checked. */
export function CustomersArt() {
  return (
    <Art>
      <rect x={28} y={16} width={94} height={60} rx={10} fill={CARD} {...outline} />
      <path d="M28 26 Q28 16 38 16 L112 16 Q122 16 122 26 L122 28 L28 28 Z" fill={SOFT} />
      <Bar x={38} y={20} w={30} fill={ACC} />
      <Face x={52} y={50} r={15} />
      <Bar x={74} y={38} w={38} />
      <Bar x={74} y={48} w={30} />
      <Bar x={74} y={58} w={34} />
      <circle cx={122} cy={18} r={11} fill={ACC} {...outline} />
      <Tick x={116} y={18} />
    </Art>
  );
}

/* The approved car, on the grid floor that is the guide's calendar. */
export function FleetArt() {
  return (
    <Art>
      <g stroke={LITE} strokeWidth={1.4}>
        <path d="M6 72 H144 M16 64 H134" />
        <path d="M30 64 L14 80 M58 64 L50 80 M92 64 L100 80 M120 64 L136 80" />
      </g>
      <g
        transform="translate(6 12) scale(.42)"
        dangerouslySetInnerHTML={{ __html: carSvg(MONO_PAINT, "tmfleet") }}
      />
    </Art>
  );
}

/* A job card, signed off, and the wrench that did it. */
export function MaintenanceArt() {
  return (
    <Art>
      <rect x={66} y={10} width={58} height={66} rx={10} fill={CARD} {...outline} />
      <Bar x={76} y={20} w={38} fill={INK} />
      {[34, 48, 62].map((y) => (
        <g key={y}>
          <circle cx={81} cy={y} r={5.5} fill={SOFT} />
          <path d={`M78 ${y} l2.4 2.4 l4.4 -5`} fill="none" stroke={ACC} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          <Bar x={91} y={y - 2.5} w={y === 48 ? 18 : 24} />
        </g>
      ))}
      <g transform="translate(-14 3)">
        <path d="M26 72 L56 36" stroke={INK} strokeWidth={9} strokeLinecap="round" />
        <path d="M26 72 L56 36" stroke={ACC} strokeWidth={4} strokeLinecap="round" />
        <path
          d="M49 34 A14 14 0 0 1 66 14 L58 24 L62 32 L71 33 L77 24 A14 14 0 0 1 58 42 Z"
          fill={CARD}
          {...outline}
        />
      </g>
    </Art>
  );
}

/* A card, and the money it brought in. */
export function PaymentsArt() {
  return (
    <Art>
      <g transform="rotate(-6 66 44)">
        <rect x={24} y={18} width={88} height={56} rx={10} fill={CARD} {...outline} />
        <rect x={24} y={30} width={88} height={11} fill={INK} />
        <rect x={34} y={50} width={15} height={11} rx={3} fill={ACC} />
        <Bar x={56} y={53} w={34} />
      </g>
      <circle cx={114} cy={56} r={17} fill={ACC} {...outline} />
      <text x={114} y={62} textAnchor="middle" fontSize={18} fontWeight={700} fill={ON}>$</text>
    </Art>
  );
}

/* An invoice with its total picked out. */
export function InvoicesArt() {
  return (
    <Art>
      <path
        d="M44 6 H106 V74 L98 68 L90 74 L82 68 L75 74 L68 68 L60 74 L52 68 L44 74 Z"
        fill={CARD}
        {...outline}
      />
      <Bar x={53} y={15} w={26} fill={INK} />
      <Bar x={53} y={27} w={44} />
      <Bar x={53} y={36} w={36} />
      <Bar x={53} y={45} w={40} />
      <rect x={53} y={54} width={44} height={8} rx={4} fill={ACC} />
      <circle cx={116} cy={24} r={12} fill={SOFT} stroke={INK} strokeWidth={2} />
      <text x={116} y={29} textAnchor="middle" fontSize={14} fontWeight={700} fill={ACC}>$</text>
    </Art>
  );
}

/* A hold on the card: covered, not spent. */
export function DepositsArt() {
  return (
    <Art>
      <rect x={22} y={28} width={84} height={48} rx={9} fill={CARD} {...outline} />
      <rect x={22} y={38} width={84} height={9} fill={LITE} />
      <Bar x={32} y={58} w={30} />
      <path
        d="M86 12 L108 5 L130 12 V36 Q130 58 108 70 Q86 58 86 36 Z"
        fill={ACC}
        {...outline}
      />
      <path d="M99 36 l7 7 l12 -14" fill="none" stroke={ON} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  );
}

/* A wallet, a receipt, and a coin on its way out. */
export function ExpensesArt() {
  return (
    <Art>
      <rect x={46} y={10} width={42} height={34} rx={5} fill={CARD} {...outline} />
      <Bar x={53} y={18} w={28} fill={INK} h={4} />
      <Bar x={53} y={27} w={22} h={4} />
      <rect x={30} y={28} width={84} height={48} rx={11} fill={CARD} {...outline} />
      <path d="M30 40 Q30 28 41 28 L103 28 Q114 28 114 39 L114 42 L30 42 Z" fill={INK} />
      <rect x={96} y={50} width={26} height={16} rx={8} fill={ACC} {...outline} />
      <circle cx={104} cy={58} r={2.6} fill={ON} />
      <path d="M100 26 Q110 14 122 18" fill="none" stroke={ACC} strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      <circle cx={130} cy={20} r={8} fill={ACC} {...outline} />
    </Art>
  );
}
