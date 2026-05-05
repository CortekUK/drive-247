import { ArrowRight, Check, Droplets, Sparkles, Wrench } from "lucide-react";

type Metric = {
  id: string;
  label: string;
  value: number;
  icon: React.ReactNode;
};

const METRICS: Metric[] = [
  {
    id: "pristine",
    label: "Pristine",
    value: 90,
    icon: <Sparkles className="size-2.5" strokeWidth={2} />,
  },
  {
    id: "mechanical",
    label: "Mechanical Health",
    value: 97,
    icon: <Wrench className="size-2.5" strokeWidth={2} />,
  },
  {
    id: "hygiene",
    label: "Hygiene & Sanitization Score",
    value: 99,
    icon: <Droplets className="size-2.5" strokeWidth={2} />,
  },
];

type ReadinessCardProps = {
  className?: string;
};

export function ReadinessCard({ className }: ReadinessCardProps) {
  return (
    <article
      className={
        "w-[270px] rounded-[16px] border border-white/50 bg-[#fdfffc] px-[21px] pb-[21px] pt-[25px] shadow-[0px_15px_22.5px_rgba(0,0,0,0.12)] backdrop-blur-[6px] " +
        (className ?? "")
      }
    >
      <header className="flex w-full items-center justify-between">
        <svg
          width="28"
          height="16"
          viewBox="0 0 28 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Lexus"
        >
          <path
            d="M14 14C19.1547 14 23.3334 11.3137 23.3334 8C23.3334 4.68629 19.1547 2 14 2C8.84536 2 4.66669 4.68629 4.66669 8C4.66669 11.3137 8.84536 14 14 14Z"
            stroke="#6A6C66"
          />
          <path d="M15.3333 4L10 11.3333H17.3333" stroke="#6A6C66" />
        </svg>
        <span className="inline-flex items-center gap-[2px] text-[9px] leading-[13.5px] text-[#30312f]">
          <Check className="size-2.5" strokeWidth={2.5} />
          Ready for Pickup
        </span>
      </header>

      <p className="mt-4 text-[12px] leading-[16px] text-[#111210]">
        Lexus RX <span className="text-[#8a8c88]">• SUV</span>
      </p>

      <ul className="mt-4 flex flex-col gap-[14px] pb-1">
        {METRICS.map((metric) => (
          <li key={metric.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10px] leading-[15px] text-[#4a4b48]">
                {metric.icon}
                {metric.label}
              </span>
              <span className="text-[10px] leading-[15px] text-black">
                {metric.value}
              </span>
            </div>
            <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-[#e1e3df]">
              <div
                className="h-full rounded-full bg-[#14231b]"
                style={{ width: `${metric.value}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t border-transparent pt-[9px]">
        <a
          href="#"
          className="inline-flex items-center gap-1 text-[10.5px] leading-[15.75px] text-[#30312f] hover:underline"
        >
          View Details
          <ArrowRight className="size-3" strokeWidth={2} />
        </a>
      </div>
    </article>
  );
}
