"use client";

/**
 * Website Content — the v2 landing screen.
 *
 * Deliberately NOT a list of pages. The sidebar's Website view already renders
 * every page with its own live/off dot, so a list here would be the third copy
 * of the same navigation (v1 has a card grid here AND a rail AND a tab strip
 * inside each page).
 *
 * So this screen answers the one question the card grid never did: **is my
 * website actually saying what I think it says?** When nothing is wrong it is
 * nearly empty, which is the correct amount of screen for "everything is fine".
 *
 * The check it exists for: a page that is OFF the website but has content on
 * it. In v1 that is where every page lands the moment you type, because its
 * write path demotes the page on every save — and nothing on screen tells you.
 * Production is carrying several right now, one of them a live operator's About
 * page since July.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { useTenant } from "@/contexts/TenantContext";
import { getBookingBaseUrl } from "@/lib/booking-url";

/** Without these on the website, the booking flow has no policy to point at. */
const REQUIRED = ["privacy", "terms"];

export function CmsOverview() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { pages, isLoading } = useCMSPages();

  const { offline, required, lastEdited, total } = useMemo(() => {
    const rows = (pages ?? []).filter((p: any) => p.slug !== "blog");
    const off = rows.filter((p: any) => p.status !== "published");
    const edits = rows
      .map((p: any) => p.updated_at)
      .filter(Boolean)
      .sort()
      .reverse();
    return {
      offline: off,
      required: off.filter((p: any) => REQUIRED.includes(p.slug)),
      lastEdited: edits[0] as string | undefined,
      total: rows.length,
    };
  }, [pages]);

  const siteUrl = getBookingBaseUrl(tenant?.slug);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10 md:px-12">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-8 h-32 w-full rounded-4xl" />
      </div>
    );
  }

  const allLive = offline.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-10 md:px-12">
      <h1 className="font-heading text-[28px] font-medium leading-tight tracking-tight">
        Your website
      </h1>
      {siteUrl && (
        <a
          href={siteUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          {siteUrl.replace(/^https?:\/\//, "")}
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <div className="mt-9 space-y-3">
        {required.length > 0 && (
          <Notice
            tone="warning"
            title={`${required.map((r: any) => r.name).join(" and ")} ${
              required.length === 1 ? "is" : "are"
            } not on your website`}
            body="Customers have to be able to read these before they book — and your terms are attached to every rental agreement they sign."
            actionLabel={`Open ${required[0].name}`}
            onAction={() => router.push(`/cms/${required[0].slug}`)}
          />
        )}

        {offline.filter((p: any) => !REQUIRED.includes(p.slug)).map((p: any) => (
          <Notice
            key={p.id}
            tone="muted"
            title={`${p.name} is not on your website`}
            body="Visitors see a default page instead of yours."
            actionLabel={`Open ${p.name}`}
            onAction={() => router.push(`/cms/${p.slug}`)}
          />
        ))}

        {allLive && (
          <Notice
            tone="success"
            title={`All ${total} pages are on your website`}
            body={
              lastEdited
                ? `Last edited ${formatDistanceToNow(new Date(lastEdited), { addSuffix: true })}. Changes to a live page go live as you type.`
                : "Changes to a live page go live as you type."
            }
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-[12px] text-muted-foreground">
          Pick a page from the sidebar to edit it.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/cms/blog")}>
          Blog posts
        </Button>
      </div>
    </div>
  );
}

function Notice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: "warning" | "success" | "muted";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tones = {
    warning: "bg-warning-light/60 ring-warning/30",
    success: "bg-card shadow-md ring-foreground/5 dark:ring-foreground/10",
    muted: "bg-muted/40 ring-foreground/5",
  } as const;
  const dots = {
    warning: "bg-warning",
    success: "bg-success",
    muted: "border border-muted-foreground/40",
  } as const;

  return (
    <div className={cn("flex items-start gap-4 rounded-4xl px-5 py-4 ring-1", tones[tone])}>
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dots[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {actionLabel && onAction && (
        <Button variant="ghost" size="sm" onClick={onAction} className="shrink-0 text-muted-foreground">
          {actionLabel}
          <ArrowUpRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
