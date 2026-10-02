'use client';

/**
 * Bonzah integration pictures (docs/brand/illustration-guide.md §4a).
 *
 * One picture per screen of the Bonzah panel on the Integrations board, each
 * telling one step of the story: apply → Bonzah reviews → (sent back) → the
 * login arrives → policies are paid from the balance. The "cover at checkout"
 * picture is the Insurances empty state, reused as-is.
 *
 * Same rules as every other scene: ink lines, white cards, the tenant's accent
 * only where it matters, no car (this is about cover, not cars).
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt, type Pal } from '../scene-kit';

const SHIELD = 'M0 -38 L30 -27 V0 Q30 26 0 40 Q-30 26 -30 0 V-27 Z';

/** The application form — a card with a title, three fields and a pill. */
function formCard(p: Pal, x: number, y: number, opts: { flagged?: number[]; pill?: string } = {}): string {
  const S = stroke(p);
  const fields = [50, 74, 98]
    .map((fy, i) =>
      opts.flagged?.includes(i)
        ? `<rect x="14" y="${fy}" width="92" height="16" rx="5" fill="${p.soft}" stroke="${p.acc}" stroke-width="1.6"/><rect x="22" y="${fy + 6}" width="${[44, 52, 38][i]}" height="4" rx="2" fill="${p.acc}" opacity=".7"/>`
        : `<rect x="14" y="${fy}" width="92" height="16" rx="5" fill="${p.bg}" stroke="${p.lite}" stroke-width="1.5"/><rect x="22" y="${fy + 6}" width="${[44, 52, 38][i]}" height="4" rx="2" fill="${p.lite}"/>`,
    )
    .join('');
  return `
 <g transform="translate(${x} ${y})">
  <rect width="120" height="150" rx="14" fill="${p.card}" ${S}/>
  <rect x="14" y="18" width="60" height="7" rx="3.5" fill="${p.ink}"/>
  <rect x="14" y="31" width="40" height="5" rx="2.5" fill="${p.lite}"/>
  ${fields}
  ${opts.pill ? `<rect x="14" y="124" width="92" height="16" rx="8" fill="${p.acc}"/>${txt(60, 135, opts.pill, 9, 700, p.onAcc, 'middle')}` : ''}
 </g>`;
}

/** Apply once: the form goes over to Bonzah's reviewer. */
function applyArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 ${formCard(p, 46, 26, { pill: 'Apply' })}
 <path d="M172 104 C 196 104, 200 96, 222 96" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M216 90 L223 96 L216 102" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(270 100)">
  <path d="${SHIELD}" fill="${p.card}" ${S}/>
  <path d="${SHIELD}" transform="scale(.7)" fill="${p.soft}"/>
  <path d="M-11 1 L-3 9 L12 -8" fill="none" stroke="${p.acc}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 ${avatar(312, 54, 20, p)}
 ${ground(186, 182, 150, dark)}`;
}

/** In review: the application, with a clock on it. */
function reviewArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 ${formCard(p, 124, 26, { pill: 'Sent' })}
 <g transform="translate(250 64)">
  <circle r="28" fill="${p.card}" ${S}/>
  <circle r="20" fill="${p.soft}"/>
  <path d="M0 -12 V0 L9 6" fill="none" stroke="${p.acc}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 ${ground(184, 182, 120, dark)}`;
}

/** Sent back: two fields flagged, and a pencil to fix them. */
function returnedArt(dark: boolean): string {
  const p = pal(dark);
  return `
 ${formCard(p, 124, 26, { flagged: [0, 2], pill: 'Resubmit' })}
 <g transform="translate(262 52) rotate(32)">
  <rect x="-8" y="0" width="16" height="74" rx="3" fill="${p.acc}"/>
  <rect x="-8" y="0" width="16" height="12" rx="3" fill="${p.ink}"/>
  <path d="M-8 74 L0 92 L8 74 Z" fill="${p.card}" ${stroke(p, 1.8)}/>
  <path d="M-2.6 86 L0 92 L2.6 86 Z" fill="${p.ink}"/>
 </g>
 ${ground(184, 182, 120, dark)}`;
}

/** Approved: the login arrives by email — an envelope with a key. */
function loginArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(96 74)">
  <rect width="168" height="104" rx="14" fill="${p.card}" ${S}/>
  <path d="M8 12 L84 62 L160 12" fill="none" ${S} stroke-linecap="round"/>
 </g>
 <g transform="translate(176 52) rotate(-24)">
  <circle r="17" fill="${p.soft}" stroke="${p.acc}" stroke-width="3"/>
  <circle r="5" fill="${p.card}" stroke="${p.acc}" stroke-width="2.4"/>
  <rect x="16" y="-3.5" width="54" height="7" rx="3.5" fill="${p.acc}"/>
  <rect x="52" y="2" width="6" height="12" rx="2" fill="${p.acc}"/>
  <rect x="62" y="2" width="6" height="9" rx="2" fill="${p.acc}"/>
 </g>
 <g transform="translate(268 82)">
  <circle r="14" fill="${p.acc}"/>
  ${tick(-6, 0, p.onAcc, 2.6)}
 </g>
 ${ground(180, 186, 110, dark)}`;
}

/** The balance: policies are paid out of a wallet you keep topped up. */
function walletArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(40 70)">
  <rect width="134" height="96" rx="16" fill="${p.card}" ${S}/>
  <path d="M0 22 H134" stroke="${p.lite}" stroke-width="1.5"/>
  <rect x="88" y="38" width="54" height="34" rx="10" fill="${p.soft}" ${S}/>
  <circle cx="106" cy="55" r="5" fill="${p.acc}"/>
 </g>
 <g transform="translate(70 48)">
  <circle r="16" fill="${p.acc}"/>${txt(0, 5, '$', 15, 700, p.onAcc, 'middle')}
 </g>
 <g transform="translate(104 38)">
  <circle r="13" fill="${p.card}" ${stroke(p, 2)}/>${txt(0, 4.5, '$', 12, 700, p.acc, 'middle')}
 </g>
 <path d="M184 118 C 204 118, 208 106, 228 106" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M222 100 L229 106 L222 112" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(244 50) rotate(4)">
  <rect width="86" height="112" rx="10" fill="${p.card}" ${S}/>
  <path d="M0 -12 L9 -9 V0 Q9 8 0 12 Q-9 8 -9 0 V-9 Z" transform="translate(20 22)" fill="${p.acc}"/>
  <rect x="36" y="16" width="36" height="6" rx="3" fill="${p.ink}"/>
  <rect x="36" y="27" width="24" height="4" rx="2" fill="${p.lite}"/>
  ${[48, 60, 72].map((y, i) => `<rect x="12" y="${y}" width="${[62, 54, 60][i]}" height="5" rx="2.5" fill="${p.lite}"/>`).join('')}
  <path d="M12 90 H74" stroke="${p.lite}" stroke-width="1.5"/>
  <rect x="12" y="96" width="30" height="5" rx="2.5" fill="${p.mut}"/>
 </g>
 ${ground(186, 182, 150, dark)}`;
}

export const BonzahApplyArt = makeEmptyArt(applyArt, '8 12 352 178');
export const BonzahReviewArt = makeEmptyArt(reviewArt, '8 12 352 178');
export const BonzahReturnedArt = makeEmptyArt(returnedArt, '8 12 352 178');
export const BonzahLoginArt = makeEmptyArt(loginArt, '8 12 352 178');
export const BonzahWalletArt = makeEmptyArt(walletArt, '8 12 352 178');
