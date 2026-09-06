import { Quote } from "lucide-react";

import { Editable } from "@/lib/cms/editable";

type TestimonialCardProps = {
  quote: string;
  author: string;
  /**
   * The `testimonials` row this card is showing, when it is a REAL one.
   *
   * Undefined for the shipped example quotes (`DEFAULT_TESTIMONIALS`), which
   * are not rows at all — marking those would hand the portal an id to write
   * to that does not exist, and the operator would type into a card whose
   * words never save.
   *
   * These carry the `table:` prefix because a testimonial has no
   * `draft_content` to stage into: the edit is live the moment it is made,
   * exactly as it is on the portal's own Reviews screen.
   */
  rowId?: string;
};

export function TestimonialCard({ quote, author, rowId }: TestimonialCardProps) {
  return (
    <article className="flex flex-col gap-6 rounded-2xl bg-brand-pale-yellow p-8 text-brand-text">
      <Quote
        className="size-7 -scale-x-100 text-brand-text"
        strokeWidth={2.5}
        aria-hidden
      />
      <p className="text-base leading-relaxed text-brand-text/90">
        {rowId ? (
          <Editable path={`table:testimonials.${rowId}.review`}>{quote}</Editable>
        ) : (
          quote
        )}
      </p>
      <p className="text-sm text-brand-text/70">
        {rowId ? (
          <Editable path={`table:testimonials.${rowId}.author`}>{author}</Editable>
        ) : (
          author
        )}
      </p>
    </article>
  );
}
