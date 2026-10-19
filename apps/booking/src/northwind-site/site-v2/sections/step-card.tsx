import type { LucideIcon } from "lucide-react-nw";

import { Editable } from "@nw/lib/cms/editable";
import { CARD, ICON_TILE } from "@nw/site-v2/kit";

type StepCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** CMS address of this step, e.g. `promotions.how_it_works.steps.1`. */
  cmsPath?: string;
  /** 1-based position, shown as "Step N" beside the icon. Optional (v2 only). */
  step?: number;
};

/** v2 of `components/cards/step-card.tsx` — same props, same CMS marks. */
export function StepCard({ title, description, icon: Icon, cmsPath, step }: StepCardProps) {
  const t = cmsPath ? <Editable path={`${cmsPath}.title`}>{title}</Editable> : title;
  const d = cmsPath ? <Editable path={`${cmsPath}.description`}>{description}</Editable> : description;
  return (
    <article className={`${CARD} flex h-full flex-col px-5 py-5`}>
      <div className="flex items-center gap-2.5">
        <span className={ICON_TILE}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        {step != null ? <span className="text-xs font-medium text-pv-muted-fg">Step {step}</span> : null}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-pv-fg">{t}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{d}</p>
    </article>
  );
}
