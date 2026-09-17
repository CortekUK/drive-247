"use client";

/**
 * The building blocks of a v2 settings page (northwind only — see
 * `settings/page.tsx`, which renders these behind `useV2('chrome')`).
 *
 * Modelled on Stripe's settings detail pages: a breadcrumb back to the index,
 * one heading, then flat panels of rows — label and a line of help on the left,
 * the control on the right. No card-per-field, no decorative icons, one Save per
 * panel. A row is ~64px, so a page of related settings fits on one screen where
 * v1 gave every single field its own card.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsPageHeader({
  section,
  title,
  description,
  onBack,
  rootLabel = "Settings",
  tourAnchor,
}: {
  section: string;
  title: string;
  description?: ReactNode;
  /** Goes back to the index. A callback, not a link, so the page can stop an
   *  operator leaving with unsaved edits. */
  onBack: () => void;
  /** The breadcrumb's first crumb, for a page reached from somewhere else. */
  rootLabel?: string;
  tourAnchor?: string;
}) {
  return (
    <header className="space-y-1.5" data-tour={tourAnchor}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px]">
        <button
          type="button"
          onClick={onBack}
          className="font-medium text-primary hover:underline dark:text-indigo-300"
        >
          {rootLabel}
        </button>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="text-muted-foreground">{section}</span>
      </nav>
      <h1 className="text-2xl font-medium tracking-tight text-foreground">{title}</h1>
      {description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

/** A flat bordered panel of rows, with an optional title and a footer for Save. */
export function SettingsPanel({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || description) && (
        <div className="border-b px-5 py-3.5">
          {title && <h2 className="text-[15px] font-medium text-foreground">{title}</h2>}
          {description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="divide-y">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * One setting. The label column is capped so the control never drifts to the
 * far edge of a wide screen, and the whole row stacks on a phone.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  note,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  /** A warning or consequence that belongs to this row, shown under it. */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-5 py-4", className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="min-w-0 md:max-w-[460px]">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
              {label}
            </label>
          ) : (
            <p className="text-sm font-medium text-foreground">{label}</p>
          )}
          {description && (
            <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {children && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            {children}
          </div>
        )}
      </div>
      {note && <div className="mt-2 text-[13px] leading-snug">{note}</div>}
    </div>
  );
}

/** A labelled field for a small form laid out as a grid (e.g. a new promo code). */
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A unit or connecting word beside an input ("years", "hours before pickup"). */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}
