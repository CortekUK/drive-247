import { carSvg, MONO_PAINT } from "./car-art";

/*
 * Illustrations for the blog posters on the landing page, in the Drive247 illustration style,
 * "quiet confidence" (ILLUSTRATION_GUIDE.md at the repo root; boss, 2026-11-14: not the same
 * pictures as the portal's, the same vibe). Ink lines, white cards, grey bars for words, one
 * indigo for the thing that matters, one soft glow, the approved car only where the post is
 * about cars. No chips, no figures, no extra colours.
 *
 * Drawn on a 400 x 350 board, the poster's 4:3.5 shape. The art keeps to the top of the board,
 * and off its top-left corner (the category chip on phones), so the title reads clear at the
 * foot. Each picture draws itself twice, light and dark, and the theme picks one.
 *
 * Static art built from constants only (nothing user-supplied is interpolated), so rendering it
 * with `dangerouslySetInnerHTML` is safe. Decorative: the poster's title says what it is.
 */

type Pal = { ink: string; card: string; lite: string; acc: string; soft: string; mut: string; onAcc: string; glow: number; shade: number };

function pal(dark: boolean): Pal {
  return dark
    ? { ink: "#d4d4d8", card: "#1b1b22", lite: "#3a3a44", acc: "hsl(var(--v2-link))", soft: "hsl(var(--v2-primary) / 0.22)", mut: "#7a7a86", onAcc: "#0c0c12", glow: 0.3, shade: 0.35 }
    : { ink: "#111114", card: "#ffffff", lite: "#e4e4e7", acc: "hsl(var(--v2-primary))", soft: "hsl(var(--v2-primary) / 0.1)", mut: "#a1a1aa", onAcc: "#ffffff", glow: 0.08, shade: 0.05 };
}

const line = (p: Pal, w = 2.2) => `stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round"`;
const tick = (x: number, y: number, color: string, w = 2.4) =>
  `<path d="M${x} ${y} l4 4 l7 -8" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const txt = (x: number, y: number, t: string, size: number, weight: number, fill: string, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="DM Sans,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;
/** The one soft indigo glow, under the subject. */
const glow = (p: Pal, cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="24" fill="#6366f1" opacity="${p.glow}"/>`;
const ground = (p: Pal, cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="6" fill="#000" opacity="${p.shade}"/>`;

/** A faceless person in a circle (as the portal's pictures draw one). */
function avatar(x: number, y: number, r: number, p: Pal, skin = "#d9a88a", hair = "#1f2040"): string {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${p.soft}"/><circle cy="${-r * 0.18}" r="${r * 0.38}" fill="${skin}"/><path d="M${-r * 0.65} ${r * 0.72} Q0 ${r * 0.05} ${r * 0.65} ${r * 0.72}" fill="${p.acc}" opacity=".9"/><path d="M${-r * 0.38} ${-r * 0.3} Q${-r * 0.36} ${-r * 0.66} 0 ${-r * 0.66} Q${r * 0.36} ${-r * 0.66} ${r * 0.38} ${-r * 0.3} Q${r * 0.18} ${-r * 0.48} 0 ${-r * 0.48} Q${-r * 0.18} ${-r * 0.48} ${-r * 0.38} ${-r * 0.3}Z" fill="${hair}"/></g>`;
}

/** The customer (ILLUSTRATION_GUIDE.md §5.2): tied-back hair, light jacket, a bag, one hand out for the key. Box 80 x 180. */
function customer(dark: boolean): string {
  const jacket = dark ? "#c7d2fe" : "#e7dccb", top = dark ? "#8b8cf0" : "#5b5bd6", trousers = dark ? "#2e2a8f" : "#3a36a8";
  const skin = "#b77e5f", hair = "#2a1d1a", ink = dark ? "#0b0b1a" : "#1f2040";
  return `<g stroke="${ink}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
   <path d="M29 108 L27 170 L38 170 L40 126 L42 170 L53 170 L51 108 Z" fill="${trousers}"/>
   <path d="M24 172 L38 172 L38 176 L22 176 Z" fill="${ink}"/><path d="M42 172 L56 172 L58 176 L42 176 Z" fill="${ink}"/>
   <path d="M34 42 L46 42 L46 52 L34 52 Z" fill="${skin}"/>
   <path d="M22 58 Q24 48 34 48 L46 48 Q56 48 58 58 L60 112 L20 112 Z" fill="${jacket}"/>
   <path d="M34 48 L40 60 L46 48 Z" fill="${top}"/>
   <path d="M58 58 Q62 84 58 104" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M58 58 Q62 84 58 104" fill="none"/>
   <rect x="54" y="94" width="18" height="22" rx="4" fill="${top}"/><path d="M58 94 Q63 84 68 94" fill="none"/>
   <path d="M22 60 Q10 70 2 70" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M22 60 Q10 70 2 70" fill="none"/>
   <circle cx="0" cy="70" r="3.8" fill="${skin}"/>
   <circle cx="40" cy="30" r="13" fill="${skin}"/>
   <path d="M27 32 Q24 14 40 15 Q56 14 53 32 Q50 20 40 21 Q30 20 27 32 Z" fill="${hair}"/>
   <circle cx="55" cy="22" r="5" fill="${hair}"/>
  </g>`;
}

/* Turo or your own booking site: your own site, at your own address, with your car on it. */
function commission(dark: boolean, id: string): string {
  const p = pal(dark), S = line(p);
  return `${glow(p, 220, 196, 178)}
  <g transform="translate(56 54)">
   <rect width="226" height="138" rx="14" fill="${p.card}" ${S}/>
   <path d="M0 14 Q0 0 14 0 L212 0 Q226 0 226 14 L226 26 L0 26 Z" fill="${p.lite}" opacity=".55"/>
   <path d="M0 26 H226" stroke="${p.ink}" stroke-width="1.6"/>
   <circle cx="16" cy="13" r="3.5" fill="${p.mut}"/><circle cx="28" cy="13" r="3.5" fill="${p.mut}"/><circle cx="40" cy="13" r="3.5" fill="${p.mut}"/>
   <rect x="56" y="6" width="150" height="14" rx="7" fill="${p.card}" stroke="${p.ink}" stroke-width="1.4"/>
   <path d="M66 15.5 v-3 a3 3 0 0 1 6 0 v3" fill="none" stroke="${p.acc}" stroke-width="1.6"/><rect x="64.5" y="14" width="9" height="6.5" rx="1.5" fill="${p.acc}" transform="translate(0 -2)"/>
   <rect x="80" y="10.5" width="62" height="5" rx="2.5" fill="${p.ink}"/>
   <rect x="16" y="42" width="84" height="8" rx="4" fill="${p.ink}"/>
   <rect x="16" y="56" width="64" height="8" rx="4" fill="${p.ink}"/>
   <rect x="16" y="74" width="72" height="5" rx="2.5" fill="${p.lite}"/><rect x="16" y="84" width="56" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="16" y="102" width="46" height="18" rx="9" fill="${p.acc}"/>${txt(39, 114.5, "Book", 9, 700, p.onAcc, "middle")}
  </g>
  <g transform="translate(196 118) scale(.56)">${carSvg(MONO_PAINT, id)}</g>`;
}

/* Signed and checked before pickup: the agreement signed and the licence checked, then the key goes. */
function signed(dark: boolean): string {
  const p = pal(dark), S = line(p);
  return `${glow(p, 214, 198, 168)}
  <g transform="translate(70 50)">
   <rect width="124" height="146" rx="14" fill="${p.card}" ${S}/>
   <rect x="16" y="20" width="62" height="8" rx="4" fill="${p.ink}"/>
   <rect x="16" y="38" width="92" height="5" rx="2.5" fill="${p.lite}"/><rect x="16" y="49" width="84" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="16" y="60" width="90" height="5" rx="2.5" fill="${p.lite}"/><rect x="16" y="71" width="60" height="5" rx="2.5" fill="${p.lite}"/>
   <path d="M20 112 C26 96 32 120 38 104 S48 98 54 110 S66 104 74 106" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
   <path d="M16 122 H108" stroke="${p.ink}" stroke-width="1.6" opacity=".35"/>
   <circle cx="124" cy="0" r="12" fill="${p.acc}"/>${tick(118, 0.5, p.onAcc, 2.4)}
  </g>
  <g transform="translate(176 104) rotate(6)">
   <rect width="96" height="62" rx="9" fill="${p.card}" ${S}/>
   <rect x="9" y="11" width="26" height="34" rx="5" fill="${p.soft}"/>${avatar(22, 26, 10, p).replace(`<circle r="10" fill="${p.soft}"/>`, "")}
   <rect x="43" y="14" width="40" height="6" rx="3" fill="${p.ink}"/><rect x="43" y="27" width="30" height="5" rx="2.5" fill="${p.lite}"/><rect x="43" y="38" width="36" height="5" rx="2.5" fill="${p.lite}"/>
   <circle cx="88" cy="0" r="11" fill="${p.acc}"/>${tick(82.5, 0.5, p.onAcc, 2.2)}
  </g>
  <g transform="translate(296 94) rotate(-24)">
   <rect x="-9" y="-13" width="18" height="26" rx="6" fill="${p.acc}" ${line(p, 1.8)}/><circle cx="0" cy="-4" r="2.6" fill="${p.onAcc}"/><circle cx="0" cy="-18" r="5" fill="none" ${line(p, 1.8)}/>
  </g>
  <g transform="translate(316 70) scale(.68)">${customer(dark)}</g>
  ${ground(p, 214, 196, 150)}`;
}

/* Weekend and holiday pricing: the week on a calendar, the weekend's days priced higher. */
function weekend(dark: boolean): string {
  const p = pal(dark), S = line(p);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const x = (i: number) => 18 + i * 37;
  const tiles = [0, 1]
    .map((r) => days.map((_, i) => `<rect x="${x(i)}" y="${50 + r * 26}" width="26" height="20" rx="6" fill="${i >= 5 ? p.card : p.lite}" ${i >= 5 ? `stroke="${p.acc}" stroke-width="1.6"` : ""}/>`).join(""))
    .join("");
  const bars = days.map((_, i) => (i >= 5 ? `<rect x="${x(i) + 5}" y="${140 - 36}" width="16" height="36" rx="5" fill="${p.acc}"/>` : `<rect x="${x(i) + 5}" y="${140 - 18}" width="16" height="18" rx="5" fill="${p.lite}"/>`)).join("");
  return `${glow(p, 200, 198, 176)}
  <g transform="translate(64 48)">
   <rect width="272" height="152" rx="14" fill="${p.card}" ${S}/>
   <rect x="${x(5) - 7}" y="10" width="80" height="134" rx="10" fill="${p.soft}"/>
   ${days.map((d, i) => txt(x(i) + 13, 33, d, 11, 700, i >= 5 ? p.acc : p.mut, "middle")).join("")}
   ${tiles}
   <path d="M16 106 H256" stroke="${p.lite}" stroke-width="1.5" stroke-dasharray="3 4"/>
   ${bars}
  </g>
  ${ground(p, 200, 202, 140)}`;
}

const ART: Record<string, (dark: boolean, id: string) => string> = {
  "turo-or-your-own-booking-site": commission,
  "signed-and-checked-before-pickup": signed,
  "weekend-and-holiday-pricing": weekend,
};

/** The post's illustration, if it has one: light and dark, the theme shows one. */
export function PostArt({ slug }: { slug: string }) {
  const art = ART[slug];
  if (!art) return null;
  return (
    <>
      {[false, true].map((dark) => (
        <svg
          key={String(dark)}
          className={`pp-art ${dark ? "hidden dark:block" : "dark:hidden"}`}
          viewBox="0 0 400 350"
          fill="none"
          aria-hidden
          focusable="false"
          // Static art from constants only (see the note at the top); nothing user-supplied.
          dangerouslySetInnerHTML={{ __html: art(dark, `pp-${slug}-${dark ? "d" : "l"}`) }}
        />
      ))}
    </>
  );
}

export function hasPostArt(slug: string) {
  return slug in ART;
}
