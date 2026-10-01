"use client";

import { useTilt3D } from "@/hooks/use-tilt-3d";
import { normalizeCardBrand, cardBrandLabel, CardBrandIcon, type CardBrand } from "@/components/subscription/card-brand-icon";

/**
 * The card on file, drawn as a physical card: brand-coloured face, chip,
 * contactless mark, masked number, name and expiry, and the network's mark
 * bottom-right. It tilts toward the pointer and a light sheen follows it (useTilt3D).
 *
 * v2 only (billing-v2). Real data only: brand / last4 / expiry come from the
 * subscription row the Stripe webhook writes. No cardholder name is stored,
 * so the name line is the account's business name.
 *
 * Motion follows V2_PLAN §12: transform + opacity only, 200ms, ease-out in and
 * ease-in out, and nothing moves under `prefers-reduced-motion`.
 */

interface Face {
  /** Deep base, top-left → bottom-right. */
  base: [string, string, string];
  /** Soft light in the top-right corner. */
  glowA: string;
  /** Soft light in the bottom-left corner. */
  glowB: string;
}

const FACES: Record<CardBrand, Face> = {
  // Rich cobalt: a confident, classic bank-card blue — saturated but calm,
  // and deliberately NOT the app's indigo accent.
  visa: { base: ["#0a2f6e", "#0f469c", "#1a5fbf"], glowA: "rgba(147,197,253,0.22)", glowB: "rgba(3,20,60,0.40)" },
  // Slate charcoal warmed by a copper glow: the understated metal look, on
  // which the Mastercard circles stay crisp.
  mastercard: { base: ["#22262c", "#30353d", "#434a54"], glowA: "rgba(217,119,6,0.22)", glowB: "rgba(0,0,0,0.30)" },
  amex: { base: ["#003b73", "#0060b0", "#1f8ee6"], glowA: "rgba(186,230,253,0.45)", glowB: "rgba(45,212,191,0.28)" },
  discover: { base: ["#121212", "#1f1f1f", "#2c2c2c"], glowA: "rgba(255,96,0,0.40)", glowB: "rgba(255,160,60,0.18)" },
  diners: { base: ["#082f5c", "#0a4a8a", "#1565a8"], glowA: "rgba(147,197,253,0.40)", glowB: "rgba(56,189,248,0.22)" },
  jcb: { base: ["#0a2a5e", "#0b3e8a", "#155e75"], glowA: "rgba(74,222,128,0.30)", glowB: "rgba(248,113,113,0.26)" },
  unionpay: { base: ["#06302f", "#0a4d4b", "#0e3d74"], glowA: "rgba(45,212,191,0.35)", glowB: "rgba(248,113,113,0.24)" },
  link: { base: ["#07182b", "#0a2540", "#0f3b5c"], glowA: "rgba(0,214,111,0.40)", glowB: "rgba(56,189,248,0.22)" },
  unknown: { base: ["#0f172a", "#1e293b", "#334155"], glowA: "rgba(129,140,248,0.40)", glowB: "rgba(148,163,184,0.25)" },
};

function faceBackground(f: Face): string {
  return [
    `radial-gradient(100% 75% at 100% 0%, ${f.glowA} 0%, transparent 58%)`,
    `radial-gradient(80% 70% at 0% 100%, ${f.glowB} 0%, transparent 58%)`,
    `linear-gradient(135deg, ${f.base[0]} 0%, ${f.base[1]} 52%, ${f.base[2]} 100%)`,
  ].join(", ");
}

/** The fine wave lines printed on real cards. Stretches with the card. */
const WAVES = Array.from({ length: 18 }, (_, i) => {
  const y = -20 + i * 16;
  return `M-10 ${y + 40} C 110 ${y - 10}, 230 ${y + 90}, 420 ${y + 20}`;
});

function Guilloche() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 252"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <g fill="none" stroke="#fff" strokeWidth="0.5" opacity="0.06">
        {WAVES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

function expiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/** Visa's wordmark, in white on the card face. */
function VisaMark() {
  return (
    <svg viewBox="0 0 64 20" style={{ height: "1.55em", width: "auto" }} aria-hidden>
      <text
        x="0"
        y="17"
        fill="#fff"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="21"
        fontStyle="italic"
        fontWeight="900"
        letterSpacing="-0.5"
      >
        VISA
      </text>
    </svg>
  );
}

/** Mastercard's two interlocking circles. */
function MastercardMark() {
  return (
    <svg viewBox="0 0 48 30" style={{ height: "2.1em", width: "auto" }} aria-hidden>
      <circle cx="17" cy="15" r="13" fill="#eb001b" />
      <circle cx="31" cy="15" r="13" fill="#f79e1b" />
      <path d="M24 4.2a13 13 0 0 1 0 21.6a13 13 0 0 1 0-21.6z" fill="#ff5f00" />
    </svg>
  );
}

function AmexMark() {
  return (
    <span className="block rounded-[3px] border border-white/80 font-extrabold leading-tight tracking-wider text-white" style={{ fontSize: "0.62em", padding: "0.2em 0.5em" }}>
      AMERICAN
      <br />
      EXPRESS
    </span>
  );
}

function BrandMark({ brand, raw }: { brand: CardBrand; raw: string | null }) {
  if (brand === "visa") return <VisaMark />;
  if (brand === "mastercard") return <MastercardMark />;
  if (brand === "amex") return <AmexMark />;
  // Everything else: the existing full-colour artwork on a small white plate.
  return (
    <span className="block rounded-md bg-white/95" style={{ padding: "0.25em" }}>
      <CardBrandIcon brand={raw} className="h-[1.5em] w-[2.25em]" />
    </span>
  );
}

function Chip() {
  return (
    <svg viewBox="0 0 44 34" style={{ height: "2.2em", width: "2.85em" }} aria-hidden>
      <defs>
        <linearGradient id="chip-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe9b0" />
          <stop offset="0.28" stopColor="#e2c26a" />
          <stop offset="0.55" stopColor="#c9a13f" />
          <stop offset="0.8" stopColor="#e8cd7d" />
          <stop offset="1" stopColor="#b48a2c" />
        </linearGradient>
        <linearGradient id="chip-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="43" height="33" rx="6" fill="url(#chip-gold)" stroke="#9c7a26" strokeWidth="0.7" />
      {/* Six contact pads around a centre pad, as on an EMV chip. */}
      <g fill="none" stroke="#8a6a1a" strokeWidth="0.9" strokeLinejoin="round" opacity="0.75">
        <path d="M0.5 11.5h12.5M0.5 22.5h12.5M31 11.5h12.5M31 22.5h12.5" />
        <path d="M13 0.5v11a3 3 0 0 0 0 11v11M31 0.5v11a3 3 0 0 1 0 11v11" />
        <rect x="16" y="9" width="12" height="16" rx="3" />
        <path d="M22 0.5v8.5M22 25v8.5" />
      </g>
      <rect x="0.5" y="0.5" width="43" height="33" rx="6" fill="url(#chip-shine)" />
    </svg>
  );
}

function Contactless() {
  return (
    <svg viewBox="0 0 24 24" style={{ height: "1.6em", width: "1.6em" }} className="opacity-80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M8.5 7.5a6.5 6.5 0 0 1 0 9" />
      <path d="M12 5a10 10 0 0 1 0 14" />
      <path d="M15.5 2.5a13.5 13.5 0 0 1 0 19" />
    </svg>
  );
}

export function PaymentCard3D({
  brand: rawBrand,
  last4,
  expMonth,
  expYear,
  name,
  isPrimary,
  actionLabel,
  numberGroups,
  expiryText,
  fit = true,
}: {
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  /** Shown on the name line. */
  name: string | null;
  isPrimary: boolean;
  /** A small frosted label top-right, e.g. "Manage card" when the card opens a dialog. */
  actionLabel?: string;
  /** Overrides the number line, e.g. a live "4242 42•• •••• ••••" while typing. */
  numberGroups?: string[];
  /** Overrides the VALID THRU value, e.g. "08/2-" while it's being typed. */
  expiryText?: string;
  /** md+: size to the parent size container (Billing). Off for a fixed preview. */
  fit?: boolean;
}) {
  const brand = normalizeCardBrand(rawBrand);
  const face = FACES[brand];
  const exp = expiry(expMonth, expYear);
  const { ref: cardRef, sheenRef, handlers } = useTilt3D();

  return (
    <div
      // Phones: column width up to 440px. md+: the parent is a size container
      // (its Billing band) and the card is the largest 1.586 rectangle that
      // fits it, capped at 440×277 — the face scales with it.
      className={`w-full max-w-[440px] [perspective:1000px] ${fit ? "md:aspect-[1.586] md:h-[min(100cqh,63cqw,277px)] md:w-auto md:max-w-none" : ""}`}
      {...handlers}
    >
      <div
        ref={cardRef}
        role="img"
        aria-label={`${cardBrandLabel(rawBrand)} card ending ${last4}${exp ? `, expires ${exp}` : ""}${isPrimary ? ", primary" : ""}`}
        className={`relative aspect-[1.586] w-full select-none ${fit ? "md:h-full" : ""} overflow-hidden rounded-2xl [transform-style:preserve-3d] motion-reduce:!transform-none motion-reduce:!transition-none`}
        style={{
          background: faceBackground(face),
          color: "#ffffff",
          containerType: "inline-size",
          boxShadow:
            "0 1px 2px rgba(15,23,42,0.18), 0 8px 16px -4px rgba(15,23,42,0.25), 0 24px 40px -12px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.07)",
        }}
      >
        {/* Printed texture, a fine grain like printed plastic, and a gloss
            that fades down from the top edge. */}
        <Guilloche />
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] mix-blend-overlay">
          <filter id="card-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#card-grain)" />
        </svg>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.09] to-transparent" />

        {/* Sheen that follows the pointer (opacity + transform only). */}
        <div
          ref={sheenRef}
          aria-hidden
          className="pointer-events-none absolute -inset-1/2 opacity-0 motion-reduce:hidden"
          style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 45%)" }}
        />

        {/* Laid out like a real card front: chip and contactless on the left a
            third of the way down, the embossed number under them, VALID THRU
            beneath it, the name bottom-left and the network bottom-right.
            Everything is sized in em off ONE font-size that is a share of the
            card's own width (4cqw — the card is a size container), so the face
            scales as a whole. */}
        <div className="relative h-full" style={{ fontSize: "4cqw" }}>
          {actionLabel && (
            <span
              className="absolute rounded-full border border-white/25 bg-white/10 font-medium leading-none text-white/90 backdrop-blur-sm transition-colors duration-200 ease-out group-hover:bg-white/20 motion-reduce:transition-none"
              style={{ right: "1.5em", top: "1.3em", fontSize: "0.62em", padding: "0.5em 0.95em", letterSpacing: "0.04em" }}
            >
              {actionLabel}
            </span>
          )}
          <div className="absolute flex items-center" style={{ left: "1.5em", top: "27%", gap: "0.75em" }}>
            <Chip />
            <span className="opacity-75">
              <Contactless />
            </span>
          </div>

          {/* Embossed, silver-tipped digits: the fill is a metal gradient and
              the relief is a drop-shadow filter (a text-shadow would show
              through a clipped-gradient fill). */}
          <p
            className="absolute flex items-center whitespace-nowrap font-mono font-semibold leading-none"
            style={{
              left: "1.5em",
              top: "57%",
              fontSize: "1.32em",
              letterSpacing: "0.1em",
              gap: "0.85em",
              backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e2e6f0 45%, #aeb4c4 60%, #f4f6fb 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(0 -0.5px 0 rgba(255,255,255,0.35)) drop-shadow(0 1px 1px rgba(0,0,0,0.6))",
            }}
          >
            {numberGroups ? (
              numberGroups.map((g, i) => <span key={i}>{g}</span>)
            ) : (
              <>
                <span aria-hidden>••••</span>
                <span aria-hidden>••••</span>
                <span aria-hidden>••••</span>
                <span>{last4}</span>
              </>
            )}
          </p>

          <div className="absolute flex items-center" style={{ left: "42%", top: "71.5%", gap: "0.5em" }}>
            <span className="text-right font-medium uppercase leading-[1.05] opacity-70" style={{ fontSize: "0.42em", letterSpacing: "0.06em" }}>
              Valid
              <br />
              thru
            </span>
            <span
              className="font-mono font-semibold leading-none"
              style={{
                fontSize: "0.9em",
                letterSpacing: "0.08em",
                backgroundImage: "linear-gradient(180deg, #ffffff 0%, #d9dde8 55%, #f4f6fb 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.55))",
              }}
            >
              {expiryText ?? exp ?? "--/--"}
            </span>
          </div>

          <div className="absolute flex items-end justify-between" style={{ left: "1.5em", right: "1.5em", bottom: "1.2em", gap: "1em" }}>
            <p
              className="min-w-0 truncate font-mono font-semibold uppercase leading-none"
              style={{
                fontSize: "0.82em",
                letterSpacing: "0.1em",
                backgroundImage: "linear-gradient(180deg, #ffffff 0%, #d9dde8 55%, #f4f6fb 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.55))",
              }}
            >
              {name || ""}
            </p>
            <div className="flex shrink-0 items-end">
              <BrandMark brand={brand} raw={rawBrand} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A small thumbnail of the same card face, for lists (the card manager). No
 * tilt, no digits beyond the last four — just enough to recognise the card.
 */
export function CardThumb({ brand: rawBrand, last4 }: { brand: string | null; last4: string }) {
  const brand = normalizeCardBrand(rawBrand);
  return (
    <div
      aria-hidden
      className="relative aspect-[1.586] w-[76px] shrink-0 overflow-hidden rounded-lg text-white shadow-sm"
      style={{ background: faceBackground(FACES[brand]), containerType: "inline-size" }}
    >
      <div className="relative h-full" style={{ fontSize: "9cqw" }}>
        <span className="absolute font-mono leading-none opacity-90" style={{ left: "0.9em", top: "0.9em", fontSize: "1em" }}>
          {last4}
        </span>
        <span className="absolute flex items-end" style={{ right: "0.8em", bottom: "0.7em", fontSize: "0.55em" }}>
          <BrandMark brand={brand} raw={rawBrand} />
        </span>
      </div>
    </div>
  );
}
