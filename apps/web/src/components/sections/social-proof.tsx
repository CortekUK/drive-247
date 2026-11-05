"use client";

import { Star, ArrowRight } from "lucide-react";
import type { Testimonial } from "@/lib/testimonials-server";
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
  t: Testimonial;
  featured?: boolean;
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-card ${featured ? "p-8 sm:p-10" : "p-6"} ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >

      <Stars count={t.stars} />

      <blockquote className={`mt-4 leading-relaxed text-muted-foreground ${featured ? "text-base sm:text-lg" : "text-sm"}`}>
        &ldquo;{t.before}<strong className="font-semibold text-foreground">{t.bold}</strong>{t.after}&rdquo;
      </blockquote>

      <div className="mt-6 flex items-center gap-3 border-t pt-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600/[0.08] text-sm font-bold text-indigo-600 dark:bg-indigo-400/[0.1] dark:text-indigo-400">
          {t.initials}
        </div>
        <div>
          <p className="text-sm font-semibold">{t.name}</p>
          <p className="text-xs text-muted-foreground">
            {[t.role, t.fleetSize, t.location].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SocialProof({ testimonials }: { testimonials: Testimonial[] }) {
  const { ref, visible } = useFadeIn();

  // Every quote unpublished in the admin: hide the section rather than show
  // an empty heading.
  if (testimonials.length === 0) return null;

  const [featured, ...rest] = testimonials;

  return (
    <section className="py-20 sm:py-24">
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

          {/* The rest, two-up */}
          {rest.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            {rest.map((t, i) => (
              <TestimonialCard
                key={t.id}
                t={t}
                visible={visible}
                delay={(i + 1) * 100}
              />
            ))}
          </div>
          )}
        </div>

        <div className="mt-10 text-center">
          <a
            href="/strategy-call"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            See how Drive247 works for your fleet
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
