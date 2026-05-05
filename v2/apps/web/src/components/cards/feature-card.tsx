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
          "relative flex h-full min-h-[420px] flex-col overflow-hidden rounded-[18px] bg-[#E0AD17] p-7",
          className,
        )}
      >
        <div className="space-y-3">
          <h3 className="text-xl font-semibold leading-snug text-[#111210]">
            {title}
          </h3>
          <p className="max-w-[28ch] text-sm leading-relaxed text-[#111210]/90">
            {description}
          </p>
        </div>

        {imageSrc && (
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={856}
            height={260}
            priority={false}
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="pointer-events-none absolute bottom-2 left-2 h-auto w-[160%] max-w-none object-contain object-bottom"
          />
        )}
      </article>
    );
  }

  if (variant === "muted") {
    return (
      <article
        className={cn(
          "relative flex h-full min-h-[200px] overflow-hidden rounded-[18px] bg-[#E8E5DC] p-7",
          className,
        )}
      >
        <div className="relative z-10 max-w-[64%] space-y-2">
          <h3 className="text-base font-semibold leading-snug text-[#111210]">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-[#4a4b48]">
            {description}
          </p>
        </div>

        {imageSrc && (
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={516}
            height={577}
            sizes="120px"
            className="pointer-events-none absolute right-5 bottom-4 h-auto w-[110px] object-contain drop-shadow-[0_8px_16px_rgba(16,130,193,0.2)]"
          />
        )}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3 rounded-[14px] border border-[#ececec] bg-white p-6",
        className,
      )}
    >
      {Icon && (
        <Icon
          className="size-5 text-[#111210]"
          strokeWidth={1.6}
          aria-hidden
        />
      )}
      <h3 className="text-base font-semibold leading-snug text-[#111210]">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-[#4a4b48]">
        {description}
      </p>
    </article>
  );
}
