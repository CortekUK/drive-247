import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

/**
 * The v2 CMS write path. Autosaving, and — unlike v1's — non-destructive.
 *
 * ── why this is not `use-cms-page-sections.ts` ────────────────────────────
 *
 * That hook is shared by all fourteen v1 editor routes and therefore by the
 * other 56 tenants. Two of its behaviours make it unusable here, and neither
 * can be changed in place without changing v1 for everyone (V2_PLAN §7):
 *
 * 1. **It toasts on every save.** Fine behind a Save button, unusable when the
 *    keystroke IS the save.
 *
 * 2. **It sets the page back to `status: "draft"` after every write** — and
 *    `usePageContent` in apps/booking filters `status = 'published'`. So in v1,
 *    editing one word takes the ENTIRE page off the live website until someone
 *    notices and clicks Publish. The visitor does not see the old copy; they
 *    see the platform's global fallback, or hardcoded defaults.
 *
 *    That is not theoretical. At the time of writing, production carries
 *    RevTek's About page — 7 sections of their own content — sitting in
 *    `draft` since 2026-07-21, invisible to their customers. Also Open Bay's
 *    and Paramount's blog pages.
 *
 *    This hook never touches `status`. A live page stays live while you type.
 *
 * ── what "saved" means here ───────────────────────────────────────────────
 *
 * `cms_page_sections` IS the live content — booking reads those rows directly
 * and filters only on the owning page's status. There is no draft storage
 * anywhere in the schema. So for a page that is on the site, a save is live
 * within one visitor page-load, and the UI says exactly that rather than
 * offering a Publish button that would be theatre.
 */

const SAVE_DEBOUNCE_MS = 700;

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useCmsSectionWrite(pageSlug: string) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const [saveState, setSaveState] = useState<SaveState>("idle");

  /** Pending content per section_key, flushed together on the debounce. */
  const pending = useRef<Record<string, Record<string, any>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cleared on unmount so a late flush cannot setState on a dead component. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Resolve the page row this tenant may write to.
   *
   * Duplicated from `use-cms-page-sections.ts` rather than shared, because
   * factoring it out would mean editing that file and every v1 route through
   * it. The guard it carries is load-bearing and must not be dropped:
   *
   * A slug can resolve to the tenant's own row AND to a shared global row
   * (`tenant_id IS NULL`) that every tenant without its own falls back to.
   * Writing to the global row would publish one operator's copy on other
   * operators' sites — and it is unpublishable from here anyway, because the
   * publish mutation filters on `tenant_id`, so it would match zero rows,
   * report success, and never go live. If only the global row exists, the
   * tenant gets its own, deliberately EMPTY (copying the global sections would
   * make Drive247's own phone number and address tenant-owned, and the
   * booking-side fallback chain prefers a tenant value over the real one).
   */
  const resolvePage = useCallback(async () => {
    let query = supabase
      .from("cms_pages")
      .select("id, tenant_id, name, description")
      .eq("slug", pageSlug);

    if (tenant?.id) {
      query = query
        .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
        .order("tenant_id", { ascending: false, nullsFirst: false });
    }

    const found = await query.limit(1).maybeSingle();
    if (found.error) throw found.error;

    if (tenant?.id && found.data && found.data.tenant_id === null) {
      const { data: created, error } = await supabase
        .from("cms_pages")
        .insert({
          slug: pageSlug,
          name: found.data.name ?? pageSlug,
          description: found.data.description ?? null,
          status: "draft",
          tenant_id: tenant.id,
        })
        .select("id, tenant_id")
        .single();

      if (!error && created) return created;

      // Lost a race with another tab, or RLS refused — take the tenant's row if
      // one now exists rather than falling back to writing the global.
      const { data: retry } = await supabase
        .from("cms_pages")
        .select("id, tenant_id")
        .eq("slug", pageSlug)
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle();
      if (retry) return retry;

      throw new Error(
        "This page could not be opened for your account. Please contact support."
      );
    }

    if (!found.data) throw new Error(`Page "${pageSlug}" not found`);
    return found.data;
  }, [pageSlug, tenant?.id]);

  const flush = useCallback(async () => {
    const batch = pending.current;
    pending.current = {};
    const keys = Object.keys(batch);
    if (keys.length === 0) return;

    try {
      const page = await resolvePage();

      const rows = keys.map((section_key) => ({
        page_id: page.id,
        section_key,
        content: batch[section_key],
        updated_at: new Date().toISOString(),
        tenant_id: tenant?.id || null,
      }));

      const { error } = await supabase
        .from("cms_page_sections")
        .upsert(rows, { onConflict: "page_id,section_key" });

      if (error) throw error;

      // `updated_at` only. Deliberately NOT `status` — see the header comment.
      await supabase
        .from("cms_pages")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", page.id);

      if (!alive.current) return;
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      logAction({
        action: "cms_section_updated",
        entityType: "cms_section",
        entityId: page.id,
        details: { pageSlug, sectionKeys: keys, count: keys.length },
      });
    } catch (err: any) {
      if (!alive.current) return;
      setSaveState("error");
      // An error DOES deserve a toast — it is the one case where silence would
      // leave the operator believing their site had changed when it had not.
      toast({
        title: "Not saved",
        description: err?.message || "Your last change could not be saved.",
        variant: "destructive",
      });
    }
  }, [resolvePage, tenant?.id, queryClient, pageSlug, logAction, toast]);

  /**
   * Queue a section's FULL content object.
   *
   * The caller passes the whole object, not a patch, and it must be built by
   * spreading what was already stored — several sections carry keys this editor
   * does not render (`home_hero.background_image`, and the legacy
   * `carousel_images` that booking still falls back to). Writing only the
   * rendered fields would silently delete them.
   */
  const queueSection = useCallback(
    (sectionKey: string, content: Record<string, any>) => {
      pending.current[sectionKey] = content;
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  /** Write anything outstanding right now — used when leaving the page. */
  const flushNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    return flush();
  }, [flush]);

  return { queueSection, flushNow, saveState };
}
