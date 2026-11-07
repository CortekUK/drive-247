import type { ReactNode } from "react";

import "./section-heading.css";

/*
 * The one main heading for every landing-page section (Ghulam, 2026-11-07), in the style of
 * "Know your numbers": one line at medium weight, its <Accent> words in the solid brand
 * colour, and a plain muted `sub` underneath. Change it here and every section follows.
 * Centred by default, in three quarters of the section's width (Ghulam, 2026-11-07); `align="left"`
 * lines it up with the section's content instead. `label` adds an optional pill above.
 *
 *   <SectionHeading
 *     id="calendar-heading"
 *     title={<>Run every rental from <Accent>one calendar.</Accent></>}
 *     sub="Your whole fleet on one timeline…"
 *   />
 *
 * The section keeps `aria-labelledby` pointing at `id`.
 */

/** The title's key words, in the brand colour. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="sh-accent">{children}</span>;
}

export function SectionHeading({
  id,
  label,
  title,
  sub,
  align = "center",
  titleClassName,
  subClassName,
}: {
  id?: string;
  label?: string;
  title: ReactNode;
  sub?: ReactNode;
  align?: "center" | "left";
  /** Extra classes, for a section whose script measures its own heading. */
  titleClassName?: string;
  subClassName?: string;
}) {
  return (
    <div className={align === "left" ? "sh sh-left" : "sh"}>
      {label && <p className="sh-label">{label}</p>}
      <h2 id={id} className={titleClassName ? `sh-title ${titleClassName}` : "sh-title"}>
        {title}
      </h2>
      {sub && <p className={subClassName ? `sh-sub ${subClassName}` : "sh-sub"}>{sub}</p>}
    </div>
  );
}
