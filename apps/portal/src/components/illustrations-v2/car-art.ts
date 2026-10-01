/**
 * The approved Drive247 car, as an SVG string: the illustrated three-quarter
 * coupe with simple rounded headlights (docs/brand/illustration-guide.md §5).
 *
 * A string rather than JSX so it stays byte-identical to the guide's drawing
 * code; it is static art built from constants only — nothing user-supplied is
 * ever interpolated — so rendering it with `dangerouslySetInnerHTML` is safe.
 * `id` must be unique per render (gradient ids are global in an HTML page).
 */

export type CarPaint = {
  top: string; mid: string; bot: string; line: string; rim: string; glass: string;
  pillar: string; chrome: string; trim: string; tyre: string; rimFace: string;
  rimEdge: string; spoke: string; hub: string; shadow: string; shOp: number; sheen: number;
};

/**
 * White body, ink outline, and the roof line and side trim in the tenant's theme
 * colour (`--primary`), so a teal tenant's car has teal trim. The white body is
 * kept in dark mode too: a pale car reads well on the soft dark card.
 */
export const MONO_PAINT: CarPaint = {
  top: '#ffffff', mid: '#f6f6f7', bot: '#e4e4e7', line: '#111114', rim: 'hsl(var(--primary))',
  glass: '#1c1c21', pillar: '#ffffff', chrome: '#71717a', trim: 'hsl(var(--primary))', tyre: '#111114',
  rimFace: '#e4e4e7', rimEdge: '#3f3f46', spoke: '#52525b', hub: '#111114',
  shadow: '#000000', shOp: 0.1, sheen: 0.9,
};

const lamp = (line: string) =>
  `<rect x="14" y="10" width="176" height="42" rx="21" fill="#f4f4f5" stroke="${line}" stroke-width="5"/>` +
  `<rect x="26" y="18" width="152" height="26" rx="13" fill="#ffffff"/>` +
  `<ellipse cx="62" cy="24" rx="20" ry="4" fill="#ffffff" opacity=".9"/>`;

/** Three-quarter coupe facing left. Drawing box about 330 × 140. */
export function carSvg(p: CarPaint, id: string): string {
  const rim = (cx: number, cy: number, r: number) => {
    let s =
      `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" fill="${p.tyre}"/>` +
      `<ellipse cx="${cx + 1.5}" cy="${cy}" rx="${r * 0.66}" ry="${r * 0.66}" fill="${p.rimFace}" stroke="${p.rimEdge}" stroke-width="1.4"/>`;
    for (let a = 0; a < 360; a += 36) {
      const t = (a * Math.PI) / 180;
      s += `<path d="M${cx + 1.5} ${cy} L${(cx + 1.5 + r * 0.6 * Math.cos(t)).toFixed(1)} ${(cy + r * 0.6 * Math.sin(t)).toFixed(1)}" stroke="${p.spoke}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    return s + `<circle cx="${cx + 1.5}" cy="${cy}" r="${r * 0.18}" fill="${p.hub}"/>`;
  };
  const mesh = [28, 36, 44, 52, 60, 68, 76].map((x) => `<path d="M${x} 105 L${x - 1} 114"/>`).join('');
  return `<defs>
  <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.bot}"/></linearGradient>
  <linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="${p.sheen}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<ellipse cx="172" cy="130" rx="160" ry="10" fill="${p.shadow}" opacity="${p.shOp}"/>
<path d="M6 102 Q4 90 14 84 Q30 75 80 69 Q106 64 132 48 Q166 28 212 26 L240 28 Q272 32 292 56 L312 62 Q326 66 326 84 L326 102 Q326 112 314 112 L292 114 Q290 90 266 90 Q242 90 240 115 L146 120 Q144 96 118 96 Q92 96 90 121 L44 120 Q18 119 10 112 Q6 108 6 102 Z" fill="url(#${id}b)" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M84 84 Q200 72 318 70 L318 76 Q200 78 86 90 Z" fill="url(#${id}h)"/>
<path d="M18 82 Q70 70 126 52" fill="none" stroke="#fff" stroke-opacity="${p.sheen * 0.7}" stroke-width="3" stroke-linecap="round"/>
<path d="M104 66 Q130 48 164 36 L176 36 Q160 52 154 66 Z" fill="${p.glass}"/>
<path d="M162 66 Q178 44 210 36 L240 36 Q266 40 284 60 Z" fill="${p.glass}"/>
<path d="M218 36 L214 64" stroke="${p.pillar}" stroke-width="3.5"/>
<path d="M104 66 Q130 48 164 36 L176 36 M162 66 Q178 44 210 36 L240 36 Q266 40 284 60" fill="none" stroke="${p.chrome}" stroke-width="1.2" opacity=".8"/>
<path d="M122 62 L142 46 L150 46 L130 63 Z" fill="#fff" opacity=".55"/><path d="M226 58 L240 40 L246 40 L232 58 Z" fill="#fff" opacity=".25"/>
<path d="M132 48 Q166 28 212 26 L240 28 Q272 32 292 56" fill="none" stroke="${p.rim}" stroke-width="2"/>
<path d="M150 64 L164 60 L166 68 L152 70 Z" fill="${p.mid}" stroke="${p.line}" stroke-width="1.4"/>
<path d="M158 72 Q156 96 160 114 M238 70 Q240 88 238 100" fill="none" stroke="${p.line}" stroke-opacity=".28" stroke-width="1.3"/>
<path d="M196 82 L210 81" stroke="${p.line}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
<path d="M290 56 L316 52 L314 60 L294 62 Z" fill="${p.line}"/>
<g transform="matrix(0.44 -0.1 0.03 0.3 10 81)">${lamp(p.line)}</g>
<path d="M318 72 L326 73 L326 82 L318 81 Z" fill="#f43f5e"/>
<path d="M16 104 Q48 106 82 104 L80 114 Q48 116 20 112 Z" fill="${p.line}"/>
<g stroke="${p.rim}" stroke-opacity=".35" stroke-width="1">${mesh}</g>
<path d="M12 116 Q46 122 88 121" fill="none" stroke="${p.line}" stroke-width="2.4" stroke-linecap="round"/>
<path d="M92 98 Q200 86 322 86" fill="none" stroke="${p.trim}" stroke-width="2" opacity=".9"/>
<path d="M148 118 L238 114" stroke="${p.line}" stroke-width="3" stroke-opacity=".45" stroke-linecap="round"/>
${rim(118, 116, 21)}${rim(266, 110, 21)}`;
}
