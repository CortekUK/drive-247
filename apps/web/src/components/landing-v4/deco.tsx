/*
 * Background art for the sections with empty space either side (the portal
 * and pricing), after the team's references: soft filled shapes in the
 * corners (a blob, big circles), wide translucent ribbons, thin flowing lines
 * crossing them, and a small dot grid — in the brand purple, kept to the outer
 * edges, behind the content.
 *
 * Each variant is one SVG laid over the whole section. Its two halves are
 * pinned to the section's left and right edges (xMinYMid / xMaxYMid), so the
 * art hugs the edges at any width instead of stretching under the content.
 */
type Variant = "portal" | "pricing";

function Dots({ x, y }: { x: number; y: number }) {
  return (
    <g className="dots">
      {Array.from({ length: 20 }, (_, k) => (
        <circle key={k} cx={x + (k % 4) * 16} cy={y + Math.floor(k / 4) * 16} r={2.4} />
      ))}
    </g>
  );
}

// the left edge art, drawn in a 520 × 1000 box at the section's left
const LEFT: Record<Variant, React.ReactNode> = {
  // a soft blob in the top-left corner with two lines flowing across it
  portal: (
    <>
      <path className="fill" d="M0 0 H260 C 280 80 210 130 150 145 C 90 160 50 210 0 220 Z" />
      <path className="line" d="M-20 200 C 70 175 130 110 210 100 S 340 55 390 -20" />
      <path className="line" d="M-20 170 C 50 180 110 140 160 80 S 220 -10 260 -30" />
    </>
  ),
  // pricing (the team's ribbon reference): a wide translucent ribbon looping in, a
  // second sweeping down, and thin lines crossing both
  pricing: (
    <>
      <path className="ribbon" d="M-40 300 C 120 230 300 240 320 420 C 340 600 160 820 -40 1020" />
      <path className="line" d="M160 -20 C 120 300 230 640 470 1020" />
      <path className="line" d="M-20 860 C 140 740 300 720 400 1040" />
    </>
  ),
};

// the right edge art, drawn in a 520 × 1000 box at the section's right
const RIGHT: Record<Variant, React.ReactNode> = {
  portal: (
    <>
      <Dots x={420} y={70} />
      <circle className="ring" cx={330} cy={250} r={120} />
      {/* bottom-right corner: a soft blob with two thin lines sweeping across it */}
      <path className="fill" d="M540 790 C 470 780 420 800 380 850 C 340 900 290 930 220 940 C 170 948 150 975 150 1010 H540 Z" />
      <path className="line" d="M100 1030 C 170 960 220 870 300 845 S 430 860 540 815" />
      <path className="line" d="M160 1030 C 230 980 250 900 330 880 S 460 900 540 855" />
    </>
  ),
  pricing: (
    <>
      <path className="ribbon" d="M560 160 C 420 260 280 280 200 160 S 140 -10 180 -40" />
      <path className="ribbon" d="M560 640 C 380 760 260 880 220 1040" />
      <path className="line" d="M380 -20 C 360 260 440 480 560 560" />
      <path className="line" d="M560 260 C 400 420 300 700 280 1040" />
      <path className="line" d="M80 1030 C 220 900 380 860 560 870" />
    </>
  ),
};

export function SectionDeco({ variant }: { variant: Variant }) {
  return (
    <div className="l4-deco" aria-hidden="true">
      <svg className="l" viewBox="0 0 520 1000" preserveAspectRatio="xMinYMid slice">
        {LEFT[variant]}
      </svg>
      <svg className="r" viewBox="0 0 520 1000" preserveAspectRatio="xMaxYMid slice">
        {RIGHT[variant]}
      </svg>
    </div>
  );
}
