import { Star } from 'lucide-react-nw';

import { Editable } from '@nw/lib/cms/editable';
import { cn } from '@nw/lib/utils';
import { CARD } from '@nw/site-v2/kit';

type TestimonialCardProps = {
  quote: string;
  author: string;
  /** The `testimonials` row, when it is a real one — makes the words editable in place (see v1's card). */
  rowId?: string;
  /** 1–5; the rating row is left out when there is none. */
  stars?: number;
  /** Where the review came from ("Google", "Turo"…); the muted line under the name. */
  source?: string;
  className?: string;
};

/**
 * Northwind booking site v2 — one review as a flat card: rating, the quote,
 * then the name with a muted source line. Server-safe (no hooks), so both the
 * live two-up band and the server-rendered /reviews wall use it.
 */
export function TestimonialCard({ quote, author, rowId, stars, source, className }: TestimonialCardProps) {
  const rating = Math.max(0, Math.min(5, Math.round(stars ?? 0)));
  const meta = source?.trim() ?? '';

  return (
    <article className={cn(CARD, 'flex h-full flex-col gap-4 p-5 md:p-6', className)}>
      {rating > 0 ? <Stars value={rating} /> : null}
      <p className="flex-1 text-[15px] leading-relaxed text-pv-fg">
        {rowId ? <Editable path={`table:testimonials.${rowId}.review`}>{quote}</Editable> : quote}
      </p>
      <div className="flex items-center gap-3 border-t border-pv-border pt-4">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-pv-tint text-[13px] font-semibold text-pv-primary"
        >
          {initial(author)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-pv-fg">
            {rowId ? <Editable path={`table:testimonials.${rowId}.author`}>{author}</Editable> : author}
          </p>
          {meta ? <p className="truncate text-xs text-pv-muted-fg">{meta}</p> : null}
        </div>
      </div>
    </article>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <p className="flex items-center gap-0.5" aria-label={`Rated ${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden
          strokeWidth={1.75}
          className={cn('size-4', index < value ? 'fill-pv-warning text-pv-warning' : 'text-pv-border')}
        />
      ))}
    </p>
  );
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}
