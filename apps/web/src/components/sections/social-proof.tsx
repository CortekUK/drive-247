"use client";

import { Star } from "lucide-react";
import { TESTIMONIALS } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star
          key={i}
          className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
        />
      ))}
    </div>
  );
}

function TestimonialCard({
  t,
  featured = false,
  visible,
  delay,
}: {
  t: (typeof TESTIMONIALS)[number];
  featured?: boolean;
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${featured ? "p-8 sm:p-10" : "p-6"}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition:
          "opacity 600ms ease-out, transform 600ms ease-out, box-shadow 300ms",
        transitionDelay: visible ? `${delay}ms` : "0ms",
      }}
    >
      {/* Top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

      <Stars count={t.stars} />

      <blockquote className={`mt-4 leading-relaxed text-muted-foreground ${featured ? "text-base sm:text-lg" : "text-sm"}`}>
        &ldquo;{t.before}<strong className="font-semibold text-foreground">{t.bold}</strong>{t.after}&rdquo;
      </blockquote>

      <div className="mt-6 flex items-center gap-3 border-t pt-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600/[0.08] text-xs font-bold text-indigo-600 dark:bg-indigo-400/[0.1] dark:text-indigo-400">
          {t.initials}
        </div>
        <div>
          <p className="text-sm font-semibold">{t.name}</p>
          <p className="text-xs text-muted-foreground">
            {t.role} &middot; {t.fleet}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SocialProof() {
  const { ref, visible } = useFadeIn();

  const [featured, ...rest] = TESTIMONIALS;

  return (
    <section className="bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Trusted by operators
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Operators building on{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            Drive247
          </span>
        </h2>

        <div ref={ref} className="mt-14 space-y-6">
          {/* Featured testimonial — full width */}
          <TestimonialCard
            t={featured}
            featured
            visible={visible}
            delay={0}
          />

          {/* Two smaller cards */}
          <div className="grid gap-6 sm:grid-cols-2">
            {rest.map((t, i) => (
              <TestimonialCard
                key={t.name}
                t={t}
                visible={visible}
                delay={(i + 1) * 100}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
