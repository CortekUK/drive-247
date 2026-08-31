import { STATS } from "@/lib/fixtures/landing";

export function StatsStrip() {
  return (
    <section className="bg-brand-stats-bg text-white">
      <div className="container-page grid grid-cols-1 py-2 sm:grid-cols-4 sm:py-12">
        {STATS.map((stat, index) => (
          <div
            key={stat.id}
            className={`relative flex flex-col items-center justify-center gap-1 px-6 py-3 text-center sm:py-0 ${
              index === 0
                ? ""
                : "before:absolute before:left-1/2 before:top-0 before:h-px before:w-[60%] before:-translate-x-1/2 before:bg-brand-amber/35 sm:before:left-0 sm:before:top-1/2 sm:before:h-[60%] sm:before:w-px sm:before:translate-x-0 sm:before:-translate-y-1/2"
            }`}
          >
            <p className="font-sans text-4xl font-semibold leading-none tracking-tight text-white sm:text-5xl">
              {stat.value}
            </p>
            <p className="text-sm leading-snug text-white/70">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
