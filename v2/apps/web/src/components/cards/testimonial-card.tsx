import { Quote } from "lucide-react";

type TestimonialCardProps = {
  quote: string;
  author: string;
};

export function TestimonialCard({ quote, author }: TestimonialCardProps) {
  return (
    <article className="flex flex-col gap-6 rounded-2xl bg-[#FBE99A] p-8 text-foreground">
      <Quote
        className="size-7 -scale-x-100 text-foreground"
        strokeWidth={2.5}
        aria-hidden
      />
      <p className="text-base leading-relaxed text-foreground/90">{quote}</p>
      <p className="text-sm text-foreground/70">{author}</p>
    </article>
  );
}
