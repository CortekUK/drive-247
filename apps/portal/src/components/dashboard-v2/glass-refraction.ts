'use client';

/**
 * Real refraction for the Glass look: the edges of a pane bend what is behind
 * them, as a thick sheet of glass does.
 *
 * The method is the one described in "Liquid Glass in the Browser: Refraction
 * with CSS and SVG" (kube.io/blog/liquid-glass-css-svg), written out here from
 * its description — no library:
 *
 *   1. THE GLASS. A pane is flat in the middle with a rounded BEZEL around its
 *      rim. The bezel's height follows a convex squircle,
 *      y = (1 - (1 - x)^4)^(1/4), x running 0 at the outer edge to 1 where the
 *      flat part starts.
 *   2. THE RAY. Light comes straight down. Where the bezel slopes, Snell's law
 *      (air 1.0, glass 1.5) turns the ray toward the thick part of the glass,
 *      and by the time it has crossed the glass it has moved sideways. That
 *      sideways distance, for 127 samples across the bezel, is the
 *      displacement profile. It depends only on distance from the edge.
 *   3. THE MAP. For every pixel of the element, the distance to its
 *      rounded-rectangle edge picks a magnitude from the profile, and the
 *      direction is straight in from the edge. That vector is written into an
 *      image: red = x, green = y, 128 = no movement.
 *   4. THE FILTER. An SVG filter loads that image (feImage) and moves the
 *      backdrop's pixels by it (feDisplacementMap, red → x, green → y), with a
 *      touch of blur and saturation, and a rim-light image blended on top. The
 *      element then uses it as `backdrop-filter: url(#…)`.
 *
 * CHROME ONLY. An SVG filter as a backdrop-filter is a Chromium feature; it is
 * not in the CSS spec, and Safari and Firefox ignore it. Everywhere else this
 * hook does nothing and the pane keeps the plain frosted blur from
 * glass-look.ts, which is the article's own advice for a fallback.
 *
 * A map is tied to its element's size and corner radius, so it is rebuilt when
 * either changes (ResizeObserver) and when a card appears late (the dashboard
 * loads its cards after their skeletons). Everything is removed on unmount or
 * when Glass is switched off.
 */

import { useEffect } from 'react';

/** Everything that gets a lens: the panes, then the capsule controls. */
const ROOT = 'html[data-portal-look="glass"]';
const TARGETS = [
  // The dashboard's own panes (few, and the look was approved with them).
  `${ROOT} .pv .rounded-2xl[class~="bg-[var(--pv-paper)]"]`,
  `${ROOT} .pv [data-pv-pane]`,
  `${ROOT}:not(.dark) .pv [data-feature-deck]`,
  // The frame and its controls, on every page.
  `${ROOT} [data-slot="sidebar-inner"]`,
  `${ROOT} [data-slot="sidebar-inset"] > header button[aria-label="Search"]`,
  `${ROOT} [data-slot="sidebar-inset"] > header .ml-auto :is(button, a)`,
  `${ROOT} [data-mobile-tab-bar] > nav`,
].join(', ');

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const HOST_ID = 'pv-glass-refraction';

const GLASS_INDEX = 1.5;
const SAMPLES = 127;
/** The bezel is as wide as the corner radius, within these bounds (px). */
const BEZEL_MIN = 10;
const BEZEL_MAX = 34;
/** Glass thickness at the top of the bezel, as a multiple of the bezel width. */
const THICKNESS = 2.1;
/** Where the rim light comes from: -60°, top right (and its mirror, bottom left). */
const LIGHT = { x: Math.cos((-60 * Math.PI) / 180), y: Math.sin((-60 * Math.PI) / 180) };
const RIM_WIDTH = 2.5;

/** The bezel's height, 0 at the outer edge to 1 where the flat pane begins. */
function bezelHeight(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return Math.pow(1 - Math.pow(1 - t, 4), 0.25);
}

/**
 * How far a ray has moved sideways after crossing the glass, for each of
 * SAMPLES positions across a bezel `bezel` px wide. Pixels, positive = inward.
 */
function displacementProfile(bezel: number): { offsets: Float32Array; max: number } {
  const thickness = bezel * THICKNESS;
  const offsets = new Float32Array(SAMPLES);
  const delta = 0.001;
  let max = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i + 0.5) / SAMPLES;
    const derivative = (bezelHeight(x + delta) - bezelHeight(x - delta)) / (2 * delta);
    // The surface's slope in real pixels, then the angle the ray meets it at.
    const incidence = Math.atan(derivative * (thickness / bezel));
    const refracted = Math.asin(Math.sin(incidence) / GLASS_INDEX);
    const offset = Math.tan(incidence - refracted) * bezelHeight(x) * thickness;
    offsets[i] = offset;
    if (offset > max) max = offset;
  }
  return { offsets, max };
}

interface Lens {
  filter: SVGFilterElement;
  width: number;
  height: number;
  radius: number;
}

/** Draw the displacement map and the rim light for one rounded rectangle. */
function buildImages(width: number, height: number, radius: number) {
  const bezel = Math.min(Math.max(radius, BEZEL_MIN), BEZEL_MAX, Math.min(width, height) / 2);
  const { offsets, max } = displacementProfile(bezel);

  const map = document.createElement('canvas');
  const light = document.createElement('canvas');
  map.width = light.width = width;
  map.height = light.height = height;
  const mapCtx = map.getContext('2d');
  const lightCtx = light.getContext('2d');
  if (!mapCtx || !lightCtx || max <= 0) return null;

  const mapData = mapCtx.createImageData(width, height);
  const lightData = lightCtx.createImageData(width, height);
  const m = mapData.data;
  const l = lightData.data;

  const cx = width / 2;
  const cy = height / 2;
  // The rectangle the corner circles' centres sit on.
  const bx = width / 2 - radius;
  const by = height / 2 - radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const qx = Math.abs(px) - bx;
      const qy = Math.abs(py) - by;

      // Distance in from the rounded edge, and the direction pointing OUT.
      let inside: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        inside = radius - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        inside = radius - qx;
        nx = Math.sign(px);
        ny = 0;
      } else {
        inside = radius - qy;
        nx = 0;
        ny = Math.sign(py);
      }

      let dx = 0;
      let dy = 0;
      if (inside >= 0 && inside < bezel) {
        const magnitude = offsets[Math.min(SAMPLES - 1, Math.floor((inside / bezel) * SAMPLES))] / max;
        // The glass shows what lies further IN: sample toward the centre.
        dx = -nx * magnitude;
        dy = -ny * magnitude;
      }
      m[i] = 128 + dx * 127;
      m[i + 1] = 128 + dy * 127;
      m[i + 2] = 128;
      m[i + 3] = 255;

      // Rim light: brightest where the edge faces the light (or faces away).
      if (inside >= 0 && inside < RIM_WIDTH) {
        const facing = Math.abs(nx * LIGHT.x + ny * LIGHT.y);
        const alpha = Math.pow(facing, 1.6) * (1 - inside / RIM_WIDTH);
        l[i] = l[i + 1] = l[i + 2] = 255;
        l[i + 3] = Math.round(alpha * 235);
      }
    }
  }
  mapCtx.putImageData(mapData, 0, 0);
  lightCtx.putImageData(lightData, 0, 0);
  // feDisplacementMap moves a pixel by scale × (channel − 0.5), so the full
  // displacement needs twice the largest offset.
  return { mapUrl: map.toDataURL(), lightUrl: light.toDataURL(), scale: max * 2 };
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function feImage(url: string, width: number, height: number, result: string) {
  const el = svgEl('feImage', { x: 0, y: 0, width, height, result, preserveAspectRatio: 'none' });
  el.setAttribute('href', url);
  el.setAttributeNS(XLINK_NS, 'xlink:href', url);
  return el;
}

/** Only Chromium renders an SVG filter as a backdrop-filter. */
function supportsSvgBackdrop(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return false;
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua);
  return chromium && CSS.supports('backdrop-filter', 'url(#x)');
}

export function useGlassRefraction(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !supportsSvgBackdrop()) return;

    const host = svgEl('svg', { id: HOST_ID, width: 0, height: 0, 'aria-hidden': 'true' });
    host.setAttribute('color-interpolation-filters', 'sRGB');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const defs = svgEl('defs', {});
    host.appendChild(defs);
    document.body.appendChild(host);

    const lenses = new Map<HTMLElement, Lens>();
    let serial = 0;
    let frame = 0;

    const fit = (el: HTMLElement) => {
      const width = Math.round(el.offsetWidth);
      const height = Math.round(el.offsetHeight);
      if (width < 24 || height < 24) return;
      const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, width / 2, height / 2);

      const current = lenses.get(el);
      if (current && current.width === width && current.height === height && current.radius === radius) return;

      const images = buildImages(width, height, radius);
      if (!images) return;

      const id = `pv-lens-${++serial}`;
      const filter = svgEl('filter', {
        id,
        x: 0,
        y: 0,
        width,
        height,
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
      });
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.append(
        // A light frost first, so what is bent is soft rather than pin-sharp.
        svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 1.6, result: 'frost' }),
        feImage(images.mapUrl, width, height, 'map'),
        svgEl('feDisplacementMap', {
          in: 'frost',
          in2: 'map',
          scale: images.scale.toFixed(2),
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result: 'bent',
        }),
        svgEl('feColorMatrix', { in: 'bent', type: 'saturate', values: 1.5, result: 'rich' }),
        feImage(images.lightUrl, width, height, 'rim'),
        svgEl('feBlend', { in: 'rim', in2: 'rich', mode: 'screen' })
      );
      defs.appendChild(filter);
      current?.filter.remove();

      lenses.set(el, { filter, width, height, radius });
      el.style.setProperty('backdrop-filter', `url(#${id})`);
      el.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
      el.setAttribute('data-lg-refract', '');
    };

    const release = (el: HTMLElement) => {
      lenses.get(el)?.filter.remove();
      lenses.delete(el);
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
      el.removeAttribute('data-lg-refract');
      resizes.unobserve(el);
    };

    const resizes = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.target as HTMLElement);
    });

    const scan = () => {
      frame = 0;
      const found = new Set(document.querySelectorAll<HTMLElement>(TARGETS));
      for (const el of found) {
        if (!lenses.has(el)) resizes.observe(el);
        fit(el);
      }
      for (const el of [...lenses.keys()]) {
        if (!found.has(el) || !el.isConnected) release(el);
      }
    };
    const queueScan = () => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    };

    // Cards arrive after their skeletons, and the theme can flip: look again
    // whenever the page's structure or the light/dark class changes.
    const mutations = new MutationObserver(queueScan);
    mutations.observe(document.body, { childList: true, subtree: true });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    queueScan();

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      for (const el of [...lenses.keys()]) release(el);
      host.remove();
    };
  }, [enabled]);
}
