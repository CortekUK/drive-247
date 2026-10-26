'use client';

/**
 * Northwind booking site v2 — the other pages' pictures, drawn with the home
 * page's parts (`home-scenes.tsx`: the grid floor, the car, the person with
 * the keys, the ink-outlined cards) so the whole site reads as one set.
 * Each shows the one thing its page is for:
 *
 *   About       our place: the office, a car out front, someone with the keys
 *   Reviews     a renter's review, five stars, from a real rental
 *   Promotions  a car's price, marked down, and the offer's tag
 *   Contact     a chat with us on your phone, an email, where we are
 *   Fleet rates a calendar: one day, a week, a month
 *   404         the car, and a signpost with a question mark
 *
 * Same rules as home-scenes.tsx: static markup from constants only, both
 * themes drawn (`makeEmptyArt`), the accent is the operator's own colour.
 */

import { carSvg, MONO_PAINT } from '@portal-v2-shared/empty-states/car-art';
import { avatar, ground, makeEmptyArt, pal, txt, type Pal } from '@portal-v2-shared/empty-states/scene-kit';

import { accDash, badgeTick, inkStroke, keeper, stage, type Canvas } from './home-scenes';

/* ──────────────────────────────── about ───────────────────────────────── */

const ABOUT: Canvas = { w: 580, h: 360, horizon: 206, colStep: 58 };

/** The office: a sign with the logo and the name, a striped awning, the window, the door. */
function office(p: Pal): string {
  const S = inkStroke(p);
  const stripes = Array.from({ length: 8 }, (_, i) => {
    const x = 40 + i * 32;
    const fill = i % 2 === 0 ? p.acc : p.card;
    return `<rect x="${x}" y="72" width="32" height="22" fill="${fill}"/>` +
      `<path d="M${x} 94 a16 16 0 0 0 32 0 Z" fill="${fill}" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }).join('');
  return `
  <rect x="22" y="240" width="300" height="12" rx="6" fill="${p.lite}"/>
  <rect x="96" y="28" width="148" height="30" rx="10" fill="${p.card}" ${S}/>
  <circle cx="116" cy="43" r="8" fill="${p.acc}"/>
  <rect x="132" y="39" width="92" height="8" rx="4" fill="${p.ink}"/>
  <path d="M120 58 V72 M220 58 V72" stroke="${p.ink}" stroke-width="2.2"/>
  <rect x="40" y="72" width="256" height="170" fill="${p.card}" ${S}/>
  ${stripes}
  <rect x="40" y="72" width="256" height="22" fill="none" ${S}/>
  <rect x="60" y="124" width="132" height="86" rx="8" fill="${p.soft}" ${S}/>
  <path d="M126 124 V210" stroke="${p.ink}" stroke-width="2.2"/>
  <rect x="72" y="136" width="40" height="14" rx="7" fill="${p.acc}"/>
  <rect x="214" y="122" width="62" height="120" rx="6" fill="${p.lite}" ${S}/>
  <circle cx="228" cy="184" r="3.5" fill="${p.ink}"/>`;
}

function aboutArt(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwAboutD' : 'nwAboutL';
  return `${stage(ABOUT, p, id, dark, { cx: 330, cy: 330, rx: 230, ry: 30 })}
  ${office(p)}
  <ellipse cx="340" cy="338" rx="150" ry="9" fill="#000" opacity="${dark ? 0.35 : 0.07}"/>
  <g transform="translate(186 216) scale(0.92)">${carSvg(MONO_PAINT, `${id}car`)}</g>
  <g transform="translate(522 92) scale(0.95)">${keeper(0, 0, p, dark)}</g>`;
}

export const AboutArt = makeEmptyArt(aboutArt, '14 14 566 340');

/* ─────────────────────────────── reviews ──────────────────────────────── */

/** A five-point star around (cx, cy). */
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${fill}" stroke-linejoin="round"/>`;
}

function reviewsArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const stars = Array.from({ length: 5 }, (_, i) => star(26 + i * 24, 70, 9, p.acc)).join('');
  return `
  ${ground(190, 214, 130, dark)}
  <g transform="translate(150 22) rotate(6)" opacity=".9">
    <rect width="176" height="122" rx="16" fill="${p.card}" ${S}/>
    <rect x="18" y="20" width="70" height="7" rx="3.5" fill="${p.lite}"/>
    <rect x="18" y="38" width="120" height="6" rx="3" fill="${p.lite}"/>
  </g>
  <g transform="translate(56 58) rotate(-4)">
    <rect width="214" height="142" rx="16" fill="${p.card}" ${S}/>
    ${avatar(32, 32, 17, p)}
    <rect x="58" y="22" width="76" height="8" rx="4" fill="${p.ink}"/>
    <rect x="58" y="37" width="48" height="6" rx="3" fill="${p.lite}"/>
    ${stars}
    <rect x="16" y="94" width="178" height="6" rx="3" fill="${p.lite}"/>
    <rect x="16" y="108" width="160" height="6" rx="3" fill="${p.lite}"/>
    <rect x="16" y="122" width="104" height="6" rx="3" fill="${p.lite}"/>
    ${badgeTick(214, 0, p, 0.6)}
  </g>
  <g class="nw-bob"><g transform="translate(274 120)">
    <path d="M14 0 H62 Q76 0 76 14 V36 Q76 50 62 50 H28 L14 62 L16 50 Q0 50 0 36 V14 Q0 0 14 0 Z" fill="${p.acc}"/>
    ${txt(38, 42, '“', 44, 800, p.onAcc, 'middle')}
  </g></g>`;
}

export const ReviewsArt = makeEmptyArt(reviewsArt, '30 6 340 220');

/* ────────────────────────────── promotions ────────────────────────────── */

function promoArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const id = dark ? 'nwPromoD' : 'nwPromoL';
  return `
  ${ground(180, 206, 124, dark)}
  <g transform="translate(58 24)">
    <rect width="184" height="170" rx="16" fill="${p.card}" ${S}/>
    <rect x="12" y="12" width="160" height="76" rx="10" fill="${p.soft}"/>
    <g transform="translate(22 22) scale(0.42)">${carSvg(MONO_PAINT, `${id}car`)}</g>
    <rect x="14" y="102" width="86" height="8" rx="4" fill="${p.ink}"/>
    <rect x="14" y="118" width="54" height="6" rx="3" fill="${p.lite}"/>
    ${txt(16, 154, '$55', 15, 700, p.mut)}
    <path d="M13 149 H50" stroke="${p.mut}" stroke-width="2" stroke-linecap="round"/>
    <g class="nw-pop" style="--d:.5s"><rect x="62" y="136" width="58" height="26" rx="13" fill="${p.acc}"/>
    ${txt(91, 153.5, '$45', 13, 800, p.onAcc, 'middle')}</g>
  </g>
  ${accDash('M246 140 C258 132 264 124 268 116', p)}
  <g class="nw-bob"><g transform="translate(262 34) rotate(14)">
    <path d="M18 0 H74 Q84 0 84 10 V66 Q84 76 74 76 H18 L0 38 Z" fill="${p.acc}" ${S}/>
    <circle cx="20" cy="38" r="5.5" fill="${p.card}" stroke="${p.ink}" stroke-width="2"/>
    ${txt(54, 50, '%', 30, 800, p.onAcc, 'middle')}
  </g></g>`;
}

export const PromoArt = makeEmptyArt(promoArt, '34 4 336 216');

/* ─────────────────────────────── contact ──────────────────────────────── */

function contactArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  return `
  ${ground(180, 214, 130, dark)}
  <g transform="translate(64 10)">
    <rect width="130" height="196" rx="22" fill="${p.card}" ${S}/>
    <rect x="48" y="10" width="34" height="6" rx="3" fill="${p.lite}"/>
    ${avatar(28, 40, 12, p)}
    <rect x="46" y="36" width="50" height="7" rx="3.5" fill="${p.ink}"/>
    <path d="M12 60 H118" stroke="${p.lite}" stroke-width="1.4"/>
    <rect x="12" y="72" width="78" height="28" rx="12" fill="${p.lite}"/>
    <rect x="40" y="110" width="78" height="28" rx="12" fill="${p.acc}"/>
    <rect x="52" y="121" width="40" height="6" rx="3" fill="${p.onAcc}" opacity=".9"/>
    <rect x="12" y="148" width="62" height="28" rx="12" fill="${p.lite}"/>
    <circle class="nw-dot" cx="28" cy="162" r="3.5" fill="${p.mut}"/>
    <circle class="nw-dot" style="--d:.2s" cx="42" cy="162" r="3.5" fill="${p.mut}"/>
    <circle class="nw-dot" style="--d:.4s" cx="56" cy="162" r="3.5" fill="${p.mut}"/>
  </g>
  <g transform="translate(222 40)">
    <rect width="104" height="68" rx="12" fill="${p.card}" ${S}/>
    <path d="M8 12 L52 42 L96 12" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${badgeTick(104, 0, p, 0.6)}
  </g>
  <g transform="translate(272 150)">
    <ellipse cx="0" cy="54" rx="16" ry="5" fill="${p.soft}"/>
    <g class="nw-bob"><path d="M0 52 C-5 40 -22 30 -22 14 A22 22 0 0 1 22 14 C22 30 5 40 0 52 Z" fill="${p.acc}" ${S}/>
    <circle cx="0" cy="13" r="8" fill="${p.card}"/></g>
  </g>
  ${accDash('M198 120 C214 128 236 136 248 150', p)}`;
}

export const ContactArt = makeEmptyArt(contactArt, '40 0 320 224');

/* ──────────────────────────────── 404 ─────────────────────────────────── */

const LOST: Canvas = { w: 440, h: 250, horizon: 100, colStep: 50 };

function notFoundArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const id = dark ? 'nwLostD' : 'nwLostL';
  return `${stage(LOST, p, id, dark, { cx: 200, cy: 226, rx: 170, ry: 22 })}
  <ellipse cx="176" cy="232" rx="118" ry="8" fill="#000" opacity="${dark ? 0.35 : 0.07}"/>
  <g transform="translate(40 116) scale(0.8)">${carSvg(MONO_PAINT, `${id}car`)}</g>
  <rect x="356" y="76" width="8" height="160" rx="3" fill="${p.ink}"/>
  <ellipse cx="360" cy="236" rx="22" ry="5" fill="#000" opacity="${dark ? 0.35 : 0.07}"/>
  <g class="nw-bob"><g transform="translate(316 30)">
    <path d="M0 0 H72 L88 22 L72 44 H0 Z" fill="${p.card}" ${S}/>
    ${txt(38, 34, '?', 30, 800, p.acc, 'middle')}
  </g></g>`;
}

export const NotFoundArt = makeEmptyArt(notFoundArt, '20 20 410 230');

/* ─────────────────────────────── fleet rates ──────────────────────────── */

export type RatePeriod = 'daily' | 'weekly' | 'monthly';

/**
 * The rental period on a calendar: one day picked, a whole week, or the whole
 * month — what "daily", "weekly" and "monthly" mean, before any words.
 */
function rateArt(period: RatePeriod) {
  return (dark: boolean): string => {
    const p = pal(dark);
    const S = inkStroke(p);
    const cols = [0, 1, 2, 3, 4, 5, 6].map((c) => 58 + c * 22);
    const rows = [84, 104, 124];
    const on = (c: number, r: number) =>
      period === 'monthly' || (period === 'weekly' && r === 1) || (period === 'daily' && r === 1 && c === 3);
    const cells = rows
      .map((y, r) =>
        cols
          .map((x, c) =>
            on(c, r)
              ? `<circle cx="${x}" cy="${y}" r="7.5" fill="${p.acc}"/>`
              : `<rect x="${x - 5}" y="${y - 2.5}" width="10" height="5" rx="2.5" fill="${p.lite}"/>`,
          )
          .join(''),
      )
      .join('');
    const band =
      period === 'weekly'
        ? `<rect x="${cols[0] - 11}" y="${rows[1] - 11}" width="${cols[6] - cols[0] + 22}" height="22" rx="11" fill="${p.soft}"/>`
        : period === 'monthly'
          ? `<rect x="${cols[0] - 12}" y="${rows[0] - 12}" width="${cols[6] - cols[0] + 24}" height="${rows[2] - rows[0] + 24}" rx="12" fill="${p.soft}"/>`
          : '';
    const label = { daily: '1 day', weekly: '7 days', monthly: '30 days' }[period];
    const w = { daily: 54, weekly: 62, monthly: 70 }[period];
    return `
    ${ground(150, 152, 98, dark)}
    <rect x="40" y="38" width="190" height="106" rx="16" fill="${p.card}" ${S}/>
    <path d="M84 30 V46 M186 30 V46" stroke="${p.ink}" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="56" y="56" width="58" height="7" rx="3.5" fill="${p.ink}"/>
    ${band}${cells}
    <g class="nw-pop" style="--d:.4s"><rect x="${232 - w / 2}" y="22" width="${w}" height="26" rx="13" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
    ${txt(232, 39.5, label, 12, 800, p.onAcc, 'middle')}</g>`;
  };
}

const RATE_VIEW = '24 12 250 148';
// Three components, not a map of them: a server page can only take
// components from this client file, never a plain object.
export const DailyRateArt = makeEmptyArt(rateArt('daily'), RATE_VIEW);
export const WeeklyRateArt = makeEmptyArt(rateArt('weekly'), RATE_VIEW);
export const MonthlyRateArt = makeEmptyArt(rateArt('monthly'), RATE_VIEW);
