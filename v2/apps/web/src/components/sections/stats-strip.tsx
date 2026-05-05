import { STATS } from "@/lib/fixtures/landing";

export function StatsStrip() {
  return (
    <section className="bg-[#0F1F1A] text-white">
      <div className="container-page grid grid-cols-2 gap-y-10 py-10 sm:grid-cols-4 sm:py-12">
        {STATS.map((stat, index) => (
          <div
            key={stat.id}
            className={`relative flex flex-col items-center justify-center gap-1.5 px-6 text-center ${
              index === 0
                ? ""
                : "sm:before:absolute sm:before:left-0 sm:before:top-1/2 sm:before:h-[60%] sm:before:w-px sm:before:-translate-y-1/2 sm:before:bg-[#f2c12c]/35"
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
