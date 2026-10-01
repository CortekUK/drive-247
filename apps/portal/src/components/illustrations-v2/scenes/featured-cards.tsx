'use client';

/**
 * The featured cards' pictures (Rentals, Vehicles, Customers, Finances hero
 * row), one per `FeaturedArtKey` (lib/featured-cards.ts). Same language as
 * the Agreements "Template Studio" card (./agreement-templates.tsx) and the
 * empty states: docs/brand/illustration-guide.md §4d — one idea, one or two
 * props, ink lines on white cards, the accent only where it means something,
 * a soft ground shadow, both themes. No car: these are about the paperwork
 * and the tools, not the fleet.
 *
 * Every picture is drawn in the same 220 × 176 frame, centred, so they sit
 * identically in the card. The card places them absolutely in the room it
 * already has (featured-deck-view-v2.tsx), so a picture never adds height.
 */
import type { FeaturedArtKey } from '@/lib/featured-cards';
import { cn } from '@/lib/utils';
import { avatar, ground, pal, stroke, tick, type Pal } from '../scene-kit';

const VIEWBOX = '40 0 220 176';

/** The four-point spark that stands for Trax, in an accent disc. */
const spark = (x: number, y: number, p: Pal, r = 15) =>
  `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${p.acc}"/><path d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="${p.onAcc}"/></g>`;

const bar = (x: number, y: number, w: number, fill: string, h = 5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;

/* ── Rentals: Calendar View — the fleet on a timeline ─────────────────── */
function calendarArt(dark: boolean) {
  const p = pal(dark);
  const days = [0, 1, 2, 3, 4, 5].map((i) => bar(62 + i * 16, 34, 8, p.lite, 4)).join('');
  const lanes = [0, 1, 2, 3].map((r) => bar(14, 53 + r * 18, 28, p.lite, 6)).join('');
  const y = (r: number) => 50 + r * 18;
  return `
 <g transform="translate(66 22)">
  <rect width="168" height="130" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${bar(14, 14, 50, p.ink, 8)}
  ${days}
  ${lanes}
  <rect x="58" y="${y(0)}" width="46" height="12" rx="6" fill="${p.lite}"/>
  <rect x="88" y="${y(1)}" width="62" height="12" rx="6" fill="${p.acc}"/>
  <circle cx="95" cy="${y(1) + 6}" r="3.5" fill="${p.onAcc}"/>
  <rect x="66" y="${y(2)}" width="30" height="12" rx="6" fill="${p.lite}"/>
  <rect x="112" y="${y(2)}" width="40" height="12" rx="6" fill="${p.lite}"/>
  <rect x="74" y="${y(3)}" width="58" height="12" rx="6" fill="${p.lite}"/>
  <path d="M112 42 V120" stroke="${p.acc}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 4"/>
  <circle cx="112" cy="42" r="3" fill="${p.acc}"/>
 </g>
 ${ground(150, 164, 100, dark)}`;
}

/* ── Vehicles: Availability — your hours and blocked dates ────────────── */
function availabilityArt(dark: boolean) {
  const p = pal(dark);
  const blocked = new Set(['0-5', '0-6', '1-5', '1-6', '2-2', '2-3', '3-5', '3-6']);
  let cells = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) {
      const x = 14 + c * 18;
      const y = 36 + r * 18;
      cells += blocked.has(`${r}-${c}`)
        ? `<rect x="${x}" y="${y}" width="14" height="14" rx="4" fill="${p.card}" stroke="${p.mut}" stroke-width="1.4"/><path d="M${x + 3} ${y + 11} L${x + 11} ${y + 3}" stroke="${p.mut}" stroke-width="1.4" stroke-linecap="round"/>`
        : `<rect x="${x}" y="${y}" width="14" height="14" rx="4" fill="${p.lite}"/>`;
    }
  }
  return `
 <g transform="translate(78 30)">
  <rect width="154" height="118" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${bar(14, 14, 44, p.ink, 8)}
  ${cells}
 </g>
 <!-- the hours -->
 <g transform="translate(230 32)">
  <circle r="17" fill="${p.acc}"/>
  <path d="M0 -8 V0 L6 4" fill="none" stroke="${p.onAcc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 ${ground(155, 160, 92, dark)}`;
}

/* ── Customers: Invite link — customers sign themselves up ────────────── */
function inviteArt(dark: boolean) {
  const p = pal(dark);
  return `
 <g transform="translate(78 18)">
  <rect width="74" height="136" rx="14" fill="${p.card}" ${stroke(p)}/>
  <rect x="28" y="8" width="18" height="4" rx="2" fill="${p.lite}"/>
  ${bar(12, 24, 34, p.ink, 7)}
  <rect x="12" y="40" width="50" height="16" rx="8" fill="${p.soft}"/>
  <g fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round">
   <rect x="20" y="45" width="11" height="6" rx="3"/><rect x="27" y="45" width="11" height="6" rx="3"/>
  </g>
  ${bar(43, 46, 13, p.acc, 4)}
  ${bar(12, 66, 50, p.lite)}
  ${bar(12, 78, 50, p.lite)}
  ${bar(12, 90, 36, p.lite)}
  <rect x="12" y="108" width="50" height="14" rx="7" fill="${p.acc}"/>
 </g>
 <path d="M160 88 H182" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M177 82 L184 88 L177 94" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 ${avatar(212, 88, 24, p)}
 <circle cx="230" cy="68" r="10" fill="${p.acc}"/>${tick(225.5, 68.5, p.onAcc, 2.2)}
 ${ground(158, 162, 96, dark)}`;
}

/* ── Customers: Import CSV — bring your list across ───────────────────── */
function importArt(dark: boolean) {
  const p = pal(dark);
  let grid = '';
  for (let r = 0; r < 5; r++) grid += [0, 1, 2].map((c) => bar(12 + c * 20, 30 + r * 14, 16, p.lite, 6)).join('');
  const rows = [0, 1, 2, 3]
    .map((r) => `<circle cx="18" cy="${34 + r * 22}" r="6" fill="${p.soft}"/>${bar(30, 31 + r * 22, r === 3 ? 26 : 38, p.lite, 6)}`)
    .join('');
  return `
 <g transform="translate(62 30)">
  <rect width="76" height="110" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${bar(12, 14, 30, p.ink, 7)}
  ${grid}
 </g>
 <path d="M144 85 H164" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M159 79 L166 85 L159 91" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(172 24)">
  <rect width="80" height="118" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${rows}
  <circle cx="64" cy="100" r="8" fill="${p.acc}"/>${tick(60, 100.5, p.onAcc, 2)}
 </g>
 ${ground(156, 160, 100, dark)}`;
}

/* ── Customers: Blocklist — customers you won't rent to ───────────────── */
function blockedArt(dark: boolean) {
  const p = pal(dark);
  return `
 <g transform="translate(76 32)">
  <rect width="142" height="112" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${avatar(40, 48, 24, p, '#b77e5f')}
  ${bar(74, 34, 48, p.ink, 8)}
  ${bar(74, 50, 38, p.lite)}
  ${bar(74, 62, 50, p.lite)}
  ${bar(16, 88, 110, p.lite)}
 </g>
 <g transform="translate(214 40)">
  <circle r="17" fill="${p.card}" ${stroke(p)}/>
  <circle r="9" fill="none" stroke="${p.ink}" stroke-width="2.4"/>
  <path d="M-6.4 6.4 L6.4 -6.4" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
 </g>
 ${ground(150, 158, 90, dark)}`;
}

/* ── Finances: Auto-charge — bill saved cards automatically ───────────── */
function autochargeArt(dark: boolean) {
  const p = pal(dark);
  return `
 <g transform="translate(70 44)">
  <rect width="146" height="92" rx="12" fill="${p.card}" ${stroke(p)}/>
  <rect x="16" y="20" width="26" height="20" rx="5" fill="${p.lite}"/>
  <path d="M16 30 H42 M29 20 V40" stroke="${p.card}" stroke-width="1.6"/>
  ${[0, 1, 2, 3].map((i) => bar(16 + i * 30, 56, 22, p.lite, 6)).join('')}
  ${bar(16, 72, 50, p.ink, 6)}
 </g>
 <!-- it charges on its own: one clean repeat arc -->
 <g transform="translate(214 46)">
  <circle r="18" fill="${p.acc}"/>
  <path d="M-8 3 A8.5 8.5 0 1 0 -5.5 -6.5" fill="none" stroke="${p.onAcc}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M-9.5 -11 L-5.5 -6.5 L-11 -4" fill="none" stroke="${p.onAcc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 ${ground(148, 150, 90, dark)}`;
}

/* ── Ask Trax — your AI assistant, one question away ──────────────────── */
function traxArt(dark: boolean) {
  const p = pal(dark);
  return `
 <!-- the question -->
 <rect x="138" y="28" width="96" height="28" rx="14" fill="${p.lite}"/>
 ${bar(152, 39.5, 60, p.mut, 5)}
 <!-- Trax's answer -->
 <g transform="translate(88 70)">
  <rect width="146" height="62" rx="16" fill="${p.card}" ${stroke(p)}/>
  ${bar(16, 16, 102, p.lite)}
  ${bar(16, 29, 88, p.lite)}
  ${bar(16, 42, 56, p.acc)}
 </g>
 ${spark(68, 116, p)}
 ${ground(154, 150, 94, dark)}`;
}

/* ── Turo Sync — bring your Turo trips into Drive247 ──────────────────── */
function turoArt(dark: boolean) {
  const p = pal(dark);
  const trip = (x: number, head: string) => `
 <g transform="translate(${x} 36)">
  <rect width="74" height="98" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${bar(12, 14, 36, head, 7)}
  ${[0, 1, 2].map((c) => `<rect x="${12 + c * 18}" y="32" width="14" height="14" rx="4" fill="${p.lite}"/>`).join('')}
  <rect x="30" y="32" width="14" height="14" rx="4" fill="${head === p.acc ? p.acc : p.lite}"/>
  ${bar(12, 58, 50, p.lite)}
  ${bar(12, 70, 38, p.lite)}
 </g>`;
  return `
 ${trip(60, p.ink)}
 ${trip(166, p.acc)}
 <path d="M140 66 Q150 54 160 66" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round"/>
 <path d="M154 64 L160 66 L161 60" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M160 104 Q150 116 140 104" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round"/>
 <path d="M146 106 L140 104 L139 110" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 ${ground(150, 150, 100, dark)}`;
}

/* ── Something new ────────────────────────────────────────────────────── */
function announcementArt(dark: boolean) {
  const p = pal(dark);
  return `
 <g transform="translate(78 34)">
  <rect width="136" height="108" rx="12" fill="${p.card}" ${stroke(p)}/>
  <rect x="14" y="14" width="108" height="40" rx="8" fill="${p.soft}"/>
  ${bar(14, 66, 60, p.ink, 8)}
  ${bar(14, 82, 100, p.lite)}
  ${bar(14, 94, 72, p.lite)}
 </g>
 ${spark(214, 36, p)}
 ${ground(146, 154, 88, dark)}`;
}

/* ── A suggestion from your own data ──────────────────────────────────── */
function suggestionArt(dark: boolean) {
  const p = pal(dark);
  const row = (i: number, done: boolean) => {
    const y = 20 + i * 24;
    return `<rect x="14" y="${y}" width="14" height="14" rx="4" fill="${p.card}" stroke="${p.ink}" stroke-width="1.8"/>${done ? tick(17, y + 7.5, p.ink, 2) : ''}${bar(36, y + 4.5, 70, p.lite)}`;
  };
  return `
 <g transform="translate(84 24)">
  <rect width="132" height="124" rx="12" fill="${p.card}" ${stroke(p)}/>
  ${row(0, true)}
  ${row(1, true)}
  <rect x="8" y="64" width="116" height="26" rx="8" fill="${p.soft}"/>
  <rect x="14" y="70" width="14" height="14" rx="4" fill="${p.card}" stroke="${p.acc}" stroke-width="1.8"/>
  ${bar(36, 74.5, 60, p.acc)}
  ${row(3, false)}
 </g>
 ${ground(150, 156, 86, dark)}`;
}

const ART: Record<FeaturedArtKey, (dark: boolean) => string> = {
  calendar: calendarArt,
  availability: availabilityArt,
  invite: inviteArt,
  import: importArt,
  blocked: blockedArt,
  autocharge: autochargeArt,
  trax: traxArt,
  turo: turoArt,
  announcement: announcementArt,
  suggestion: suggestionArt,
};

/** Both themes drawn; the `dark:` class picks one, so there is no flash. Fills its box, keeping its shape. */
export function FeaturedCardArt({ art, className }: { art: FeaturedArtKey; className?: string }) {
  const draw = ART[art];
  if (!draw) return null;
  const scene = (dark: boolean) => (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn('h-full w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      dangerouslySetInnerHTML={{ __html: draw(dark) }}
    />
  );
  return (
    <div className={cn('pointer-events-none', className)}>
      {scene(false)}
      {scene(true)}
    </div>
  );
}

/** For the preview harness: the raw markup of one picture. */
export const featuredArtMarkup = (art: FeaturedArtKey, dark: boolean) => ART[art](dark);
export const FEATURED_ART_KEYS = Object.keys(ART) as FeaturedArtKey[];
export const FEATURED_ART_VIEWBOX = VIEWBOX;
