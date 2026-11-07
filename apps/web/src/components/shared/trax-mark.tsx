import { Sparkles } from "lucide-react";
import "./trax-mark.css";

/*
 * Trax's mark, as the portal draws it (apps/portal/src/components/trax/trax-greeting.tsx,
 * TraxMark): an iridescent conic fill that turns slowly, the sparkle on top, and a soft
 * halo that breathes behind it when animated. One mark for the whole landing page: the
 * Trax section's panel, the Trax guide in the corner and the widget section all use this.
 */
export type TraxMarkSize = "xs" | "sm" | "md" | "lg";

export function TraxMark({ size, animated = false }: { size: TraxMarkSize; animated?: boolean }) {
  return (
    <span className={`tm-mark is-${size}`} data-animated={animated} aria-hidden>
      {animated && <i className="tm-mark-halo" />}
      <span className="tm-mark-clip">
        <i className="tm-mark-fill" />
      </span>
      <Sparkles strokeWidth={2} />
    </span>
  );
}
