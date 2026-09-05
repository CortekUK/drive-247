import { ArrowRight, Check, Droplets, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";

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

/** The car this card is about, when the hero could resolve a real one. */
export type ReadinessVehicle = {
  id: string;
  name: string;
  categoryLabel: string | null;
};

/** The shipped Figma copy, used when the fleet is empty or unreachable. */
const PLACEHOLDER_NAME = "Lexus RX";
const PLACEHOLDER_CATEGORY = "SUV";

type ReadinessCardProps = {
  className?: string;
  /**
   * A real vehicle from the tenant's fleet, threaded down from `HeroSection`.
   *
   * This card had no vehicle in scope at all — it was a fixed "Lexus RX · SUV"
   * illustration whose "View Details" was `href="#"`, a dead link on the home
   * page's most prominent card. It could not be given a working link without
   * knowing WHICH car it describes, and inventing a route (`/fleet/lexus-rx`,
   * say) would have been a 404: v2 has no per-model page, only
   * `/booking/<uuid>`. So the caller resolves one and passes it here.
   *
   * When it is null the card keeps the shipped copy and points at `/fleet`,
   * which is the honest destination for a card that is describing nothing in
   * particular — never a dead `#`.
   */
  vehicle?: ReadinessVehicle | null;
};

export function ReadinessCard({ className, vehicle = null }: ReadinessCardProps) {
  // "View Details" on a card describing a specific car must open THAT car.
  const href = vehicle === null ? "/fleet" : `/booking/${vehicle.id}`;
  const name = vehicle?.name ?? PLACEHOLDER_NAME;
  const category = vehicle?.categoryLabel ?? PLACEHOLDER_CATEGORY;

  return (
    <article
      className={
        "w-[270px] rounded-[16px] border border-white/50 bg-brand-card px-[21px] pb-[21px] pt-[25px] shadow-[0px_15px_22.5px_rgba(0,0,0,0.12)] backdrop-blur-[6px] " +
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
          aria-hidden
        >
          <path
            d="M14 14C19.1547 14 23.3334 11.3137 23.3334 8C23.3334 4.68629 19.1547 2 14 2C8.84536 2 4.66669 4.68629 4.66669 8C4.66669 11.3137 8.84536 14 14 14Z"
            stroke="#6A6C66"
          />
          <path d="M15.3333 4L10 11.3333H17.3333" stroke="#6A6C66" />
        </svg>
        <span className="inline-flex items-center gap-[2px] text-[9px] leading-[13.5px] text-brand-text-soft">
          <Check className="size-2.5" strokeWidth={2.5} />
          Ready for Pickup
        </span>
      </header>

      <p className="mt-4 text-[12px] leading-[16px] text-brand-text">
        {name} <span className="text-brand-text-subtle">• {category}</span>
      </p>

      <ul className="mt-4 flex flex-col gap-[14px] pb-1">
        {METRICS.map((metric) => (
          <li key={metric.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10px] leading-[15px] text-brand-text-soft">
                {metric.icon}
                {metric.label}
              </span>
              <span className="text-[10px] leading-[15px] text-black">
                {metric.value}
              </span>
            </div>
            <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-[#e1e3df]">
              <div
                className="h-full rounded-full bg-brand-progress-fill"
                style={{ width: `${metric.value}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/*
        `min-h-11` on the LINK, not on the row around it. It was on the row
        first and measured 16px tall in the browser: `items-center` stops the
        child stretching, and `h-full` against a parent that only has a
        MIN-height resolves to `auto`. The card is absolutely positioned inside
        the hero, so the extra height pushes nothing on the page.
      */}
      <div className="mt-2 flex border-t border-transparent pt-[9px]">
        <Link
          href={href}
          className="inline-flex min-h-11 flex-1 items-center gap-1 text-[10.5px] leading-[15.75px] text-brand-text-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/45"
        >
          View Details
          <ArrowRight aria-hidden className="size-3" strokeWidth={2} />
          <span className="sr-only"> for {name}</span>
        </Link>
      </div>
    </article>
  );
}
