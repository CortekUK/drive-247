"use client";

/**
 * Website Content — the visual editor.
 *
 * The page the operator is editing is the page their customers see: the v2
 * website itself, embedded in an iframe with `?cms-edit=1`. There is no form.
 * Every piece of CMS-bound text on that page carries its own address (see
 * v2/apps/web/src/lib/cms/editable.tsx); the site makes those nodes editable
 * in place and posts each change here; this component writes it as a DRAFT
 * (`cms_page_sections.draft_content`, which the public site never reads) and
 * asks the iframe to re-render. Publish moves the drafts into the live content.
 *
 * Why an iframe and not the section components rendered here: the portal is
 * React 18 on Tailwind 3, the site is React 19 on Tailwind 4. A preview built
 * from shared components would be a second copy of the design that drifts
 * from the first; the iframe IS the site, so it cannot drift.
 *
 * The split of trust is deliberate and worth keeping: the site never writes,
 * has no session, and only speaks to a parent on a portal origin. Every write
 * happens here, on the side that already has an authenticated, tenant-scoped
 * session.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, SlidersHorizontal, Undo2, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { useTenant } from "@/contexts/TenantContext";
import { useCMSPage } from "@/hooks/use-cms-pages";
import { useCmsDraftWrite } from "@/hooks/use-cms-draft-write";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { getSiteV2BaseUrl } from "@/lib/site-v2-url";
import { useCmsOutline } from "@/stores/cms-outline-store";

/** Where each CMS page renders on the v2 site. `reviews` is /reviews here (v1 served it at /testimonials). */
export const SITE_V2_PATHS: Record<string, string> = {
  home: "/",
  about: "/about",
  fleet: "/fleet",
  reviews: "/reviews",
  promotions: "/promotions",
  contact: "/contact",
};

type SectionInfo = { id: string; label: string; top: number };

export function CmsVisualEditor({
  slug,
  onShowFields,
}: {
  slug: string;
  /** Escape hatch to the field editor — lists, images and anything not on the page. */
  onShowFields: () => void;
}) {
  const { tenant } = useTenant();
  const { data: page } = useCMSPage(slug);
  const { canEdit } = useManagerPermissions();
  const readOnly = !canEdit("cms");
  const { pendingSections, writeDraft, publish, isPublishing, discard, isDiscarding } =
    useCmsDraftWrite(slug);

  const frame = useRef<HTMLIFrameElement | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The page's outline is drawn by the SIDEBAR, nested under the page you are
  // editing, so it lives in a store rather than in this component's state —
  // see stores/cms-outline-store.ts.
  const { setSections, setActiveId, setDirtyIds, setPick, clear } = useCmsOutline();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(0);
  /**
   * The iframe loaded but never said hello. That is what the OLD site looks
   * like from here — it has no edit mode — so until the tenant's subdomain is
   * moved to the v2 site on Vercel, this is the state a production tenant
   * would sit in. Say so, and offer the field editor, rather than spinning.
   */
  const [stalled, setStalled] = useState(false);

  const siteBase = getSiteV2BaseUrl(tenant?.slug);
  const src = siteBase ? `${siteBase}${SITE_V2_PATHS[slug] ?? "/"}?cms-edit=1` : "";
  const siteOrigin = useMemo(() => (siteBase ? new URL(siteBase).origin : ""), [siteBase]);

  const post = useCallback(
    (message: unknown) => {
      if (siteOrigin) frame.current?.contentWindow?.postMessage(message, siteOrigin);
    },
    [siteOrigin]
  );

  // Re-render the iframe's server tree after a burst of edits settles — one
  // refresh per pause, not one per keystroke.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => post({ type: "cms:refresh" }), 500);
  }, [post]);

  const hello = useCallback(() => {
    // A viewer-only manager gets the preview but never the editable nodes.
    if (!readOnly) post({ type: "cms:hello" });
  }, [post, readOnly]);

  /**
   * Start counting only once the iframe has actually LOADED.
   *
   * Timing from mount instead counts the site's own load — which on a cold
   * Next dev server is a first compile of ten seconds or more — and declares a
   * perfectly healthy page un-editable before it has had a chance to say
   * hello. What this state is for is the OLD site, which loads promptly and
   * then never answers, so the clock belongs after the load event.
   */
  const startStallTimer = useCallback(() => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => setStalled(true), 6000);
  }, []);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (!siteOrigin || event.origin !== siteOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      switch (msg.type) {
        case "cms:embedded":
          hello();
          break;
        case "cms:ready":
          if (stallTimer.current) clearTimeout(stallTimer.current);
          setStalled(false);
          setReady(true);
          break;
        case "cms:sections":
          setSections(
            (Array.isArray(msg.items) ? msg.items : []).map((i: SectionInfo) => ({
              id: i.id,
              label: i.label,
            }))
          );
          break;
        case "cms:focused": {
          const [p, s] = String(msg.path ?? "").split(".");
          if (p && s) setActiveId(`${p}.${s}`);
          break;
        }
        case "cms:edit": {
          if (typeof msg.path !== "string") return;
          setSaving((n) => n + 1);
          try {
            await writeDraft({ path: msg.path, value: String(msg.value ?? "") });
            scheduleRefresh();
          } finally {
            setSaving((n) => n - 1);
          }
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [siteOrigin, hello, writeDraft, scheduleRefresh, setSections, setActiveId]);

  /**
   * Hand the sidebar the ability to jump to a section, and take the outline
   * down when this editor goes away — a stale list under a page nobody is
   * editing would scroll an iframe that no longer exists.
   */
  useEffect(() => {
    setPick((id: string) => {
      setActiveId(id);
      post({ type: "cms:scroll", id });
    });
    return () => clear();
  }, [setPick, setActiveId, post, clear]);

  /** Which sections carry an unpublished edit, for the sidebar's dots. */
  useEffect(() => {
    setDirtyIds(pendingSections.map((p: any) => `${p.page?.slug}.${p.section_key}`));
  }, [pendingSections, setDirtyIds]);

  const live = page?.status === "published";
  const pending = pendingSections.length;

  if (!src) {
    return (
      <div className="p-10 text-sm text-muted-foreground">No website address for this tenant.</div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-1rem)] min-h-[600px] flex-col">
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-[17px] font-medium leading-tight">
            {page?.name ?? slug}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-success" : "border border-muted-foreground/40"
              )}
            />
            {live ? "On your website" : "Not on your website"}
            {/* There is no Save button and there never will be — typing IS the
                save. So the save state has to be said out loud here, or the
                operator has no way to know their words are safe. */}
            {saving > 0 ? (
              <>
                <span className="mx-1">·</span>
                <Loader2 className="size-3 animate-spin" /> Saving…
              </>
            ) : pending > 0 ? (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium text-warning">
                  {pending} saved change{pending === 1 ? "" : "s"} not on the website yet
                </span>
              </>
            ) : ready ? (
              <>
                <span className="mx-1">·</span>
                {live ? "Everything here is published" : "Click any text to edit it"}
              </>
            ) : null}
          </p>
        </div>

        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onShowFields}>
          <SlidersHorizontal className="size-3.5" />
          Fields
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <a href={src.replace("?cms-edit=1", "")} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Open
          </a>
        </Button>
        {!readOnly && pending > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={isDiscarding || isPublishing}
            onClick={async () => {
              await discard();
              post({ type: "cms:refresh" });
            }}
          >
            <Undo2 className="size-3.5" />
            Discard
          </Button>
        )}
        {/* ALWAYS rendered, disabled when there is nothing to do.
            It used to appear only when something was pending, which meant the
            one control the whole screen is built around was missing from a
            clean page — and "where is the publish button?" is not a question a
            publish button should ever provoke. Disabled-and-present says
            "nothing to publish"; absent says "this app has no publish". */}
        {!readOnly && (
          <Button
            size="sm"
            disabled={isPublishing || isDiscarding || saving > 0 || (live && pending === 0)}
            onClick={async () => {
              await publish();
              post({ type: "cms:refresh" });
            }}
          >
            {isPublishing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <UploadCloud className="size-3.5" />
            )}
            {!live ? "Put it on the website" : pending > 0 ? "Publish changes" : "Published"}
          </Button>
        )}
      </div>

      {/* ── the page ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-muted/30">
          {!ready && !stalled && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading your website
            </div>
          )}
          {!ready && stalled && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-sm font-medium">This page can't be edited in place yet</p>
              <p className="max-w-md text-[13px] text-muted-foreground">
                Your website is still on the previous design, which has no in-page editing. You can
                edit every section with the field editor instead.
              </p>
              <Button size="sm" onClick={onShowFields}>
                <SlidersHorizontal className="size-3.5" />
                Edit with fields
              </Button>
            </div>
          )}
          <iframe
            ref={frame}
            src={src}
            title={`${page?.name ?? slug} — live preview`}
            onLoad={() => {
              hello();
              startStallTimer();
            }}
            className={cn("size-full border-0 bg-white transition-opacity", !ready && "opacity-0")}
          />
        </div>
      </div>
    </div>
  );
}
