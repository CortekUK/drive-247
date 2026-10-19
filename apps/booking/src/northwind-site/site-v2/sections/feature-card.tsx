import type { LucideIcon } from "lucide-react-nw";
import { ShieldCheck } from "lucide-react-nw";
import Image from "next/image";

import { cn } from "@nw/lib/utils";
import { Editable, cmsImage } from "@nw/lib/cms/editable";
import { CARD, ICON_TILE } from "@nw/site-v2/kit";

type FeatureCardProps = {
  title: string;
  description: string;
  /** CMS address of this card's copy, e.g. `about.why_choose_us.items.2`. */
  cmsPath?: string;
  icon?: LucideIcon;
  variant?: "feature" | "small" | "muted";
  imageSrc?: string;
  imageAlt?: string;
  /** CMS address of `imageSrc`, when the photo is the operator's. */
  imageCmsPath?: string;
  className?: string;
};

/**
 * v2 of `components/cards/feature-card.tsx` — same props, same CMS marks.
 *
 * The three variants keep their jobs (the tall photo card, the small icon
 * card, the quieter closing card) but all three are now the flat v2 card: a
 * 1px border, 16px radius, no gold slab and no drawn shield.
 */
export function FeatureCard({
  title,
  description,
  cmsPath,
  icon: Icon,
  variant = "small",
  imageSrc,
  imageAlt = "",
  imageCmsPath,
  className,
}: FeatureCardProps) {
  const t = cmsPath ? <Editable path={`${cmsPath}.title`}>{title}</Editable> : title;
  const d = cmsPath ? <Editable path={`${cmsPath}.description`}>{description}</Editable> : description;

  if (variant === "feature") {
    return (
      <article className={cn(CARD, "flex h-full flex-col p-5 md:p-6", className)}>
        <h3 className="text-[17px] font-semibold leading-snug text-pv-fg">{t}</h3>
        <p className="mt-1.5 max-w-[40ch] text-[14px] leading-relaxed text-pv-muted-fg">{d}</p>

        {imageSrc && (
          /* In normal flow, pinned to the bottom: long copy grows the card
             instead of being covered by the photo. */
          <div className="mt-auto pt-6">
            <div className="overflow-hidden rounded-xl bg-pv-muted">
              <Image
                {...(imageCmsPath ? cmsImage(imageCmsPath, imageSrc) : {})}
                src={imageSrc}
                alt={imageAlt}
                width={2000}
                height={828}
                sizes="(min-width: 1024px) 40vw, 100vw"
                className="mx-auto h-auto max-h-[240px] w-full object-contain p-3"
              />
            </div>
          </div>
        )}
      </article>
    );
  }

  if (variant === "muted") {
    return (
      <article className={cn("flex h-full items-start gap-4 rounded-2xl border border-pv-border bg-pv-muted p-5 md:p-6", className)}>
        <span className={ICON_TILE}>
          <ShieldCheck aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-pv-fg">{t}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{d}</p>
        </div>
      </article>
    );
  }

  return (
    <article className={cn(CARD, "flex h-full flex-col p-5", className)}>
      {Icon && (
        <span className={ICON_TILE}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
      )}
      <h3 className={cn("text-[15px] font-semibold leading-snug text-pv-fg", Icon && "mt-3")}>{t}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{d}</p>
    </article>
  );
}
