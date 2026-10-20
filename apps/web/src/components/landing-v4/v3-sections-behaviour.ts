/* eslint-disable */
// @ts-nocheck
/*
 * The old page's scripts for the sections v4 keeps exactly as they were
 * (FAQ, CTA), carried over from landing-v3/landing-v3-design.ts
 * near-verbatim. Changes:
 *   - reveal looks under .d3s (the restored sections' wrapper) instead of .after
 *   - the testimonials carousel is gone; that section (testimonials.tsx) now
 *     runs itself
 *   - returns a teardown, since this page is React-mounted rather than owning
 *     the whole document
 */

export function runV3Sections(): () => void {
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const off = [];
  const ac = new AbortController(), o = { signal: ac.signal };
  off.push(() => ac.abort());


  /* reveal */
  {
    const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    $$(".d3s .x-rv").forEach((el) => ro.observe(el));
    off.push(() => ro.disconnect());
  }

  /* faq — single-open accordion */
  {
    const items = $$(".y-qa");
    items.forEach((q) => $("button", q).addEventListener("click", () => { const on = q.classList.contains("on"); items.forEach((x) => x.classList.remove("on")); if (!on) q.classList.add("on"); }, o));
  }

  /* CTA — gentle pointer parallax on the photo (user-initiated) */
  {
    const cb = $(".y-cb"), img = cb && $(".bgimg", cb);
    if (cb && img && !reduce) {
      cb.addEventListener("pointermove", (e) => { const r = cb.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; img.style.transform = `scale(1.1) translate(${(-x * 18).toFixed(1)}px,${(-y * 12).toFixed(1)}px)`; }, o);
      cb.addEventListener("pointerleave", () => (img.style.transform = ""), o);
    }
  }

  return () => off.forEach((f) => f());
}
