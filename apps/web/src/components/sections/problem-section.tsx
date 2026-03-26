"use client";

import {
  DollarSign,
  Palette,
  Users,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { PROBLEM_POINTS } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  DollarSign,
  Palette,
  Users,
  ShieldAlert,
  TrendingDown,
};

function ProblemCard({
  point,
  index,
  className,
  visible,
  delay,
}: {
  point: (typeof PROBLEM_POINTS)[number];
  index: number;
  className?: string;
  visible: boolean;
  delay: number;
}) {
  const Icon = iconMap[point.icon];

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.07] p-5 sm:p-6 lg:p-8 shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white/[0.09] ${className ?? ""}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: "opacity 600ms ease-out, transform 600ms ease-out, box-shadow 300ms, background-color 300ms",
        transitionDelay: visible ? `${delay}ms` : "0ms",
      }}
    >
      {/* Top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

      {/* Large number watermark */}
      <span className="pointer-events-none absolute -bottom-4 right-4 text-[56px] sm:text-[80px] font-extrabold leading-none tabular-nums text-indigo-400/[0.06] transition-colors duration-300 group-hover:text-indigo-400/[0.10]">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="relative">
        <div className="mb-4 sm:mb-6 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-400/[0.1]">
          {Icon && <Icon className="h-5 w-5 text-indigo-400" />}
        </div>

        <h3 className="text-[17px] font-semibold tracking-tight text-white">
          {point.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          {point.description}
        </p>
      </div>
    </div>
  );
}

export function ProblemSection() {
  const { ref, visible } = useFadeIn();

  return (
    <section className="bg-[#1c2039] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section label */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-white/10" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-300/70">
            The marketplace trade-off
          </p>
          <div className="h-px w-12 bg-white/10" />
        </div>

        <h2 className="mt-6 text-center text-3xl font-bold tracking-tighter text-white sm:text-4xl lg:text-[44px] lg:leading-tight">
          Marketplaces bring demand.
          <br />
          <span className="text-indigo-400">They also take control.</span>
        </h2>

        {/* Bento-style grid */}
        <div ref={ref} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Card 1 — 2 cols */}
          <ProblemCard
            point={PROBLEM_POINTS[0]}
            index={0}
            className="lg:col-span-2"
            visible={visible}
            delay={0}
          />
          {/* Card 2 — 2 cols */}
          <ProblemCard
            point={PROBLEM_POINTS[1]}
            index={1}
            className="lg:col-span-2"
            visible={visible}
            delay={100}
          />
          {/* Card 3 — 2 cols */}
          <ProblemCard
            point={PROBLEM_POINTS[2]}
            index={2}
            className="lg:col-span-2"
            visible={visible}
            delay={200}
          />
          {/* Card 4 — 3 cols (wider) */}
          <ProblemCard
            point={PROBLEM_POINTS[3]}
            index={3}
            className="lg:col-span-3"
            visible={visible}
            delay={300}
          />
          {/* Card 5 — 3 cols (wider) */}
          <ProblemCard
            point={PROBLEM_POINTS[4]}
            index={4}
            className="lg:col-span-3"
            visible={visible}
            delay={400}
          />
        </div>
      </div>
    </section>
  );
}
