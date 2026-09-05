import type { LucideIcon } from "lucide-react";
import { Editable, cmsSection } from "@/lib/cms/editable";

type StepCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** CMS address of this step, e.g. `promotions.how_it_works.steps.1`. */
  cmsPath?: string;
};

export function StepCard({ title, description, icon: Icon, cmsPath }: StepCardProps) {
  const t = cmsPath ? <Editable path={`${cmsPath}.title`}>{title}</Editable> : title;
  const d = cmsPath ? <Editable path={`${cmsPath}.description`}>{description}</Editable> : description;
  return (
    <article className="flex max-w-[180px] flex-col items-center gap-3 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-amber text-brand-text">
        <Icon className="size-6" />
      </span>
      <h3 className="text-base font-semibold text-brand-text">{t}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {d}
      </p>
    </article>
  );
}
