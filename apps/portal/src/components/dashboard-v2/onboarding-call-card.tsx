"use client";

/**
 * One step of the pre-call checklist (add a vehicle, upload a logo, preview
 * the website), drawn with the home's `.pv` palette. Used by the booked-call
 * dialog of the sidebar card (`onboarding/onboarding-call-sidebar.tsx`).
 *
 * The rest of this file (the older home card and its outside calendar) was
 * removed with feat-001: nothing mounted it any more.
 */

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChecklistLink({
  href,
  external,
  done,
  onOpen,
  children,
}: {
  href: string;
  external?: boolean;
  done: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const className = cn(
    "group flex h-full items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors",
    done
      ? "border-transparent bg-[var(--pv-clear-bg)] text-[var(--pv-ink-2)]"
      : "border-[var(--pv-line)] text-[var(--pv-ink)] hover:border-[var(--pv-accent-30)] hover:bg-[var(--pv-wash)]",
  );
  const mark = done ? (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--pv-clear)] text-white">
      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      <span className="sr-only">Done:</span>
    </span>
  ) : (
    <span className="size-[18px] shrink-0 rounded-full border border-dashed border-[var(--pv-line-2)]" aria-hidden="true" />
  );
  const arrow = external ? (
    <ExternalLink className="size-3.5 shrink-0 text-[var(--pv-ink-3)] group-hover:text-[var(--pv-accent-ink)]" aria-hidden="true" />
  ) : (
    <ArrowUpRight className="size-3.5 shrink-0 text-[var(--pv-ink-3)] group-hover:text-[var(--pv-accent-ink)]" aria-hidden="true" />
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={className}>
        {mark}
        {children}
        {arrow}
      </a>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
      className={className}
    >
      {mark}
      {children}
      {arrow}
    </a>
  );
}

