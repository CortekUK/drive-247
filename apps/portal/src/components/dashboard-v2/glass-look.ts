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
 *     search field) is reached through `html[data-portal-look="glass"]`, which
 *     GlassRoot (components/glass/glass-root.tsx) sets for the whole v2 portal,
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

const ROOT = 'html[data-portal-look="glass"]';
const FRAME = `${ROOT} .v2-theme [data-slot="sidebar-wrapper"]`;
const CARD = `${ROOT} .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"]`;
const FRAME_DARK = `${ROOT}.dark .v2-theme [data-slot="sidebar-wrapper"]`;
const PANE = `${CARD}, ${ROOT} .pv [data-pv-pane]`;

/** Everything the pointer light plays on (see `useGlassPointerLight`). */
const LIT_SELECTOR =
  '.pv .rounded-2xl[class~="bg-[var(--pv-paper)]"], .pv [data-pv-pane], .pv [data-feature-deck], [data-slot="sidebar-inner"]';

const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
const SETTLE = 'cubic-bezier(.2, .9, .25, 1.08)';

export const GLASS_PALETTE = `
  /* How bright the pointer light is on a pane. Registered so it can fade. */
  @property --gl { syntax: "<number>"; inherits: false; initial-value: 0; }

  /* ── The background ─────────────────────────────────────────────────
     The booking site's Template 2 scene (styles/site.css, .g2-scene), in the
     accent: its photograph (public/themes/glass/backdrop.webp, a copy of the
     template's backdrop), blurred a little as there, given the tenant's
     brand colour's hue by a "color" blend that keeps the photo's own light
     and shade, under the template's white wash at the top. It replaces the
     frame's fixed wash layer (.bg-app-gradient::before, styles/v2-theme.css)
     only while the Glass dashboard is on screen. */
  html[data-portal-look="glass"] .v2-theme .bg-app-gradient[data-slot="sidebar-wrapper"]::before {
    inset: -24px;
    background-color: color-mix(in oklab, hsl(var(--primary)) 12%, #ffffff);
    background-image:
      linear-gradient(180deg, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0) 40%, rgb(255 255 255 / 0) 80%, rgb(255 255 255 / 0.15)),
      linear-gradient(rgb(255 255 255 / 0.42), rgb(255 255 255 / 0.42)),
      linear-gradient(color-mix(in oklab, hsl(var(--primary)) 52%, rgb(206 206 224)), color-mix(in oklab, hsl(var(--primary)) 52%, rgb(206 206 224))),
      url("/themes/glass/backdrop.webp");
    background-blend-mode: normal, normal, color, normal;
    background-size: auto, auto, auto, cover;
    background-position: 0 0, 0 0, 0 0, center 60%;
    background-repeat: no-repeat;
    /* Clearly the accent, never loud: the photograph takes the accent's hue
       in full but from a pale, greyed step of the BRAND colour, and a veil of
       white (42%) lifts the whole room. */
    filter: blur(6px);
  }
  html[data-portal-look="glass"].dark .v2-theme .bg-app-gradient[data-slot="sidebar-wrapper"]::before {
    background-color: #0c0a1e;
    background-image:
      linear-gradient(rgb(12 10 30 / 0.66), rgb(12 10 30 / 0.66)),
      linear-gradient(color-mix(in oklab, hsl(var(--primary)) 75%, rgb(150 150 170)), color-mix(in oklab, hsl(var(--primary)) 75%, rgb(150 150 170))),
      url("/themes/glass/backdrop.webp");
    background-blend-mode: normal, color, normal;
    background-size: auto, auto, cover;
    background-position: 0 0, 0 0, center 60%;
  }

  /* ── The material ───────────────────────────────────────────────────── */
  ${ROOT} body {
    /* Template 2's pane (.g2 / .g2-glass in site.css) with the landing accent
       as its tint: frosted glass thin enough that the colour behind shows
       through, a bright rim, a tight contact shadow and a long soft one in a
       deep shade of the accent. */
    /* The tenant's brand colour (Settings → Branding), not a fixed purple: pick
       green there and the room, the glass tint and the shadows turn green. */
    --lg-accent: hsl(var(--primary));
    --lg-glass: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 3%, rgb(255 255 255 / 0.5)),
      color-mix(in oklab, var(--lg-accent) 4%, rgb(255 255 255 / 0.34)));
    --lg-rim: rgb(255 255 255 / 0.7);
    --lg-light: 255 255 255;
    --lg-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.95),
      inset 0 -1px 1px rgb(255 255 255 / 0.4),
      0 2px 6px -2px rgb(20 18 50 / 0.12),
      0 30px 60px -30px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.48));
    --lg-shadow-lift:
      inset 0 1px 0 rgb(255 255 255 / 1),
      inset 0 -1px 1px rgb(255 255 255 / 0.5),
      0 4px 10px -4px rgb(20 18 50 / 0.16),
      0 44px 70px -32px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.56));
    --lg-frost: blur(24px) saturate(140%);
  }
  ${ROOT}.dark body {
    --lg-glass: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 14%, rgb(26 28 46 / 0.62)),
      color-mix(in oklab, var(--lg-accent) 16%, rgb(26 28 46 / 0.44)));
    --lg-rim: rgb(255 255 255 / 0.16);
    --lg-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.2),
      0 2px 6px -2px rgb(0 0 0 / 0.3),
      0 30px 60px -30px rgb(0 0 0 / 0.7);
    --lg-shadow-lift:
      inset 0 1px 0 rgb(255 255 255 / 0.26),
      0 4px 10px -4px rgb(0 0 0 / 0.4),
      0 44px 70px -32px rgb(0 0 0 / 0.8);
    --lg-frost: blur(24px) saturate(140%);
  }

  html[data-portal-look="glass"] .pv {
    /* Inside a pane: rows, chips and hairlines go see-through too, so a card
       reads as one sheet of glass rather than white slabs on a frosted one. */
    --pv-paper: rgb(255 255 255 / 0.48);
    --pv-wash: rgb(255 255 255 / 0.48);
    --pv-line: color-mix(in srgb, hsl(var(--foreground)) 9%, transparent);
    /* Secondary ink a step darker: it sits on see-through glass now, not on a solid card. */
    --pv-ink-2: color-mix(in srgb, hsl(var(--foreground)) 82%, transparent);
    --pv-ink-3: color-mix(in srgb, hsl(var(--foreground)) 62%, transparent);
  }
  html[data-portal-look="glass"].dark .pv {
    --pv-paper: rgb(255 255 255 / 0.06);
    --pv-wash: rgb(255 255 255 / 0.07);
    --pv-line: rgb(255 255 255 / 0.1);
  }

  /* ── Panes: every dashboard card, and the revenue chart ─────────────── */
  ${PANE} {
    background:
      radial-gradient(34rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.3)), transparent 62%),
      var(--lg-glass);
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
  html[data-portal-look="glass"] .pv [data-pv-pane] { padding: 14px 20px; }

  /* The feature card (Turo Sync, Zoho Books…) is a pane too. Light mode only:
     the card keeps its own light surface in dark mode, because its art is one
     light image and its text is ink (feature-announcement-deck.tsx). */
  html[data-portal-look="glass"]:not(.dark) .pv [data-feature-deck] {
    background:
      radial-gradient(34rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.3)), transparent 62%),
      var(--lg-glass);
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border: 1px solid var(--lg-rim);
    border-radius: 28px;
    box-shadow: var(--lg-shadow);
    transition: transform 480ms ${SPRING}, box-shadow 320ms ease-out, --gl 320ms ease-out;
    animation: pv-glass-in 720ms ${SETTLE} 60ms both;
  }
  html[data-portal-look="glass"]:not(.dark) .pv [data-feature-deck]:hover {
    --gl: 1;
    transform: translateY(-3px);
    box-shadow: var(--lg-shadow-lift);
  }
  @media (prefers-reduced-motion: reduce) {
    html[data-portal-look="glass"]:not(.dark) .pv [data-feature-deck],
    html[data-portal-look="glass"]:not(.dark) .pv [data-feature-deck]:hover { animation: none; transition: none; transform: none; }
  }

  /* The Trax card's own accent wash (the absolutely placed gradient layer at
     the top of the card, admin-cards.tsx) is dropped, so it is as clear as the
     cards beside it. */
  html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"] > span[aria-hidden="true"].pointer-events-none.absolute.inset-0 {
    display: none;
  }

  /* Nothing of a card's own shows either. Requests paints the page wash on
     itself with an inline style, which a stylesheet rule only beats with
     !important. */
  html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"] {
    background: var(--lg-glass) !important;
  }
  html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"] [style*="radial-gradient"] {
    background: transparent !important;
  }

  /* A pane with a real lens on it (glass-refraction.ts marks it, Chromium
     only) is drawn clearer: the bending at its edges has to be seen, and a
     50% white frost would hide it. Other browsers keep the frost above. */
  [data-lg-refract] {
    --lg-glass: linear-gradient(150deg,
      color-mix(in oklab, hsl(var(--primary)) 2%, rgb(255 255 255 / 0.28)),
      color-mix(in oklab, hsl(var(--primary)) 3%, rgb(255 255 255 / 0.12)));
  }
  html[data-portal-look="glass"].dark [data-lg-refract] {
    --lg-glass: linear-gradient(150deg, rgb(26 28 46 / 0.4), rgb(26 28 46 / 0.22));
  }

  /* The pointer is on the glass: the light comes up and the pane lifts. */
  html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"]:hover,
  html[data-portal-look="glass"] .pv [data-pv-pane]:hover {
    --gl: 1;
    transform: translateY(-3px);
    box-shadow: var(--lg-shadow-lift);
  }
  /* Pressed: the glass gives a little, then springs back. */
  html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"]:active,
  html[data-portal-look="glass"] .pv [data-pv-pane]:active {
    transform: translateY(-1px) scale(0.992);
    transition-duration: 140ms, 140ms, 140ms;
  }

  /* Settling in: each pane rises, sharpens and lands with a slight overshoot,
     one after another across the page. */
  @keyframes pv-glass-in {
    from { opacity: 0; transform: translateY(18px) scale(0.965); filter: blur(10px); }
    60% { opacity: 1; filter: blur(0); }
  }
  html[data-portal-look="glass"] .pv section:nth-of-type(2) .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 90ms; }
  html[data-portal-look="glass"] .pv section:nth-of-type(2) :nth-child(2) > .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 160ms; }
  html[data-portal-look="glass"] .pv section:nth-of-type(2) :nth-child(3) > .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 230ms; }
  html[data-portal-look="glass"] .pv section:nth-of-type(n+3) .rounded-2xl[class~="bg-[var(--pv-paper)]"] { animation-delay: 300ms; }

  /* Even panes (Ghulam, Nov 2026): the three Operations cards share one fixed
     height, so the row reads as three matching sheets. The Trax card already
     shows only the points that fit its height; Requests and To do scroll past
     theirs. The Standard look keeps each card as tall as its content. */
  @media (min-width: 768px) {
    html[data-portal-look="glass"] .pv section[aria-label="Operations"] > .grid > * { height: 360px; }
    html[data-portal-look="glass"] .pv section[aria-label="Operations"] .self-start { align-self: stretch; }
    html[data-portal-look="glass"] .pv section[aria-label="Operations"] > .grid > * > * { min-height: 0; }
    /* The first row starts inside the page. In the Standard look it is pulled
       29px up under the top bar (-14px on the page, -15px on this band) to line
       its title up with the sidebar switch; the chart has no card there, so
       nothing shows. A pane has an edge, and the scrollport cut its rounded top
       corners off. The feature card's own 10px offset goes too, so both panes
       share a top edge. */
    html[data-portal-look="glass"] .pv [data-desk-band] { margin-top: 22px; }
    html[data-portal-look="glass"] .pv [data-desk-band] [class~="lg:mt-[10px]"] { margin-top: 0; }
    /* The row below sits one card-gap under this one, not 45 to 65px. */
    html[data-portal-look="glass"] .pv section[aria-label="Insights"] { margin-top: 20px; }
  }

  /* A to-do row is the card's own surface, not a chip: clear, so the pane
     shows through, and still washed on hover. */
  html[data-portal-look="glass"] .pv .rounded-lg[class~="bg-[var(--pv-paper)]"]:not(:hover) { background: transparent; }

  /* Fields and popovers inside a card: the template's well (.g2-well). */
  html[data-portal-look="glass"] .pv .rounded-xl[class~="bg-[var(--pv-paper)]"],
  html[data-portal-look="glass"] .pv .rounded-xl[class~="bg-[var(--pv-wash)]"] {
    background: rgb(255 255 255 / 0.48);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.85), inset 0 0 0 1px rgb(255 255 255 / 0.25);
  }
  html[data-portal-look="glass"].dark .pv .rounded-xl[class~="bg-[var(--pv-paper)]"],
  html[data-portal-look="glass"].dark .pv .rounded-xl[class~="bg-[var(--pv-wash)]"] {
    background: rgb(255 255 255 / 0.08);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
  }

  /* Buttons in a card press like glass too. */
  html[data-portal-look="glass"] .pv button { transition-timing-function: ${SPRING}; }
  html[data-portal-look="glass"] .pv button:active { transform: scale(0.96); }

  /* ── The sidebar: one floating pane, capsule rows ───────────────────── */
  @media (min-width: 768px) {
    ${FRAME} [data-slot="sidebar-container"] { padding: 10px 0 10px 10px; }
    ${FRAME} [data-slot="sidebar-inner"] {
      background:
        radial-gradient(26rem circle at var(--gx, 50%) var(--gy, 0%), rgb(var(--lg-light) / calc(var(--gl) * 0.3)), transparent 62%),
        var(--lg-glass);
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
  ${FRAME} [data-slot="sidebar-menu-button"]:hover { background-color: rgb(255 255 255 / 0.48); }
  ${FRAME} [data-slot="sidebar-menu-button"]:active { transform: scale(0.96); }
  ${FRAME} [data-slot="sidebar-menu-button"][data-active="true"] {
    background-color: rgb(255 255 255 / 0.8);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 1),
      0 1px 2px rgb(20 18 50 / 0.08),
      0 10px 22px -12px color-mix(in oklab, var(--lg-accent) 55%, transparent);
  }
  ${FRAME_DARK} [data-slot="sidebar-menu-button"]:hover { background-color: rgb(255 255 255 / 0.08); }
  ${FRAME_DARK} [data-slot="sidebar-menu-button"][data-active="true"] {
    background-color: rgb(255 255 255 / 0.14);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 10px 22px -12px rgb(0 0 0 / 0.6);
  }

  /* ── The top bar's search field: a glass capsule ────────────────────── */
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"] {
    background: var(--lg-glass);
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    /* A little more definition than a card gets (Ghulam, Nov 2026): a fine
       accent line around the capsule under the white rim, and a closer shadow. */
    border-color: var(--lg-rim);
    border-radius: 999px;
    box-shadow:
      var(--lg-shadow),
      0 0 0 1px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.19)),
      0 6px 16px -8px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.29));
    transition: transform 420ms ${SPRING}, box-shadow 300ms ease-out;
  }
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"]:hover { transform: scale(1.012); box-shadow: var(--lg-shadow-lift), 0 0 0 1px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.29)), 0 8px 20px -8px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.34)); }
  ${FRAME} [data-slot="sidebar-inset"] > header button[aria-label="Search"]:active { transform: scale(0.985); }

  /* ── The top bar's buttons (Help, messages, the bell): glass capsules ─ */
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto { gap: 8px; }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a) {
    background: var(--lg-glass);
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border: 1px solid var(--lg-rim);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.95),
      0 1px 3px -1px rgb(20 18 50 / 0.14),
      0 14px 26px -16px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.39));
    transition: transform 420ms ${SPRING}, box-shadow 300ms ease-out;
  }
  ${FRAME_DARK} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a) {
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 14px 26px -16px rgb(0 0 0 / 0.7);
  }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):hover { transform: translateY(-1px) scale(1.04); }
  ${FRAME} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a):active { transform: scale(0.94); }

  /* ── The phone tab bar: a floating glass capsule, as on iOS ───────────
     (shared/layout/mobile-tab-bar.tsx, reached from here, not edited.) The
     full-width strip with a top border becomes a capsule that floats clear of
     the screen edges, the page scrolling underneath it. Opaque and tinted
     with the accent so the labels stay readable over busy content. */
  @media (max-width: 767px) {
    html[data-portal-look="glass"] body [data-mobile-tab-bar] {
      background: transparent;
      border-top: 0;
      pointer-events: none;
      padding: 0 14px calc(env(safe-area-inset-bottom, 0px) + 10px);
    }
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav {
      pointer-events: auto;
      height: 58px;
      padding: 5px;
      gap: 3px;
      max-width: 400px;
      border-radius: 999px;
      border: 1px solid rgb(255 255 255 / 0.85);
      /* Opaque, tinted with the accent, so nothing behind shows through the labels. */
      background: linear-gradient(150deg,
        color-mix(in oklab, var(--lg-accent) 16%, rgb(246 246 252)),
        color-mix(in oklab, var(--lg-accent) 24%, rgb(232 232 246)));
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.95),
        0 1px 2px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.14)),
        0 18px 36px -14px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.36));
      animation: pv-glass-in 720ms ${SETTLE} both;
    }
    html[data-portal-look="glass"].dark body [data-mobile-tab-bar] > nav {
      border-color: rgb(255 255 255 / 0.16);
      background: linear-gradient(150deg,
        color-mix(in oklab, var(--lg-accent) 18%, rgb(28 29 48)),
        color-mix(in oklab, var(--lg-accent) 12%, rgb(18 19 34)));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 18px 36px -14px rgb(0 0 0 / 0.7);
    }
    /* Idle tabs are bare icons and labels on the bar (Ghulam, Nov 2026: no
       capsule around any of them, the active one included). The tab you are
       on is marked by its accent colour and bolder icon alone, as in the
       Standard look. */
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > * {
      border-radius: 999px;
      border: 1px solid transparent;
      transition: transform 420ms ${SPRING}, background-color 240ms ease-out, box-shadow 240ms ease-out;
    }
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > * svg { width: 18px; height: 18px; }
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > *:active { transform: scale(0.92); }
    /* The centre action: a true circle, a bead of accent glass. */
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > a > span.bg-primary {
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
        inset 0 -3px 6px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.36)),
        0 0 0 1px rgb(255 255 255 / 0.6),
        0 8px 16px -6px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.8));
    }
  }
  @media (max-width: 767px) and (prefers-reduced-motion: reduce) {
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav { animation: none; }
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > * { transition: none; }
    html[data-portal-look="glass"] body [data-mobile-tab-bar] > nav > *:active { transform: none; }
  }

  /* ══ EVERY OTHER PAGE ═══════════════════════════════════════════════════
     The rest of the portal is built from a handful of shared surfaces, so
     Glass restyles those rather than each page: a card (bg-card), a solid
     page surface (bg-background / bg-white), a field, and the layers that
     open over the page (dialogs, menus, popovers). Page content gets the
     frosted pane only; the real lens stays on the frame and the controls,
     where there are few of them (a table of thirty rows cannot each carry a
     filter). */
  ${ROOT} body {
    /* A pane over other content: frosted further, as the template's
       data-dense pane is, so text in a dialog never fights the page under it. */
    --lg-dense: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 3%, rgb(255 255 255 / 0.9)),
      color-mix(in oklab, var(--lg-accent) 5%, rgb(255 255 255 / 0.78)));
    --lg-well: rgb(255 255 255 / 0.48);
    --lg-well-rim: inset 0 1px 0 rgb(255 255 255 / 0.85), inset 0 0 0 1px rgb(255 255 255 / 0.25);
    /* The sheet a page's content sits on (see "The content sheet" below). */
    --lg-sheet: linear-gradient(160deg, rgb(255 255 255 / 0.46), rgb(255 255 255 / 0.3));
    /* A bar inside a card (a table's sticky header): light, but frosted, so
       rows passing under it do not show through as text. */
    --lg-bar: rgb(255 255 255 / 0.3);
  }
  ${ROOT}.dark body {
    --lg-dense: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 10%, rgb(24 26 44 / 0.92)),
      color-mix(in oklab, var(--lg-accent) 12%, rgb(24 26 44 / 0.82)));
    --lg-well: rgb(255 255 255 / 0.07);
    --lg-well-rim: inset 0 1px 0 rgb(255 255 255 / 0.12);
    --lg-sheet: linear-gradient(160deg, rgb(20 22 38 / 0.5), rgb(20 22 38 / 0.36));
    --lg-bar: rgb(255 255 255 / 0.06);
  }

  /* The content sheet. Many pages put text straight on the page (Settings is
     a list of links with no card at all), which over a photograph is hard to
     read. So the whole content column is one large frosted sheet, set in from
     the screen edge, and cards are panes lying on it. The dashboard is left
     out: its panes sit straight on the room, as approved. */
  @media (min-width: 768px) {
    ${ROOT} .v2-theme main[data-scrollport]:not(:has(.pv)) {
      /* Left margin keeps the sheet clear of the sidebar pane. */
      margin: 0 10px 10px 10px;
      padding-top: 18px;
      border-radius: 28px;
      border: 1px solid var(--lg-rim);
      background: var(--lg-sheet);
      -webkit-backdrop-filter: var(--lg-frost);
      backdrop-filter: var(--lg-frost);
      box-shadow: var(--lg-shadow);
    }
  }
  @media (max-width: 767px) {
    ${ROOT} .v2-theme main[data-scrollport]:not(:has(.pv)) {
      background: var(--lg-sheet);
      -webkit-backdrop-filter: var(--lg-frost);
      backdrop-filter: var(--lg-frost);
    }
  }

  /* A record page (a rental, a car) has a fixed dock at the bottom. A blur on
     the sheet would make the sheet the dock's containing block, so the dock
     would scroll away with the page. The sheet stays, without its blur. */
  ${ROOT} .v2-theme main[data-scrollport]:has([data-record-dock]) {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* The record dock, matched to the phone tab bar: an opaque capsule tinted
     with the accent, bare icons, the centre stage button a bead of accent. */
  ${ROOT} body [data-record-dock][data-record-dock] > nav[aria-label] {
    border: 1px solid rgb(255 255 255 / 0.85);
    background: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 16%, rgb(246 246 252)),
      color-mix(in oklab, var(--lg-accent) 24%, rgb(232 232 246)));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.95),
      0 1px 2px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.14)),
      0 18px 36px -14px color-mix(in oklab, var(--lg-accent) 24%, rgb(10 10 30 / 0.36));
  }
  ${ROOT}.dark body [data-record-dock][data-record-dock] > nav[aria-label] {
    border-color: rgb(255 255 255 / 0.16);
    background: linear-gradient(150deg,
      color-mix(in oklab, var(--lg-accent) 18%, rgb(28 29 48)),
      color-mix(in oklab, var(--lg-accent) 12%, rgb(18 19 34)));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 18px 36px -14px rgb(0 0 0 / 0.7);
  }
  /* Seven buttons at full size need 350px, wider than a 360 to 375 phone
     leaves, so the last one hit the edge. They shrink with the screen instead. */
  ${ROOT} body [data-record-dock][data-record-dock] > nav[aria-label] :is(a, button)[class]:not([class~="bg-primary"]) {
    width: clamp(34px, 10.4vw, 44px);
    height: clamp(34px, 10.4vw, 44px);
  }
  ${ROOT} body [data-record-dock][data-record-dock] > nav[aria-label] button[class~="bg-primary"] {
    width: clamp(42px, 11.6vw, 48px);
    height: clamp(42px, 11.6vw, 48px);
  }
  /* Its icon buttons carry active:bg-foreground/10, which the status chip
     rule below would otherwise paint as a grey disc. */
  ${ROOT} .v2-theme main [data-record-dock][data-record-dock] nav[aria-label] :is(a, button)[class]:not([class~="bg-primary"]) {
    background-color: transparent;
  }
  ${ROOT} .v2-theme main [data-record-dock][data-record-dock] nav[aria-label] :is(a, button)[class]:not([class~="bg-primary"]):active {
    background-color: color-mix(in oklab, var(--lg-accent) 14%, transparent);
  }

  /* Secondary text is written at part strength (muted/70, primary/60) for a
     white page; on glass it gets its full strength back. */
  ${ROOT} .v2-theme main [class*="text-muted-foreground/"] { color: hsl(var(--muted-foreground)); }
  ${ROOT} .v2-theme main [class*="text-primary/"] { color: hsl(var(--primary)); }

  /* A grid drawn with 1px gaps over a solid line colour (the availability
     calendar): the lines stay, the slab behind them goes. */
  ${ROOT} .v2-theme main .gap-px[class~="bg-border"] { background: color-mix(in srgb, hsl(var(--foreground)) 12%, transparent); }

  /* Cards. */
  ${ROOT} .v2-theme main :is([class~="bg-card"], [data-slot="card"]):not([data-glass-skip]) {
    background: var(--lg-glass);
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
    border-color: var(--lg-rim);
  }
  ${ROOT} .v2-theme main :is(:is(.rounded-lg, .rounded-xl, .rounded-2xl, .rounded-3xl)[class~="bg-card"], [data-slot="card"]):not([data-glass-skip]) {
    box-shadow: var(--lg-shadow);
  }
  /* A card inside a card is the same sheet, not a second one. */
  ${ROOT} .v2-theme main :is([class~="bg-card"], [data-slot="card"]) :is([class~="bg-card"], [data-slot="card"]) {
    background: var(--lg-well);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: var(--lg-well-rim);
  }

  /* Solid page surfaces inside the content: sticky headers, bars, panels. */
  ${ROOT} .v2-theme main :is([class~="bg-background"], [class~="bg-white"]):not([data-glass-skip]) {
    background: var(--lg-glass);
    -webkit-backdrop-filter: var(--lg-frost);
    backdrop-filter: var(--lg-frost);
  }
  ${ROOT} .v2-theme main :is([class~="bg-card"], [data-slot="card"]) :is([class~="bg-background"], [class~="bg-white"]) {
    background: var(--lg-bar);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }

  /* A table's header row paints its own solid band (white, or near-black in
     dark). On glass it is a light frosted bar instead. */
  ${ROOT} .v2-theme main :is(thead, thead tr) { background-color: transparent; }
  ${ROOT} .v2-theme main thead th {
    background-color: var(--lg-bar);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }

  /* Fields. */
  ${ROOT} .v2-theme :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]) {
    background: var(--lg-well);
    box-shadow: var(--lg-well-rim);
  }

  /* Layers that open over the page. They portal to <body>, outside <main>. */
  ${ROOT} .v2-theme :is(
    [data-slot="dialog-content"],
    [data-slot="alert-dialog-content"],
    [data-slot="sheet-content"],
    [data-slot="popover-content"],
    [data-slot="hover-card-content"],
    [data-slot="dropdown-menu-content"],
    [data-slot="dropdown-menu-sub-content"],
    [data-slot="select-content"]
  ) {
    background: var(--lg-dense);
    -webkit-backdrop-filter: blur(24px) saturate(140%);
    backdrop-filter: blur(24px) saturate(140%);
    border-color: var(--lg-rim);
    box-shadow: var(--lg-shadow);
  }

  /* Layers the portal builds itself, outside the v2 primitives: the search
     and notification panels and the older dialogs are a bg-card box portalled
     to <body> (so outside <main> and the sidebar), or carry role="dialog". */
  ${ROOT} .v2-theme [class~="bg-card"]:not(main *):not([data-slot="sidebar"] *),
  ${ROOT} .v2-theme :is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]):not([data-slot]) {
    background: var(--lg-dense);
    -webkit-backdrop-filter: blur(24px) saturate(140%);
    backdrop-filter: blur(24px) saturate(140%);
    border-color: var(--lg-rim);
  }
  /* A dialog or full-screen page painted with the app's own wash
     (.bg-app-gradient, styles/v2-theme.css) is a dense pane instead; its
     fixed wash layer is dropped. The frame itself keeps its photograph. */
  ${ROOT} .v2-theme .bg-app-gradient:not([data-slot="sidebar-wrapper"]) {
    background: var(--lg-dense);
    -webkit-backdrop-filter: blur(24px) saturate(140%);
    backdrop-filter: blur(24px) saturate(140%);
  }
  ${ROOT} .v2-theme .bg-app-gradient:not([data-slot="sidebar-wrapper"])::before { display: none; }

  /* A status chip is its colour at 10% with text in that colour, which reads
     on white and not over a photograph. On glass the chip is mostly white
     with a breath of its own colour, so the text keeps its contrast. */
  ${ROOT}:not(.dark) .v2-theme main .rounded-full[class*="bg-"][class*="/10"],
  ${ROOT}:not(.dark) .v2-theme main .rounded-full[class*="bg-"][class*="/15"] {
    background-color: color-mix(in srgb, currentColor 12%, rgb(255 255 255 / 0.86));
  }

  /* Amber text is under 3:1 even on white; over glass it is darkened a step. */
  ${ROOT}:not(.dark) .v2-theme main [class~="text-warning"] {
    color: color-mix(in srgb, hsl(var(--warning)) 62%, #1a1206);
  }
  /* A popover-coloured body inside a layer (the command palette's list) is
     the layer's own glass, not a second solid sheet on top of it. */
  ${ROOT} .v2-theme :is([role="dialog"], [class~="bg-card"]) [class~="bg-popover"] { background: transparent; }

  @media (prefers-reduced-motion: reduce) {
    ${PANE}, ${FRAME} [data-slot="sidebar-inner"] { animation: none; transition: none; }
    html[data-portal-look="glass"] .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"]:hover,
    html[data-portal-look="glass"] .pv [data-pv-pane]:hover,
    html[data-portal-look="glass"] .pv button:active,
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
