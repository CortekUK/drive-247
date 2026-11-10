/**
 * The arrival cover: a plain screen over the portal while a brand-new operator
 * lands, so the dashboard never flashes up before the first-run questions.
 *
 * The page that signs them in sets a sessionStorage flag. An inline script in
 * the root layout (ARRIVAL_COVER_SCRIPT) reads it before React paints and puts
 * a class on <html>; CSS draws the cover from that class, just beneath the
 * questions screen (z-[70]). The questions screen lifts it the moment it is on
 * screen, or as soon as we know there are no questions to ask. A timer lifts it
 * regardless, so it can never strand anyone.
 */

export const ARRIVAL_FLAG = 'd247.firstrun.arriving';
export const ARRIVAL_CLASS = 'd247-arriving';

/** Inline, pre-paint. Plain ES5: it runs before any bundle. */
export const ARRIVAL_COVER_SCRIPT = `(function(){try{if(sessionStorage.getItem('${ARRIVAL_FLAG}')==='1'){document.documentElement.classList.add('${ARRIVAL_CLASS}');setTimeout(function(){document.documentElement.classList.remove('${ARRIVAL_CLASS}');sessionStorage.removeItem('${ARRIVAL_FLAG}')},10000)}}catch(e){}})();`;

/** Drawn under the questions screen (z-[70]) and over everything else. */
export const ARRIVAL_COVER_CSS = `html.${ARRIVAL_CLASS} body::after{content:'';position:fixed;inset:0;z-index:69;background:#ffffff;pointer-events:all}`;

export function markArriving(): void {
  try {
    window.sessionStorage.setItem(ARRIVAL_FLAG, '1');
  } catch {
    /* storage blocked: no cover, nothing breaks */
  }
}

export function liftArrivalCover(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove(ARRIVAL_CLASS);
  try {
    window.sessionStorage.removeItem(ARRIVAL_FLAG);
  } catch {
    /* ignore */
  }
}
