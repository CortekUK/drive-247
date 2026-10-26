import { cn } from "@nw/lib/utils";
import { CountUp } from "@nw/site-v2/sections/count-up";
import type { SiteNumber } from "@nw/site-v2/sections/site-numbers";

/**
 * The operator's numbers on a tinted strip, each counting up as it scrolls in
 * (`CountUp`): home's "Why rent" section and the About page's story close
 * with it. Nothing at all when there are no numbers to show.
 */
export function NumbersStrip({ numbers, className }: { numbers: SiteNumber[]; className?: string }) {
  if (numbers.length === 0) return null;
  return (
    <dl
      data-reveal
      className={cn(
        "grid rounded-2xl bg-pv-tint px-2 py-2",
        className,
        numbers.length >= 4 ? "grid-cols-2 md:grid-cols-4" : numbers.length === 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {numbers.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "flex flex-col-reverse items-center px-3 py-6 text-center md:py-8",
            // Hairlines between the numbers: down the middle on a phone's
            // two-by-two, between every pair in a single row.
            index % 2 === 1 && "border-l border-pv-primary/15",
            index >= 2 && numbers.length >= 4 && "max-md:border-t max-md:border-pv-primary/15",
            index === 2 && "md:border-l md:border-pv-primary/15",
          )}
        >
          <dt className="mt-2 text-[13px] font-medium text-pv-muted-on-tint md:text-[14px]">{stat.label}</dt>
          <dd className="text-[38px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-pv-fg sm:text-[46px] lg:text-[54px]">
            <CountUp to={stat.to} decimals={stat.decimals} prefix={stat.prefix} suffix={stat.suffix} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
