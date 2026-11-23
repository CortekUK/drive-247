
/**
 * Trax's glyph: one large four-point star with a small one at its top right,
 * both filled (Ghulam, Nov 10 2026). It replaced lucide's outlined `Sparkles`
 * on every Trax mark. Drawn in `currentColor`, so the mark decides the colour.
 */
export const TRAX_GLYPH_PATH =
  "M10.5 5Q12.4 11.6 19 13.5Q12.4 15.4 10.5 22Q8.6 15.4 2 13.5Q8.6 11.6 10.5 5ZM18.75 2Q19.45 4.55 22 5.25Q19.45 5.95 18.75 8.5Q18.05 5.95 15.5 5.25Q18.05 4.55 18.75 2Z";

export function TraxGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.6}
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={TRAX_GLYPH_PATH} />
    </svg>
  );
}
