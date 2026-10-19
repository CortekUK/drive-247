'use client';

/**
 * Super admin's own empty-state pictures — the subjects Northwind's portal has
 * no scene for (rental companies, announcements, mode requests, the audit log,
 * AI usage, plans, the operator emails …). Drawn in the same style
 * (ILLUSTRATION_GUIDE.md §4a): ink lines, white cards, the accent only where it
 * matters, faceless people, one idea per picture, a soft ground shadow.
 *
 * Built only from the scene kit: static markup from constants, nothing
 * user-supplied is interpolated, which is what makes the kit's
 * `dangerouslySetInnerHTML` safe.
 */
import { avatar, ground, makeEmptyArt, pal, sparkle, stroke, tick, txt, type Pal } from '../scene-kit';

/** A grey text line. */
const line = (x: number, y: number, w: number, p: Pal, h = 5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${p.lite}"/>`;
/** An ink title bar. */
const title = (x: number, y: number, w: number, p: Pal) =>
  `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${p.ink}"/>`;
const star = (x: number, y: number, r: number, fill: string) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke-linejoin="round"/>`;
};

/* ── Rental companies: a row of shopfronts, one lit up and live ─────────── */
function companiesArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  const shop = (x: number, y: number, w: number, h: number, live: boolean) => `
   <g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${p.card}" ${S}/>
    <path d="M${x} ${y + 26} H${x + w}" stroke="${p.ink}" stroke-width="2.2"/>
    <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="22" rx="8" fill="${live ? p.acc : p.soft}"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${x + 8 + i * ((w - 16) / 3)} ${y + 24} v4" stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round"/>`).join('')}
    <rect x="${x + 12}" y="${y + 38}" width="${w * 0.36}" height="${h - 50}" rx="4" fill="${p.lite}"/>
    <rect x="${x + w * 0.58}" y="${y + 38}" width="${w * 0.3}" height="${h * 0.3}" rx="4" fill="${live ? p.soft : p.lite}"/>
   </g>`;
  return `
 ${shop(40, 62, 86, 96, false)}
 ${shop(140, 34, 98, 124, true)}
 <g><circle cx="234" cy="38" r="14" fill="${p.acc}"/>${tick(227, 38, p.onAcc)}</g>
 ${shop(252, 62, 86, 96, false)}
 ${sparkle(150, 22, 7, p.acc)}
 ${ground(188, 164, 160, dark)}`;
}
export const CompaniesEmptyArt = makeEmptyArt(companiesArt, '20 8 340 168');

/* ── Announcements: a megaphone, and the notice it sends out ────────────── */
function announcementsArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><path d="M62 92 L118 66 V138 L62 112 Z" fill="${p.acc}"/>
  <rect x="44" y="90" width="22" height="24" rx="6" fill="${p.card}" ${S}/>
  <path d="M70 114 L78 140 H92 L86 118" fill="${p.card}" ${S}/>
  <rect x="116" y="62" width="12" height="80" rx="6" fill="${p.card}" ${S}/></g>
 <path d="M140 84 q10 18 0 36 M152 74 q16 28 0 56" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 <g><rect x="178" y="34" width="150" height="62" rx="12" fill="${p.card}" ${S}/>
  <rect x="192" y="48" width="40" height="12" rx="6" fill="${p.soft}"/>${txt(212, 57.5, 'NEW', 8.5, 800, p.acc, 'middle')}
  ${title(192, 68, 110, p)}${line(192, 81, 84, p)}</g>
 <g><rect x="198" y="108" width="130" height="48" rx="12" fill="${p.card}" ${S}/>
  ${title(212, 122, 80, p)}${line(212, 135, 96, p)}</g>
 ${sparkle(330, 30, 7, p.acc)}
 ${ground(188, 166, 160, dark)}`;
}
export const AnnouncementsEmptyArt = makeEmptyArt(announcementsArt, '20 14 340 162');

/* ── Feedback: an operator's note, with its stars ───────────────────────── */
function feedbackArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 ${avatar(70, 120, 26, p, '#b77e5f', '#1f2040')}
 <g><path d="M118 40 H300 Q316 40 316 56 V112 Q316 128 300 128 H140 Q128 140 112 144 Q120 132 118 124 Q102 122 102 106 V56 Q102 40 118 40 Z" fill="${p.card}" ${S}/>
  ${[0, 1, 2, 3, 4].map((i) => star(128 + i * 22, 64, 9, i < 4 ? p.acc : p.lite)).join('')}
  ${title(122, 84, 150, p)}${line(122, 98, 170, p)}${line(122, 110, 120, p)}</g>
 ${sparkle(318, 34, 7, p.acc)}
 ${ground(196, 156, 150, dark)}`;
}
export const FeedbackEmptyArt = makeEmptyArt(feedbackArt, '30 22 310 144');

/* ── Mode requests: Test, flipped to Live ───────────────────────────────── */
function modeSwitchArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="40" y="60" width="104" height="56" rx="28" fill="${p.card}" ${S}/>
  <circle cx="68" cy="88" r="18" fill="${p.lite}"/>${txt(112, 93, 'TEST', 12, 800, p.mut, 'middle')}</g>
 <path d="M156 88 H202" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M196 81 L204 88 L196 95" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <g><rect x="216" y="60" width="112" height="56" rx="28" fill="${p.acc}"/>
  ${txt(254, 93, 'LIVE', 12, 800, p.onAcc, 'middle')}<circle cx="300" cy="88" r="20" fill="${p.card}" ${S}/>${tick(293, 88, p.acc)}</g>
 <g><rect x="120" y="128" width="128" height="30" rx="10" fill="${p.card}" ${S}/>
  ${avatar(140, 143, 10, p)}${line(158, 140, 70, p)}</g>
 ${sparkle(334, 54, 7, p.acc)}
 ${ground(186, 168, 150, dark)}`;
}
export const ModeRequestsEmptyArt = makeEmptyArt(modeSwitchArt, '22 36 330 140');

/* ── Audit log: a list of what happened, under a magnifier ──────────────── */
function logArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  const row = (y: number, w: number, accent: boolean) =>
    `<circle cx="102" cy="${y}" r="5" fill="${accent ? p.acc : p.lite}"/>${line(116, y - 3, w, p, 6)}<rect x="250" y="${y - 6}" width="36" height="12" rx="6" fill="${p.soft}"/>`;
  return `
 <g><rect x="80" y="26" width="226" height="138" rx="14" fill="${p.card}" ${S}/>
  ${title(98, 42, 90, p)}
  <path d="M80 58 H306" stroke="${p.lite}" stroke-width="2"/>
  ${row(76, 110, true)}${row(98, 86, false)}${row(120, 120, false)}${row(142, 70, false)}</g>
 <g><circle cx="300" cy="118" r="26" fill="${p.bg}" fill-opacity=".85" stroke="${p.ink}" stroke-width="3"/>
  <path d="M319 137 L338 156" stroke="${p.ink}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="300" cy="118" r="10" fill="${p.soft}"/></g>
 ${ground(196, 172, 140, dark)}`;
}
export const AuditLogEmptyArt = makeEmptyArt(logArt, '50 14 310 166');

/* ── AI usage: a week of spend, one day lit, and the spark that made it ─── */
function usageArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  const bars = [38, 58, 46, 74, 52, 30];
  return `
 <g><rect x="70" y="28" width="230" height="132" rx="14" fill="${p.card}" ${S}/>
  ${title(88, 44, 70, p)}
  ${bars.map((h, i) => `<rect x="${96 + i * 32}" y="${146 - h}" width="18" height="${h}" rx="5" fill="${i === 3 ? p.acc : p.lite}"/>`).join('')}
  <path d="M88 148 H282" stroke="${p.ink}" stroke-width="2" stroke-linecap="round"/></g>
 <g><rect x="244" y="20" width="84" height="30" rx="15" fill="${p.acc}"/>${txt(286, 40, '1.2k', 13, 800, p.onAcc, 'middle')}</g>
 ${sparkle(52, 52, 12, p.acc)}${sparkle(40, 84, 6, p.acc)}
 ${ground(186, 168, 140, dark)}`;
}
export const UsageEmptyArt = makeEmptyArt(usageArt, '24 10 316 166');

/* ── Plans: three price cards, the middle one chosen ────────────────────── */
function plansArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  const card = (x: number, y: number, h: number, chosen: boolean) => `
   <g><rect x="${x}" y="${y}" width="84" height="${h}" rx="12" fill="${chosen ? p.acc : p.card}" ${chosen ? '' : S}/>
    <rect x="${x + 14}" y="${y + 16}" width="34" height="7" rx="3.5" fill="${chosen ? p.onAcc : p.ink}"/>
    <rect x="${x + 14}" y="${y + 32}" width="48" height="12" rx="4" fill="${chosen ? p.onAcc : p.ink}" opacity="${chosen ? 0.95 : 1}"/>
    ${[0, 1, 2].map((i) => `${tick(x + 14, y + 62 + i * 16, chosen ? p.onAcc : p.acc, 2)}<rect x="${x + 32}" y="${y + 58 + i * 16}" width="36" height="5" rx="2.5" fill="${chosen ? p.onAcc : p.lite}" opacity="${chosen ? 0.6 : 1}"/>`).join('')}
   </g>`;
  return `
 ${card(52, 50, 108, false)}
 ${card(146, 30, 128, true)}
 ${card(240, 50, 108, false)}
 ${sparkle(236, 26, 7, p.acc)}
 ${ground(200, 166, 160, dark)}`;
}
export const PlansEmptyArt = makeEmptyArt(plansArt, '30 14 340 162');

/* ── Integrations: two services, plugged together, one of them premium ─── */
function integrationsArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="44" y="58" width="96" height="76" rx="14" fill="${p.card}" ${S}/>
  <rect x="62" y="76" width="28" height="28" rx="8" fill="${p.soft}"/>${line(62, 114, 60, p)}</g>
 <path d="M140 96 C 170 96, 170 70, 196 70" fill="none" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
 <g><rect x="190" y="62" width="18" height="16" rx="4" fill="${p.acc}"/><path d="M208 66 h8 M208 74 h8" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/></g>
 <g><rect x="226" y="40" width="108" height="94" rx="14" fill="${p.card}" ${S}/>
  <rect x="244" y="58" width="28" height="28" rx="8" fill="${p.acc}"/>
  <path d="M250 78 l4 -10 l4 6 l4 -6 l4 10 Z" fill="${p.onAcc}"/>
  ${title(244, 98, 64, p)}${line(244, 112, 72, p)}</g>
 ${sparkle(336, 36, 7, p.acc)}
 ${ground(190, 150, 150, dark)}`;
}
export const IntegrationsEmptyArt = makeEmptyArt(integrationsArt, '24 22 330 136');

/* ── Emails: a letter folded into a plane, on its way ───────────────────── */
function emailsArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="52" y="74" width="132" height="86" rx="12" fill="${p.card}" ${S}/>
  <path d="M56 80 L118 122 L180 80" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/></g>
 <g><rect x="68" y="56" width="132" height="86" rx="12" fill="${p.card}" ${S}/>
  <path d="M72 62 L134 104 L196 62" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="186" cy="128" r="9" fill="${p.acc}"/></g>
 <path d="M206 100 C 236 96, 252 78, 268 62" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <g><path d="M262 54 L330 28 L304 92 L288 70 Z" fill="${p.acc}"/><path d="M288 70 L330 28 L280 62 Z" fill="${p.card}" ${stroke(p, 2)}/></g>
 ${ground(190, 170, 150, dark)}`;
}
export const EmailsEmptyArt = makeEmptyArt(emailsArt, '30 14 320 162');

/* ── Webinars: a call on a screen, a date on the calendar ───────────────── */
function webinarArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="46" y="30" width="196" height="124" rx="14" fill="${p.card}" ${S}/>
  <rect x="60" y="44" width="168" height="74" rx="10" fill="${p.soft}"/>
  ${avatar(144, 82, 26, p, '#d9a88a', '#1f2040')}
  ${avatar(82, 136, 10, p, '#b77e5f')}${avatar(108, 136, 10, p, '#e0b593')}${avatar(134, 136, 10, p, '#8d5b43')}
  <rect x="184" y="128" width="44" height="16" rx="8" fill="${p.acc}"/>${txt(206, 140, 'LIVE', 8.5, 800, p.onAcc, 'middle')}</g>
 <g><rect x="256" y="56" width="84" height="84" rx="12" fill="${p.card}" ${S}/>
  <path d="M256 80 H340" stroke="${p.ink}" stroke-width="2.2"/>
  <rect x="258" y="58" width="80" height="20" rx="10" fill="${p.acc}"/>
  ${txt(298, 117, '12', 26, 800, p.ink, 'middle')}
  <path d="M276 50 v12 M320 50 v12" stroke="${p.ink}" stroke-width="3" stroke-linecap="round"/></g>
 ${ground(194, 166, 156, dark)}`;
}
export const WebinarsEmptyArt = makeEmptyArt(webinarArt, '30 18 326 156');

/* ── Milestones and rewards: a trophy, with a flag for the next one ─────── */
function trophyArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><path d="M152 40 H224 V78 Q224 112 188 116 Q152 112 152 78 Z" fill="${p.acc}"/>
  <path d="M152 52 H134 Q130 78 154 86 M224 52 H242 Q246 78 222 86" fill="none" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="180" y="116" width="16" height="16" fill="${p.ink}"/>
  <rect x="160" y="132" width="56" height="16" rx="5" fill="${p.card}" ${S}/>
  ${star(188, 74, 13, p.onAcc)}</g>
 <g><path d="M276 150 V70" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M276 72 H318 L308 86 L318 100 H276 Z" fill="${p.card}" ${S}/>${line(284, 83, 18, p)}</g>
 ${sparkle(126, 40, 9, p.acc)}${sparkle(250, 36, 6, p.acc)}${sparkle(112, 104, 5, p.acc)}
 ${ground(214, 156, 130, dark)}`;
}
export const MilestonesEmptyArt = makeEmptyArt(trophyArt, '84 22 260 144');

/* ── Polls and scores: one question, three answers, one ahead ───────────── */
function pollArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  const opt = (y: number, w: number, lead: boolean) => `
   <rect x="94" y="${y}" width="170" height="22" rx="11" fill="${p.lite}" opacity=".55"/>
   <rect x="94" y="${y}" width="${w}" height="22" rx="11" fill="${lead ? p.acc : p.lite}"/>
   ${lead ? tick(102, y + 11, p.onAcc, 2.2) : ''}`;
  return `
 <g><rect x="76" y="24" width="206" height="136" rx="14" fill="${p.card}" ${S}/>
  ${title(94, 42, 120, p)}
  ${opt(62, 140, true)}${opt(92, 82, false)}${opt(122, 46, false)}</g>
 <g>${[0, 1, 2, 3, 4].map((i) => `<rect x="${296 + (i % 2) * 0}" y="${46 + i * 22}" width="34" height="16" rx="8" fill="${i === 0 ? p.acc : p.soft}"/>${txt(313, 58 + i * 22, String(10 - i), 9, 800, i === 0 ? p.onAcc : p.acc, 'middle')}`).join('')}</g>
 ${ground(200, 170, 140, dark)}`;
}
export const PollsEmptyArt = makeEmptyArt(pollArt, '56 12 296 166');

/* ── Testimonials: a quote card, with its stars and its author ──────────── */
function quoteArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="70" y="34" width="230" height="110" rx="14" fill="${p.card}" ${S}/>
  ${txt(94, 86, '“', 64, 800, p.acc)}
  ${title(132, 58, 140, p)}${line(132, 72, 150, p)}${line(132, 84, 110, p)}
  ${[0, 1, 2, 3, 4].map((i) => star(140 + i * 18, 112, 7, p.acc)).join('')}</g>
 ${avatar(300, 140, 22, p, '#d9a88a', '#1f2040')}
 ${ground(190, 170, 140, dark)}`;
}
export const TestimonialsEmptyArt = makeEmptyArt(quoteArt, '50 20 290 158');

/* ── Team chat (coming soon): three of you, talking ─────────────────────── */
function teamChatArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 ${avatar(56, 74, 24, p, '#b77e5f', '#1f2040')}
 <g><path d="M96 46 H220 Q234 46 234 60 V80 Q234 94 220 94 H106 Q98 102 88 104 Q94 96 92 90 Q82 86 82 76 V60 Q82 46 96 46 Z" fill="${p.card}" ${S}/>
  ${title(98, 60, 96, p)}${line(98, 74, 118, p)}</g>
 <g><path d="M140 108 H286 Q300 108 300 122 V138 Q300 146 308 152 Q294 154 286 152 H140 Q126 152 126 138 V122 Q126 108 140 108 Z" fill="${p.acc}"/>
  <rect x="142" y="120" width="112" height="6" rx="3" fill="${p.onAcc}" opacity=".95"/><rect x="142" y="133" width="76" height="5" rx="2.5" fill="${p.onAcc}" opacity=".6"/></g>
 ${avatar(334, 130, 22, p, '#d9a88a', '#1f2040')}
 ${avatar(300, 58, 20, p, '#e0b593', '#3a2a20')}
 <g><circle cx="300" cy="58" r="20" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4"/></g>
 ${sparkle(250, 38, 7, p.acc)}
 ${ground(196, 172, 160, dark)}`;
}
export const TeamChatArt = makeEmptyArt(teamChatArt, '22 22 340 156');

/* ── No matches: a magnifier over a list with nothing in it ─────────────── */
function noMatchArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="90" y="34" width="180" height="116" rx="14" fill="${p.card}" ${S}/>
  ${[0, 1, 2].map((i) => `<rect x="108" y="${54 + i * 30}" width="144" height="18" rx="9" fill="none" stroke="${p.lite}" stroke-width="2" stroke-dasharray="4 5"/>`).join('')}</g>
 <g><circle cx="262" cy="104" r="28" fill="${p.bg}" fill-opacity=".9" stroke="${p.ink}" stroke-width="3"/>
  <path d="M282 124 L302 144" stroke="${p.ink}" stroke-width="6" stroke-linecap="round"/>
  <path d="M252 104 h20" stroke="${p.acc}" stroke-width="3" stroke-linecap="round"/></g>
 ${ground(196, 160, 120, dark)}`;
}
export const NoMatchArt = makeEmptyArt(noMatchArt, '70 20 250 150');

/* ── Search, before anything is picked: a search typed above a row of
      shopfronts, and the one it found (Northwind's search scene, with the
      rental companies in place of the fleet). ─────────────────────────── */
function searchArt(dark: boolean): string {
  const p = pal(dark);
  const floor = dark ? '#3a3a3a' : '#e4e4e7';
  const tile = (x: number) =>
    `<rect x="${x}" y="122" width="54" height="34" rx="9" fill="${p.card}" stroke="${p.lite}" stroke-width="2"/>` +
    `<rect x="${x + 2}" y="124" width="50" height="8" rx="4" fill="${p.lite}"/>` +
    `<rect x="${x + 10}" y="138" width="34" height="5" rx="2.5" fill="${p.lite}"/>` +
    `<rect x="${x + 10}" y="147" width="22" height="4" rx="2" fill="${p.lite}"/>`;
  return (
    `<path d="M20 172 H340" stroke="${floor}" stroke-width="2" stroke-linecap="round"/>` +
    `<rect x="70" y="30" width="220" height="36" rx="18" fill="${p.card}" stroke="${p.acc}" stroke-width="2"/>` +
    `<circle cx="93" cy="46" r="7" fill="none" stroke="${p.acc}" stroke-width="2.4"/>` +
    `<path d="M98 51 l6 6" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<rect x="114" y="43" width="92" height="6" rx="3" fill="${p.ink}" opacity=".8"/>` +
    `<rect x="210" y="40" width="2" height="12" rx="1" fill="${p.acc}"/>` +
    `<path d="M180 66 C180 84 206 84 206 100" fill="none" stroke="${p.acc}" stroke-width="1.8" stroke-dasharray="3 4" stroke-linecap="round"/>` +
    tile(34) + tile(96) + tile(292) +
    // the found company: a lit shopfront on an accent pad
    `<rect x="156" y="104" width="126" height="62" rx="14" fill="${p.soft}" stroke="${p.acc}" stroke-width="2"/>` +
    `<g><rect x="186" y="112" width="66" height="46" rx="8" fill="${p.card}" ${stroke(p, 2)}/>` +
    `<rect x="188" y="114" width="62" height="12" rx="6" fill="${p.acc}"/>` +
    `<rect x="196" y="132" width="20" height="22" rx="3" fill="${p.lite}"/><rect x="224" y="132" width="20" height="12" rx="3" fill="${p.soft}"/></g>` +
    `<circle cx="252" cy="112" r="9" fill="${p.acc}"/>${tick(247.5, 112, p.onAcc, 2)}`
  );
}
export const SearchEmptyArt = makeEmptyArt(searchArt, '22 22 330 156');

/* ── System announcement: a portal window, a banner across the top and a notice ── */
function systemNoticeArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="52" y="30" width="264" height="132" rx="14" fill="${p.card}" ${S}/>
  <path d="M52 52 H316" stroke="${p.ink}" stroke-width="2.2"/>
  ${[0, 1, 2].map((i) => `<circle cx="${68 + i * 11}" cy="41" r="3.2" fill="${p.lite}"/>`).join('')}
  <rect x="53.1" y="53.1" width="261.8" height="20" fill="${p.acc}"/>
  <circle cx="68" cy="63" r="5.5" fill="${p.onAcc}"/>${txt(68, 66.2, '!', 8.5, 800, p.acc, 'middle')}
  <rect x="80" y="60.5" width="96" height="5" rx="2.5" fill="${p.onAcc}" opacity="0.9"/>
  <rect x="184" y="60.5" width="56" height="5" rx="2.5" fill="${p.onAcc}" opacity="0.55"/>
  <rect x="68" y="86" width="56" height="64" rx="8" fill="${p.lite}" opacity="0.6"/>
  ${line(136, 88, 120, p)}${line(136, 100, 150, p)}${line(136, 112, 96, p)}</g>
 <g><rect x="176" y="96" width="122" height="72" rx="12" fill="${p.card}" ${S}/>
  <rect x="177.1" y="97.1" width="119.8" height="5" rx="2.5" fill="${p.acc}"/>
  <circle cx="194" cy="118" r="7" fill="${p.soft}"/>${txt(194, 121.3, 'i', 9, 800, p.acc, 'middle')}
  ${title(208, 114, 70, p)}${line(190, 132, 92, p)}
  <rect x="246" y="146" width="40" height="13" rx="6.5" fill="${p.acc}"/></g>
 ${sparkle(322, 26, 7, p.acc)}
 ${ground(186, 172, 150, dark)}`;
}
export const SystemNoticeArt = makeEmptyArt(systemNoticeArt, '30 14 310 168');

/* ── Feature announcement: the dashboard card, and the slides it opens ─────── */
function featureCardArt(dark: boolean): string {
  const p = pal(dark), S = stroke(p);
  return `
 <g><rect x="40" y="44" width="132" height="112" rx="14" fill="${p.card}" ${S}/>
  <rect x="41.1" y="45.1" width="129.8" height="62" rx="13" fill="${p.soft}"/>
  ${star(106, 74, 16, p.acc)}
  <rect x="52" y="52" width="34" height="12" rx="6" fill="${p.card}"/>${txt(69, 61, 'NEW', 8, 800, p.acc, 'middle')}
  ${title(54, 118, 90, p)}${line(54, 131, 70, p)}
  <rect x="54" y="141" width="44" height="5" rx="2.5" fill="${p.acc}"/></g>
 <path d="M182 100 q18 -14 36 0" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 <path d="M212 94 l7 6 -8 4" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
 <g><rect x="242" y="40" width="96" height="104" rx="12" fill="${p.card}" ${S} opacity="0.6"/>
  <rect x="230" y="50" width="104" height="112" rx="12" fill="${p.card}" ${S}/>
  <rect x="231.1" y="51.1" width="101.8" height="46" rx="11" fill="${p.lite}" opacity="0.7"/>
  ${title(242, 108, 70, p)}${line(242, 121, 80, p)}${line(242, 132, 60, p)}
  <rect x="242" y="146" width="14" height="4" rx="2" fill="${p.acc}"/>
  <circle cx="263" cy="148" r="2" fill="${p.lite}"/><circle cx="271" cy="148" r="2" fill="${p.lite}"/></g>
 ${sparkle(176, 36, 7, p.acc)}
 ${ground(188, 168, 156, dark)}`;
}
export const FeatureCardArt = makeEmptyArt(featureCardArt, '24 18 330 160');
