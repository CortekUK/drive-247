import type { LucideIcon } from "lucide-react";

type StepCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function StepCard({ title, description, icon: Icon }: StepCardProps) {
  return (
    <article className="flex max-w-[180px] flex-col items-center gap-3 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-amber text-brand-text">
        <Icon className="size-6" />
      </span>
      <h3 className="text-base font-semibold text-brand-text">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </article>
  );
}
