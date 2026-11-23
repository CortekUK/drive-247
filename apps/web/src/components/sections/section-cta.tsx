import { ArrowRight } from "lucide-react";
import "./section-cta.css";

/*
 * The small call to action a section ends on (Ghulam, 2026-11-13: more CTAs down the page).
 * One look everywhere: a solid "Start free trial" pill that goes to #pricing, as the hero's
 * does. Demo calls are cancelled (2026-11-14), so there is no second "Book a demo" link.
 *
 * `primary` relabels it. `tone="dark"` for the dark sections; `align` for left-set copy.
 */
export function SectionCta({
  primary = "Start free trial",
  tone = "light",
  align = "center",
  className = "",
}: {
  primary?: string;
  tone?: "light" | "dark";
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={`scta is-${tone} is-${align} ${className}`.trim()}>
      <a href="#pricing" className="scta-solid">
        {primary}
        <ArrowRight strokeWidth={2} aria-hidden />
      </a>
    </div>
  );
}
