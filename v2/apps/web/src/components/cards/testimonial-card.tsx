import { Quote } from "lucide-react";

type TestimonialCardProps = {
  quote: string;
  author: string;
};

export function TestimonialCard({ quote, author }: TestimonialCardProps) {
  return (
    <article className="flex flex-col gap-6 rounded-2xl bg-brand-pale-yellow p-8 text-brand-text">
      <Quote
        className="size-7 -scale-x-100 text-brand-text"
        strokeWidth={2.5}
        aria-hidden
      />
      <p className="text-base leading-relaxed text-brand-text/90">{quote}</p>
      <p className="text-sm text-brand-text/70">{author}</p>
    </article>
  );
}
