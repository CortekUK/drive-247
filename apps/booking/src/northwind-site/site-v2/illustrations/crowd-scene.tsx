'use client';

/**
 * Northwind booking site v2 — the /reviews hero's crowd: renters seen from
 * the chest up, shoulder to shoulder along the hero's bottom edge, turned to
 * each other mid-conversation — telling a neighbour "five stars", showing
 * someone a review on their phone, holding a five-star card up to us.
 *
 * Same ink line and flat fills as every other picture on the site
 * (ILLUSTRATION_GUIDE.md), with the operator's colour on the things that
 * matter. Unlike the guide's faceless people these have dot eyes and a
 * smile: the scene is about people looking at and talking to each other,
 * and a gaze needs eyes.
 *
 * Static markup from constants only, both themes drawn (`makeEmptyArt`).
 */

import { makeEmptyArt, pal, type Pal } from '@portal-v2-shared/empty-states/scene-kit';

/** Where the bodies are cut: just below the bottom of the view box, so they run off the hero's edge. */
const BASE = 262;
const STAR = '#fbbf24';

type Hair = 'short' | 'bun' | 'long' | 'cap' | 'curly' | 'bald' | 'bob' | 'ponytail';
type Top = 'tee' | 'shirt' | 'hoodie' | 'jacket' | 'sweater';
type Mouth = 'smile' | 'grin' | 'laugh';
/** What the person is doing with their hands. */
type Hands = 'down' | 'card' | 'phone' | 'wave' | 'chin';
type Person = {
  x: number;
  s: number;
  hair: Hair;
  hairColor: string;
  top: Top;
  coat: [string, string] | 'acc';
  skin: string;
  /** Which way they look: -1 left, 0 at us, 1 right. */
  look: -1 | 0 | 1;
  hands: Hands;
  mouth: Mouth;
  glasses?: boolean;
  earrings?: boolean;
  beard?: boolean;
};

/** Light and dark clothes colours: warm neutrals and soft tints, so the stars and the brand colour are what stands out. */
const SAND: [string, string] = ['#ebe1d2', '#6f675c'];
const BUTTER: [string, string] = ['#fde68a', '#7a6a2c'];
const MINT: [string, string] = ['#c8ecd5', '#3f6a52'];
const PEACH: [string, string] = ['#fed7c3', '#7a5444'];
const MIST: [string, string] = ['#e4e4e7', '#4a4a4f'];
const LILAC: [string, string] = ['#ddd6fe', '#4c4577'];
const SKY: [string, string] = ['#cfe3fb', '#3c5675'];

const NAVY = '#1f2040';
const BROWN = '#5b3420';
const AUBURN = '#9a3f1f';
const BLONDE = '#d9a441';
const GREY = '#a8a29e';
const BLACK = '#17151a';

/** Left to right, in pairs and threes that talk to each other. */
const CROWD: Person[] = [
  { x: 70, s: 0.94, hair: 'short', hairColor: BROWN, top: 'shirt', coat: SAND, skin: '#b77e5f', look: 1, hands: 'chin', mouth: 'smile', glasses: true },
  { x: 186, s: 1.02, hair: 'bun', hairColor: NAVY, top: 'sweater', coat: LILAC, skin: '#f1c9a5', look: -1, hands: 'down', mouth: 'laugh', earrings: true },
  { x: 306, s: 0.97, hair: 'curly', hairColor: BLACK, top: 'hoodie', coat: MINT, skin: '#5e3b26', look: 1, hands: 'phone', mouth: 'smile' },
  { x: 424, s: 1.04, hair: 'long', hairColor: AUBURN, top: 'tee', coat: BUTTER, skin: '#e7b991', look: -1, hands: 'wave', mouth: 'laugh', earrings: true },
  { x: 548, s: 1.06, hair: 'cap', hairColor: NAVY, top: 'tee', coat: 'acc', skin: '#8d5a3b', look: 0, hands: 'card', mouth: 'grin' },
  { x: 672, s: 0.96, hair: 'short', hairColor: BLONDE, top: 'jacket', coat: PEACH, skin: '#f1c9a5', look: 1, hands: 'down', mouth: 'smile' },
  { x: 790, s: 1.0, hair: 'bob', hairColor: BLACK, top: 'sweater', coat: MIST, skin: '#b77e5f', look: -1, hands: 'down', mouth: 'smile', glasses: true },
  { x: 912, s: 1.03, hair: 'bald', hairColor: GREY, top: 'shirt', coat: SAND, skin: '#e7b991', look: 1, hands: 'phone', mouth: 'grin', beard: true },
  { x: 1030, s: 0.95, hair: 'ponytail', hairColor: BROWN, top: 'hoodie', coat: SKY, skin: '#8d5a3b', look: -1, hands: 'wave', mouth: 'laugh', earrings: true },
  { x: 1140, s: 1.0, hair: 'curly', hairColor: NAVY, top: 'jacket', coat: LILAC, skin: '#f1c9a5', look: -1, hands: 'down', mouth: 'smile' },
];

/** A five-point star centred on (cx, cy). */
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${fill}"/>`;
}

const stars = (x: number, y: number, gap: number, r: number, n = 5) =>
  Array.from({ length: n }, (_, i) => star(x + i * gap, y, r, STAR)).join('');

/** A soft light streak across the top of the hair, so it reads as hair and not a hat. */
const shine = (d: string) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>`;

/**
 * Hair for a head of radius 27 centred on (0, 0), drawn with the parting on
 * the right; flipped for a left look. `back` sits behind the head and
 * shoulders (long hair, a ponytail, an afro), `front` over the head.
 */
function hair(kind: Hair, h: string, p: Pal): { back: string; front: string } {
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  switch (kind) {
    case 'bun':
      return {
        back: `<circle cx="-4" cy="-36" r="13" fill="${h}" ${S}/>`,
        front: `<path d="M-28 2 Q-30 -31 0 -31 Q29 -31 28 0 Q20 -16 2 -18 Q-16 -18 -28 2Z" fill="${h}" ${S}/>${shine('M-14 -25 Q-4 -29 6 -27')}`,
      };
    case 'long':
      return {
        back: `<path d="M-32 -4 Q-34 -36 0 -36 Q34 -36 32 -4 L36 58 Q18 64 0 62 Q-18 64 -36 58 Z" fill="${h}" ${S}/>`,
        front: `<path d="M-28 4 Q-28 -31 0 -31 Q28 -31 28 4 Q22 -12 8 -18 Q0 -6 -18 -10 Q-24 -6 -28 4Z" fill="${h}" ${S}/>${shine('M-16 -24 Q-4 -30 10 -26')}`,
      };
    case 'bob':
      return {
        back: '',
        front: `<path d="M-31 16 Q-35 -33 0 -33 Q35 -33 31 16 L22 16 Q24 -6 12 -16 Q-6 -8 -22 -8 L-22 16 Z" fill="${h}" ${S}/>${shine('M-18 -24 Q-4 -30 12 -27')}`,
      };
    case 'ponytail':
      return {
        back: `<path d="M-22 -24 Q-50 -20 -46 14 Q-44 34 -30 40 Q-36 18 -24 -2 Z" fill="${h}" ${S}/>`,
        front: `<path d="M-28 0 Q-30 -31 0 -31 Q29 -31 28 0 Q18 -18 0 -19 Q-16 -18 -28 0Z" fill="${h}" ${S}/><circle cx="-24" cy="-20" r="4" fill="${p.acc}"/>${shine('M-12 -26 Q0 -30 12 -26')}`,
      };
    case 'cap':
      return {
        back: '',
        front: `<path d="M-28 -4 Q-27 -36 0 -36 Q27 -36 28 -4 Z" fill="${p.card}" ${S}/><path d="M0 -36 L0 -6" stroke="${p.ink}" stroke-opacity=".25" stroke-width="1.6"/><path d="M14 -8 L44 -8 Q46 -3 41 -2 L14 -2 Z" fill="${p.card}" ${S}/><circle cx="0" cy="-36" r="3" fill="${p.ink}"/><path d="M-27 -2 Q-27 4 -24 8 L-24 -2Z" fill="${h}"/>`,
      };
    case 'curly': {
      const ring = [[-26, -6], [-24, -22], [-12, -33], [4, -35], [19, -28], [27, -14], [28, 2], [-29, 8]];
      return {
        back: ring.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="13" fill="${h}" ${S}/>`).join(''),
        front: [[-14, -22], [0, -26], [14, -22], [-22, -10], [22, -10]]
          .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="10" fill="${h}"/>`)
          .join(''),
      };
    }
    case 'bald':
      return {
        back: '',
        front: `<path d="M-27 6 Q-29 -6 -23 -12 L-21 8 Z M27 6 Q29 -6 23 -12 L21 8 Z" fill="${h}"/>${shine('M-10 -22 Q-2 -25 6 -23')}`,
      };
    default:
      return {
        back: '',
        front: `<path d="M-28 2 Q-30 -32 2 -32 Q29 -31 28 -2 Q22 -20 8 -16 Q-4 -26 -16 -15 Q-22 -10 -28 2Z" fill="${h}" ${S}/>${shine('M-16 -24 Q-6 -29 6 -28')}`,
      };
  }
}

/** Ears, brows, eyes, nose, cheeks and mouth, all shifted the way the person looks. */
function face(o: Person, p: Pal): string {
  const dx = o.look * 7;
  const brow = (x: number) =>
    `<path d="M${x - 5} -9 Q${x} -13 ${x + 5} -9" fill="none" stroke="${o.hair === 'bald' ? GREY : o.hairColor}" stroke-width="2.6" stroke-linecap="round"/>`;
  const mouth =
    o.mouth === 'laugh'
      ? `<path d="M${dx - 8} 10 Q${dx} 24 ${dx + 8} 10 Z" fill="${p.ink}"/><path d="M${dx - 4} 16 Q${dx} 21 ${dx + 4} 16" fill="#f87171"/>`
      : o.mouth === 'grin'
        ? `<path d="M${dx - 9} 10 Q${dx} 20 ${dx + 9} 10 Z" fill="#fff" stroke="${p.ink}" stroke-width="2" stroke-linejoin="round"/>`
        : `<path d="M${dx - 7} 11 Q${dx} 17 ${dx + 7} 11" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round"/>`;
  const beard = o.beard
    ? `<path d="M-25 2 Q-25 34 0 34 Q25 34 25 2 Q20 10 12 10 Q0 6 -12 10 Q-20 10 -25 2Z" fill="${GREY}" stroke="${p.ink}" stroke-width="2"/>`
    : '';
  const glasses = o.glasses
    ? `<circle cx="${dx - 9}" cy="1" r="7.5" fill="#fff" fill-opacity=".25" stroke="${p.ink}" stroke-width="2"/><circle cx="${dx + 9}" cy="1" r="7.5" fill="#fff" fill-opacity=".25" stroke="${p.ink}" stroke-width="2"/><path d="M${dx - 2} 0 L${dx + 2} 0" stroke="${p.ink}" stroke-width="2"/>`
    : '';
  return `${beard}
    <circle cx="${dx - 14}" cy="10" r="4.5" fill="#f472b6" opacity=".28"/><circle cx="${dx + 14}" cy="10" r="4.5" fill="#f472b6" opacity=".28"/>
    ${brow(dx - 9)}${brow(dx + 9)}
    <circle cx="${dx - 9}" cy="1" r="2.8" fill="${p.ink}"/><circle cx="${dx + 9}" cy="1" r="2.8" fill="${p.ink}"/>
    <path d="M${dx + o.look * 2} 3 Q${dx + o.look * 2 + 3} 7 ${dx + o.look * 2 - 1} 8" fill="none" stroke="${p.ink}" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/>
    ${glasses}${mouth}`;
}

/** The garment's own details over the plain torso: collars, buttons, a hood and strings, lapels, stripes. */
function top(o: Person, coat: string, p: Pal): string {
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  const line = `stroke="${p.ink}" stroke-opacity=".4" stroke-width="1.8" stroke-linecap="round"`;
  switch (o.top) {
    case 'shirt':
      return `<path d="M0 -88 L0 20" ${line}/>${[-64, -40, -16].map((y) => `<circle cx="4" cy="${y}" r="2" fill="${p.ink}" opacity=".5"/>`).join('')}<path d="M-16 -106 L0 -88 L-22 -92 Z M16 -106 L0 -88 L22 -92 Z" fill="${p.card}" ${S}/><path d="M28 -60 h12 v10 h-12 Z" fill="none" ${line}/>`;
    case 'hoodie':
      return `<path d="M-28 -104 Q0 -70 28 -104 Q16 -86 0 -84 Q-16 -86 -28 -104Z" fill="${coat}" ${S}/><path d="M-8 -84 L-10 -58 M8 -84 L10 -58" ${line}/><circle cx="-10" cy="-56" r="2.4" fill="${p.ink}" opacity=".6"/><circle cx="10" cy="-56" r="2.4" fill="${p.ink}" opacity=".6"/><path d="M-26 -22 Q-26 -32 -16 -32 L16 -32 Q26 -32 26 -22 L26 6 L-26 6 Z" fill="none" ${line}/>`;
    case 'jacket':
      return `<path d="M-16 -104 L0 -50 L16 -104 Z" fill="${p.card}" ${S}/><path d="M-16 -104 L-4 -66 L-14 -60 M16 -104 L4 -66 L14 -60" fill="none" ${S}/><path d="M0 -50 L0 20" ${line}/><circle cx="-6" cy="-30" r="2.2" fill="${p.ink}" opacity=".5"/>`;
    case 'sweater':
      return `<path d="M-50 -58 H50 V-50 H-50 Z M-50 -40 H50 V-34 H-50 Z" fill="${p.acc}" opacity=".55"/><path d="M-15 -104 Q0 -92 15 -104" fill="none" ${S}/>`;
    default:
      return `<path d="M-15 -104 Q0 -90 15 -104" fill="none" ${S}/>`;
  }
}

/** A sleeve from (x1, y1) to (x2, y2) with an outlined hand at its end. */
function arm(x1: number, y1: number, x2: number, y2: number, coat: string, skin: string, p: Pal): string {
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${p.ink}" stroke-width="18" stroke-linecap="round"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${coat}" stroke-width="13.6" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="7.5" fill="${skin}" stroke="${p.ink}" stroke-width="2"/>`;
}

/** A phone held up in front, screen turned towards whoever they are looking at, a review on it. */
function phone(look: number, p: Pal): string {
  const tilt = look * -14;
  return `<g transform="translate(${look * 14} -78) rotate(${tilt})"><rect x="-18" y="-30" width="36" height="58" rx="7" fill="${p.ink}"/><rect x="-14" y="-25" width="28" height="44" rx="3" fill="${p.card}"/>${stars(-10, -14, 5, 2.6)}<rect x="-10" y="-4" width="20" height="3" rx="1.5" fill="${p.lite}"/><rect x="-10" y="3" width="14" height="3" rx="1.5" fill="${p.lite}"/></g>`;
}

function person(o: Person, p: Pal, dark: boolean): string {
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  const coat = o.coat === 'acc' ? p.acc : dark ? o.coat[1] : o.coat[0];
  const flip = o.look < 0 ? -1 : 1;
  const tilt = o.look * 5;
  const h = hair(o.hair, o.hairColor, p);
  let hands = '';
  switch (o.hands) {
    case 'card':
      hands =
        arm(-38, -92, -52, -190, coat, o.skin, p) +
        arm(38, -92, 52, -190, coat, o.skin, p) +
        `<rect x="-66" y="-240" width="132" height="54" rx="9" fill="${p.card}" ${S}/>${stars(-46, -213, 23, 9)}`;
      break;
    case 'phone':
      hands = phone(o.look, p) + arm(-36, -88, o.look * 14 - 18, -54, coat, o.skin, p) + arm(36, -88, o.look * 14 + 18, -54, coat, o.skin, p);
      break;
    case 'wave':
      hands = arm(-o.look * 38, -90, -o.look * 62, -170, coat, o.skin, p);
      break;
    case 'chin':
      hands = arm(o.look * 34, -88, o.look * 10, -110, coat, o.skin, p);
      break;
    default:
      hands = '';
  }
  const earring = (x: number) => `<circle cx="${x}" cy="10" r="3" fill="${p.acc}"/>`;
  return `<g transform="translate(${o.x} ${BASE}) scale(${o.s})">
    <g transform="translate(0 -146) rotate(${tilt}) scale(${flip} 1)">${h.back}</g>
    <path d="M-50 20 L-50 -66 Q-50 -100 -18 -104 L18 -104 Q50 -100 50 -66 L50 20 Z" fill="${coat}" ${S}/>
    <rect x="-9" y="-122" width="18" height="22" fill="${o.skin}" ${S}/>
    ${top(o, coat, p)}
    <g transform="translate(0 -146) rotate(${tilt})">
      <circle cx="-27" cy="3" r="6" fill="${o.skin}" ${S}/><circle cx="27" cy="3" r="6" fill="${o.skin}" ${S}/>
      ${o.earrings ? earring(-27) + earring(27) : ''}
      <circle r="27" fill="${o.skin}" ${S}/>
      ${face(o, p)}
      <g transform="scale(${flip} 1)">${h.front}</g>
    </g>
    ${hands}
  </g>`;
}

/** A speech bubble with its tail pointing down-left (-1) or down-right (1) at the speaker. */
function bubble(x: number, y: number, w: number, tail: -1 | 1, inner: string, p: Pal): string {
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  const tx = tail < 0 ? x + 18 : x + w - 18;
  return `<path d="M${x + 10} ${y} h${w - 20} a10 10 0 0 1 10 10 v24 a10 10 0 0 1 -10 10 H${tx + 8 * -tail} l${-tail * 12} 14 l${tail * 2} -14 H${x + 10} a10 10 0 0 1 -10 -10 v-24 a10 10 0 0 1 10 -10 z" fill="${p.card}" ${S}/>${inner}`;
}

const heart = (cx: number, cy: number, fill: string) =>
  `<path d="M${cx} ${cy + 9} C${cx - 14} ${cy - 1} ${cx - 10} ${cy - 13} ${cx - 3} ${cy - 11} C${cx - 1} ${cy - 10} ${cx} ${cy - 8} ${cx} ${cy - 7} C${cx} ${cy - 8} ${cx + 1} ${cy - 10} ${cx + 3} ${cy - 11} C${cx + 10} ${cy - 13} ${cx + 14} ${cy - 1} ${cx} ${cy + 9} Z" fill="${fill}"/>`;

/** The whole row: ten people, three of them talking. */
function crowdArt(dark: boolean): string {
  const p = pal(dark);
  // Who is saying what: the second person tells the first "five stars", the
  // fourth answers the phone she was shown with a heart, the ninth replies to
  // the eighth's phone with four stars.
  const talk = [
    bubble(150, 6, 118, -1, stars(170, 28, 19.5, 7.5), p),
    bubble(398, 10, 64, -1, heart(430, 30, p.acc), p),
    bubble(1000, 18, 96, -1, stars(1018, 40, 15, 6, 4), p),
  ];
  return [...CROWD.map((o) => person(o, p, dark)), ...talk].join('');
}

/**
 * The phone version: five of the same people, close enough to fit a narrow
 * screen whole instead of being cut off at both edges — the five-star
 * speaker, the heart, the card held up in the middle, a listener, and the
 * four-star reply.
 */
const SMALL: Person[] = [
  { ...CROWD[1], x: 74, look: 1 },
  { ...CROWD[3], x: 192 },
  { ...CROWD[4], x: 314 },
  { ...CROWD[5], x: 436, look: -1 },
  { ...CROWD[8], x: 552 },
];

function crowdArtSmall(dark: boolean): string {
  const p = pal(dark);
  const talk = [
    bubble(14, 6, 118, 1, stars(34, 28, 19.5, 7.5), p),
    bubble(150, 12, 64, 1, heart(182, 32, p.acc), p),
    bubble(470, 20, 96, -1, stars(488, 42, 15, 6, 4), p),
  ];
  return [...SMALL.map((o) => person(o, p, dark)), ...talk].join('');
}

export const ReviewsCrowdArt = makeEmptyArt(crowdArt, '0 0 1200 260');
export const ReviewsCrowdArtSmall = makeEmptyArt(crowdArtSmall, '0 0 630 260');
