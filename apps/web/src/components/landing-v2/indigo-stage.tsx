import type { ReactNode } from "react";

/*
 * The loud background: a full-bleed brand-indigo stage with white type and a
 * stack of slow, living layers behind the content.
 *
 *   1. the brand gradient (chart-3 → accent → chart-5), the dashboard's top card
 *   2. three soft colour blobs drifting on long, out-of-phase loops
 *   3. a slow conic sweep turning behind everything
 *   4. a perspective grid floor rolling toward the viewer (the grid is the
 *      calendar, ILLUSTRATION_GUIDE)
 *   5. a few glints that breathe in and out
 *
 * Everything animates with transform and opacity only, so it stays smooth.
 * Under reduced motion every layer holds still (landing-v2.css).
 */
export function IndigoStage({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`lv2-indigo ${className}`}>
      <div aria-hidden className="lv2-indigo-layers">
        <span className="lv2-blob lv2-blob-a" />
        <span className="lv2-blob lv2-blob-b" />
        <span className="lv2-blob lv2-blob-c" />
        <span className="lv2-sweep" />
        <span className="lv2-floor">
          <span className="lv2-floor-grid" />
        </span>
        {[
          ["12%", "18%", "0s"],
          ["78%", "12%", "1.2s"],
          ["64%", "70%", "2.1s"],
          ["24%", "82%", "0.6s"],
          ["90%", "48%", "1.7s"],
          ["44%", "30%", "2.6s"],
        ].map(([left, top, delay]) => (
          <span key={`${left}-${top}`} className="lv2-glint" style={{ left, top, animationDelay: delay }} />
        ))}
        <span className="lv2-vignette" />
      </div>
      {children}
    </section>
  );
}
