import type { LucideIcon } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

type FeatureCardProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  variant?: "feature" | "small" | "muted";
  imageSrc?: string;
  imageAlt?: string;
  className?: string;
};

export function FeatureCard({
  title,
  description,
  icon: Icon,
  variant = "small",
  imageSrc,
  imageAlt = "",
  className,
}: FeatureCardProps) {
  if (variant === "feature") {
    return (
      <article
        className={cn(
          "relative flex h-full min-h-[420px] flex-col overflow-hidden rounded-[18px] bg-brand-gold p-7",
          className,
        )}
      >
        <div className="space-y-3">
          <h3 className="text-xl font-semibold leading-snug text-brand-text">
            {title}
          </h3>
          <p className="max-w-[28ch] text-sm leading-relaxed text-brand-text/90">
            {description}
          </p>
        </div>

        {imageSrc && (
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={2000}
            height={828}
            priority={false}
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="pointer-events-none absolute bottom-2 right-2 h-auto w-[120%] max-w-none object-contain object-bottom"
          />
        )}
      </article>
    );
  }

  if (variant === "muted") {
    return (
      <article
        className={cn(
          "relative flex h-full min-h-[200px] overflow-hidden rounded-[18px] bg-brand-stone p-7",
          className,
        )}
      >
        <div className="relative z-10 max-w-[64%] space-y-2">
          <h3 className="text-base font-semibold leading-snug text-brand-text">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-brand-text-soft">
            {description}
          </p>
        </div>

        <ShieldMark className="pointer-events-none absolute bottom-4 right-5 h-auto w-[104px]" />
      </article>
    );
  }

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3 rounded-[14px] border border-brand-border-soft bg-white p-6",
        className,
      )}
    >
      {Icon && (
        <Icon
          className="size-5 text-brand-text"
          strokeWidth={1.6}
          aria-hidden
        />
      )}
      <h3 className="text-base font-semibold leading-snug text-brand-text">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-brand-text-soft">
        {description}
      </p>
    </article>
  );
}

/**
 * The muted card's shield.
 *
 * This replaces a 321 KB glossy-blue 3D shield PNG that was painting 104 CSS
 * pixels. Drawn inline instead: it is sharp at any device pixel ratio, costs
 * about a kilobyte, carries no third-party licence, and is in the brand palette
 * rather than the stock clipart's blue.
 */
function ShieldMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 108"
      className={className}
      role="img"
      aria-label="Protected"
    >
      <path
        d="M48 3 6 19v37c0 22.5 17.2 40.6 42 49 24.8-8.4 42-26.5 42-49V19L48 3Z"
        fill="var(--brand-forest)"
      />
      <path
        d="M48 13.5 15 26v30c0 17.9 13.4 32.6 33 39.7 19.6-7.1 33-21.8 33-39.7V26L48 13.5Z"
        fill="none"
        stroke="var(--brand-gold)"
        strokeWidth="2"
        strokeOpacity="0.55"
      />
      <path
        d="M32 55.5 43.5 67 66 44.5"
        fill="none"
        stroke="var(--brand-gold)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
