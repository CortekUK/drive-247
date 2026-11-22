'use client';

/**
 * The Glass look for the v2 dashboard (Settings → Branding → Theme).
 *
 * Modelled on Apple's Liquid Glass (Ghulam, Nov 2026): clear, thick panes with
 * a bright lensed edge, capsule controls floating over the content, a light
 * that follows the pointer across a pane, and springy motion — a pane settles
 * in, lifts under the pointer and gives a little when pressed. The background
 * is the Standard look's own, untouched.
 *
 * Injected by DashboardV2 as a <style> block ONLY while Glass is on, the same
 * way HOME_PALETTE is, so none of it exists on any other screen or for the
 * Standard look. No file outside the dashboard is edited:
 *
 *   - Everything outside `.pv` (the sidebar, the top bar's
 *     search field) is reached through `[data-slot="sidebar-wrapper"]:has(.pv-glass)`,
 *     so it applies only while a Glass dashboard is on screen and falls away
 *     the moment you leave it.
 *   - Cards are found by the classes they already carry (`rounded-2xl` plus the
 *     `--pv-paper` fill). The revenue chart has no card and is marked
 *     `data-pv-pane`.
 *
 * Panes use box-shadows and background layers only, never ::before / ::after
 * or `position`, so no card's own layout or pseudo-elements are disturbed.
 * All motion is dropped under `prefers-reduced-motion`.
 */

import { useEffect } from 'react';

const FRAME = '.v2-theme [data-slot="sidebar-wrapper"]:has(.pv-glass)';
const CARD = '.pv.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"]';
const PANE = `${CARD}, .pv.pv-glass [data-pv-pane]`;

/** Everything the pointer light plays on (see `useGlassPointerLight`). */
const LIT_SELECTOR =
  '.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"], .pv-glass [data-pv-pane], .pv-glass [data-feature-deck], [data-slot="sidebar-inner"]';

const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
const SETTLE = 'cubic-bezier(.2, .9, .25, 1.08)';

export const GLASS_PALETTE = `
  /* How bright the pointer light is on a pane. Registered so it can fade. */
  @property --gl { syntax: "<number>"; inherits: false; initial-value: 0; }

  /* ── The background ─────────────────────────────────────────────────
     Left exactly as the Standard look paints it (.bg-app-gradient::before,
     styles/v2-theme.css). A photograph, then a pink and sky colour field, then
     a purple accent field were each tried behind the glass and each removed
     (Ghulam, Nov 2026), so Glass does not touch the background at all. */

  /* ── The material ───────────────────────────────────────────────────── */
  ${FRAME} {
    --lg-pane: rgb(255 255 255 / 0);
    --lg-pane-low: rgb(255 255 255 / 0);
    --lg-rim: rgb(255 255 255 / 0.75);
    /* The pointer light and the lower lip of each pane reflect the accent. */
    --lg-light: 198 192 255;
    /* A thick edge: a hard highlight on top, a soft glow inside the top and
       bottom lips (the lens), then a contact shadow and a long soft one. */
    --lg-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.95),
      inset 0 10px 18px -14px rgb(255 255 255 / 0.45),
      inset 0 -12px 18px -12px rgb(167 159 245 / 0.6),
      inset 0 0 0 1px rgb(255 255 255 / 0.18),
      0 2px 6px -2px rgb(20 18 50 / 0.14),
      0 30px 60px -30px rgb(46 42 143 / 0.6);
    --lg-shadow-lift:
      inset 0 1px 0 rgb(255 255 255 / 1),
      inset 0 10px 18px -14px rgb(255 255 255 / 0.55),
      inset 0 -12px 18px -12px rgb(167 159 245 / 0.7),
      inset 0 0 0 1px rgb(255 255 255 / 0.22),
      0 4px 10px -4px rgb(20 18 50 / 0.18),
      0 44px 70px -32px rgb(46 42 143 / 0.72);
    /* Absolutely clear (Ghulam, Nov 2026): no fill and no blur at all, so
       what is behind a pane shows through it untouched. The rim, the edge glows and the
       shadow are what draw the sheet. */
    --lg-frost: blur(0px);
  }
  .dark ${FRAME} {
    --lg-pane: rgb(255 255 255 / 0);
    --lg-pane-low: rgb(255 255 255 / 0);
    --lg-rim: rgb(255 255 255 / 0.16);
    --lg-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.2),
      inset 0 10px 18px -14px rgb(255 255 255 / 0.16),
      inset 0 0 0 1px rgb(255 255 255 / 0.05),
      0 2px 6px -2px rgb(0 0 0 / 0.3),
      0 30px 60px -30px rgb(0 0 0 / 0.7);
    --lg-shadow-lift:
      inset 0 1px 0 rgb(255 255 255 / 0.26),
      inset 0 10px 18px -14px rgb(255 255 255 / 0.2),
      inset 0 0 0 1px rgb(255 255 255 / 0.07),
      0 4px 10px -4px rgb(0 0 0 / 0.4),
      0 44px 70px -32px rgb(0 0 0 / 0.8);
    --lg-frost: blur(0px);
  }

  .pv.pv-glass {
    /* Inside a pane: rows, chips and hairlines go see-through too, so a card
       reads as one sheet of glass rather than white slabs on a frosted one. */
    --pv-paper: rgb(255 255 255 / 0);
    --pv-wash: rgb(255 255 255 / 0.12);
    --pv-line: color-mix(in srgb, hsl(var(--foreground)) 9%, transparent);
    /* Secondary ink a step darker: it sits on see-through glass now, not on a solid card. */
    --pv-ink-2: color-mix(in srgb, hsl(var(--foreground)) 82%, transparent);
    --pv-ink-3: color-mix(in srgb, hsl(var(--foreground)) 62%, transparent);
  }
  .dark .pv.pv-glass {
    --pv-paper: rgb(255 255 255 / 0.06);
    --pv-wash: rgb(255 255 255 / 0.07);
    --pv-line: rgb(255 255 255 / 0.1);
  }

  /* ── Panes: every dashboard card, and the revenue chart ─────────────── */
  ${PANE} {
    background:
      radial-gradient(34rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.5)), transparent 62%),
      linear-gradient(150deg, var(--lg-pane), var(--lg-pane-low));
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border: 1px solid var(--lg-rim);
    border-radius: 28px;
    box-shadow: var(--lg-shadow);
    transition:
      transform 480ms ${SPRING},
      box-shadow 320ms ease-out,
      --gl 320ms ease-out;
    animation: pv-glass-in 720ms ${SETTLE} both;
  }
  .dark ${CARD}, .dark .pv.pv-glass [data-pv-pane] { --lg-light: 190 200 255; }
  .pv.pv-glass [data-pv-pane] { padding: 14px 20px; }

  /* The feature card (Turo Sync, Zoho Books…) is a pane too. Light mode only:
     the card keeps its own light surface in dark mode, because its art is one
     light image and its text is ink (feature-announcement-deck.tsx). */
  html:not(.dark) .pv.pv-glass [data-feature-deck] {
    background:
      radial-gradient(34rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.5)), transparent 62%),
      linear-gradient(150deg, var(--lg-pane), var(--lg-pane-low));
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border: 1px solid var(--lg-rim);
    border-radius: 28px;
    box-shadow: var(--lg-shadow);
    transition: transform 480ms ${SPRING}, box-shadow 320ms ease-out, --gl 320ms ease-out;
    animation: pv-glass-in 720ms ${SETTLE} 60ms both;
  }
  html:not(.dark) .pv.pv-glass [data-feature-deck]:hover {
    --gl: 1;
    transform: translateY(-3px);
    box-shadow: var(--lg-shadow-lift);
  }
  @media (prefers-reduced-motion: reduce) {
    html:not(.dark) .pv.pv-glass [data-feature-deck],
    html:not(.dark) .pv.pv-glass [data-feature-deck]:hover { animation: none; transition: none; transform: none; }
  }

  /* The Trax card's own accent wash (the absolutely placed gradient layer at
     the top of the card, admin-cards.tsx) is dropped, so it is as clear as the
     cards beside it. */
  .pv.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"] > span[aria-hidden="true"].pointer-events-none.absolute.inset-0 {
    display: none;
  }

  /* The pointer is on the glass: the light comes up and the pane lifts. */
  .pv.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"]:hover,
  .pv.pv-glass [data-pv-pane]:hover {
    --gl: 1;
    transform: translateY(-3px);
    box-shadow: var(--lg-shadow-lift);
  }
  /* Pressed: the glass gives a little, then springs back. */
  .pv.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"]:active,
  .pv.pv-glass [data-pv-pane]:active {
    transform: translateY(-1px) scale(0.992);
    transition-duration: 140ms, 140ms, 140ms;
  }

  /* Settling in: each pane rises, sharpens and lands with a slight overshoot,
     one after another across the page. */
  @keyframes pv-glass-in {
    from { opacity: 0; transform: translateY(18px) scale(0.965); filter: blur(10px); }
    60% { opacity: 1; filter: blur(0); }
  }
  .pv.pv-glass section:nth-of-type(2) .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 90ms; }
  .pv.pv-glass section:nth-of-type(2) :nth-child(2) > .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 160ms; }
  .pv.pv-glass section:nth-of-type(2) :nth-child(3) > .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 230ms; }
  .pv.pv-glass section:nth-of-type(n+3) .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 300ms; }

  /* Even panes (Ghulam, Nov 2026): the three Operations cards share one fixed
     height, so the row reads as three matching sheets. The Trax card already
     shows only the points that fit its height; Requests and To do scroll past
     theirs. The Standard look keeps each card as tall as its content. */
  @media (min-width: 768px) {
    .pv.pv-glass section[aria-label="Operations"] > .grid > * { height: 360px; }
    .pv.pv-glass section[aria-label="Operations"] .self-start { align-self: stretch; }
    .pv.pv-glass section[aria-label="Operations"] > .grid > * > * { min-height: 0; }
    /* The first row starts inside the page. In the Standard look it is pulled
       29px up under the top bar (-14px on the page, -15px on this band) to line
       its title up with the sidebar switch; the chart has no card there, so
       nothing shows. A pane has an edge, and the scrollport cut its rounded top
       corners off. The feature card's own 10px offset goes too, so both panes
       share a top edge. */
    .pv.pv-glass [data-desk-band] { margin-top: 22px; }
    .pv.pv-glass [data-desk-band] [class~="lg:mt-[10px]"] { margin-top: 0; }
    /* The row below sits one card-gap under this one, not 45 to 65px. */
    .pv.pv-glass section[aria-label="Insights"] { margin-top: 20px; }
  }

  /* A to-do row is the card's own surface, not a chip: clear, so the pane
     shows through, and still washed on hover. */
  .pv.pv-glass .rounded-lg[class~="bg-[var(--pv-paper)]"]:not(:hover) { background: transparent; }

  /* Fields and popovers inside a card: a thicker frost to read on. */
  .pv.pv-glass .rounded-xl[class~="bg-[var(--pv-paper)]"],
  .pv.pv-glass .rounded-xl[class~="bg-[var(--pv-wash)]"] {
    background: transparent;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.9), inset 0 0 0 1px rgb(255 255 255 / 0.55), 0 6px 14px -10px rgb(46 42 143 / 0.4);
  }
  .dark .pv.pv-glass .rounded-xl[class~="bg-[var(--pv-paper)]"],
  .dark .pv.pv-glass .rounded-xl[class~="bg-[var(--pv-wash)]"] {
    background: rgb(26 28 46 / 0.7);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
  }

  /* Buttons in a card press like glass too. */
  .pv.pv-glass button { transition-timing-function: ${SPRING}; }
  .pv.pv-glass button:active { transform: scale(0.96); }

  /* ── The sidebar: one floating pane, capsule rows ───────────────────── */
  @media (min-width: 768px) {
    ${FRAME} [data-slot="sidebar-container"] { padding: 10px 0 10px 10px; }
    ${FRAME} [data-slot="sidebar-inner"] {
      background:
        radial-gradient(26rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.35)), transparent 62%),
        linear-gradient(160deg, var(--lg-pane), var(--lg-pane-low));
      -webkit-backdrop-filter: var(--lg-frost);
      backdrop-filter: var(--lg-frost);
      border: 1px solid var(--lg-rim);
      border-radius: 30px;
      box-shadow: var(--lg-shadow);
      overflow: hidden;
      transition: --gl 320ms ease-out;
      animation: pv-glass-in 720ms ${SETTLE} both;
    }
    ${FRAME} [data-slot="sidebar-inner"]:hover { --gl: 1; }
  }
  ${FRAME} [data-slot="sidebar-menu-button"] {
    border-radius: 999px;
    transition: transform 420ms ${SPRING}, background-color 200ms ease-out, box-shadow 200ms ease-out, color 200ms ease-out;
  }
  ${FRAME} [data-slot="sidebar-menu-button"]:hover { background-color: rgb(255 255 255 / 0.14); }
  ${FRAME} [data-slot="sidebar-menu-button"]:active { transform: scale(0.96); }
  ${FRAME} [data-slot="sidebar-menu-button"][data-active="true"] {
    background-color: rgb(255 255 255 / 0.1);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 1),
      0 1px 2px rgb(20 18 50 / 0.08),
      0 10px 22px -12px color-mix(in oklab, hsl(var(--primary)) 55%, transparent);
  }
  .dark ${FRAME} [data-slot="sidebar-menu-button"]:hover { background-color: rgb(255 255 255 / 0.08); }
  .dark ${FRAME} [data-slot="sidebar-menu-button"][data-active="true"] {
    background-color: rgb(255 255 255 / 0.14);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 10px 22px -12px rgb(0 0 0 / 0.6);
  }

  /* ── The top bar's search field: a glass capsule ────────────────────── */
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"] {
    background: linear-gradient(150deg, var(--lg-pane), var(--lg-pane-low));
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    /* A little more definition than a card gets (Ghulam, Nov 2026): a fine
       accent line around the capsule under the white rim, and a closer shadow. */
    border-color: var(--lg-rim);
    border-radius: 999px;
    box-shadow:
      var(--lg-shadow),
      0 0 0 1px rgb(79 68 216 / 0.16),
      0 6px 16px -8px rgb(46 42 143 / 0.4);
    transition: transform 420ms ${SPRING}, box-shadow 300ms ease-out;
  }
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"]:hover { transform: scale(1.012); box-shadow: var(--lg-shadow-lift), 0 0 0 1px rgb(79 68 216 / 0.24), 0 8px 20px -8px rgb(46 42 143 / 0.45); }
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"]:active { transform: scale(0.985); }

  /* ── The top bar's buttons (Help, messages, the bell): glass capsules ─ */
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto { gap: 8px; }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a) {
    background: linear-gradient(150deg, var(--lg-pane), var(--lg-pane-low));
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border: 1px solid var(--lg-rim);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.95),
      inset 0 -6px 10px -8px rgb(167 159 245 / 0.6),
      0 1px 3px -1px rgb(20 18 50 / 0.14),
      0 14px 26px -16px rgb(46 42 143 / 0.55);
    transition: transform 420ms ${SPRING}, box-shadow 300ms ease-out;
  }
  .dark ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a) {
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 14px 26px -16px rgb(0 0 0 / 0.7);
  }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):hover { transform: translateY(-1px) scale(1.04); }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):active { transform: scale(0.94); }

  /* ── The phone tab bar: a floating glass capsule, as on iOS ───────────
     (shared/layout/mobile-tab-bar.tsx, reached from here, not edited.) The
     full-width strip with a top border becomes a capsule that floats clear of
     the screen edges, the page scrolling underneath it. The bar is the one
     place Glass keeps a blur: text passes right behind its labels. The tab you
     are on sits in a bubble of brighter glass. */
  @media (max-width: 767px) {
    body:has(.pv-glass) [data-mobile-tab-bar] {
      background: transparent;
      border-top: 0;
      pointer-events: none;
      padding: 0 14px calc(env(safe-area-inset-bottom, 0px) + 10px);
    }
    body:has(.pv-glass) [data-mobile-tab-bar] > nav {
      pointer-events: auto;
      height: 58px;
      padding: 5px;
      gap: 3px;
      max-width: 400px;
      border-radius: 999px;
      border: 1px solid rgb(255 255 255 / 0.85);
      background: linear-gradient(150deg, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0.12));
      -webkit-backdrop-filter: blur(14px) saturate(180%);
      backdrop-filter: blur(14px) saturate(180%);
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.95),
        inset 0 -8px 14px -10px rgb(167 159 245 / 0.55),
        0 2px 6px -2px rgb(20 18 50 / 0.16),
        0 18px 36px -14px rgb(46 42 143 / 0.5);
      animation: pv-glass-in 720ms ${SETTLE} both;
    }
    .dark body:has(.pv-glass) [data-mobile-tab-bar] > nav {
      border-color: rgb(255 255 255 / 0.16);
      background: linear-gradient(150deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.04));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 18px 36px -14px rgb(0 0 0 / 0.7);
    }
    /* Idle tabs are bare icons and labels on the bar (Ghulam, Nov 2026: no
       capsule around any of them, the active one included). The tab you are
       on is marked by its accent colour and bolder icon alone, as in the
       Standard look. */
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > * {
      border-radius: 999px;
      border: 1px solid transparent;
      transition: transform 420ms ${SPRING}, background-color 240ms ease-out, box-shadow 240ms ease-out;
    }
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > * svg { width: 18px; height: 18px; }
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > *:active { transform: scale(0.92); }
    /* The centre action: a true circle, a bead of accent glass. */
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > a > span.bg-primary {
      /* Locked to a square so it is a true circle: the tab is a flex column
         that would otherwise squeeze its height. */
      flex: none;
      width: 30px;
      min-width: 30px;
      height: 30px;
      min-height: 30px;
      aspect-ratio: 1 / 1;
      margin-top: 0;
      border-radius: 50%;
      background-image: linear-gradient(180deg, rgb(255 255 255 / 0.32), rgb(255 255 255 / 0) 55%);
      box-shadow:
        inset 0 1.5px 0 rgb(255 255 255 / 0.55),
        inset 0 -3px 6px rgb(46 42 143 / 0.5),
        0 0 0 1px rgb(255 255 255 / 0.6),
        0 8px 16px -6px rgb(79 68 216 / 0.7);
    }
  }
  @media (max-width: 767px) and (prefers-reduced-motion: reduce) {
    body:has(.pv-glass) [data-mobile-tab-bar] > nav { animation: none; }
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > * { transition: none; }
    body:has(.pv-glass) [data-mobile-tab-bar] > nav > *:active { transform: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    ${PANE}, ${FRAME} [data-slot="sidebar-inner"] { animation: none; transition: none; }
    .pv.pv-glass .rounded-2xl[class~="bg-[var(--pv-paper)]"]:hover,
    .pv.pv-glass [data-pv-pane]:hover,
    .pv.pv-glass button:active,
    ${FRAME} [data-slot="sidebar-menu-button"]:active,
    ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"]:hover,
    ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):hover,
    ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):active { transform: none; }
  }
`;

/**
 * The light that follows the pointer across a pane: writes the pointer's
 * position inside whichever pane it is over to `--gx` / `--gy`, which the
 * pane's top background layer is centred on. One listener for the page, one
 * write per frame. Does nothing while `enabled` is false or on touch.
 */
export function useGlassPointerLight(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let last: PointerEvent | null = null;

    const paint = () => {
      frame = 0;
      const event = last;
      if (!event || !(event.target instanceof Element)) return;
      const pane = event.target.closest<HTMLElement>(LIT_SELECTOR);
      if (!pane) return;
      const box = pane.getBoundingClientRect();
      pane.style.setProperty('--gx', `${event.clientX - box.left}px`);
      pane.style.setProperty('--gy', `${event.clientY - box.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      last = event;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
