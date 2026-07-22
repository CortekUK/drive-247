import { supabase } from "@/integrations/supabase/client";

/**
 * Single place that decides how a logo change lands on the `tenants` row.
 *
 * WHY THIS EXISTS
 * A tenant's logo is read from three different columns depending on the surface:
 *   - `logo_url`      — most places, and the fallback for everything below
 *   - `dark_logo_url` — the portal sidebar in dark mode, and (with NO theme
 *                       check) the public booking header and footer
 *   - `auth_logo_url` — the portal login page, which also branches its LAYOUT
 *                       on whether this is set
 * Tenant provisioning stamped all three with the same uploaded image, but every
 * update path wrote `logo_url` alone, so changing your logo left the other
 * surfaces rendering the original image forever. That is a stale column, not a
 * cache, which is why no amount of refreshing ever fixed it.
 *
 * THE RULES (kept here so the Branding tab, the CMS Site Settings editor and the
 * dashboard setup reminder cannot drift apart again):
 *   1. `dark_logo_url` is CLEARED, not copied. Every reader resolves it as
 *      `dark_logo_url || logo_url`, so NULL renders the identical image while
 *      leaving exactly one source of truth — nothing left to keep in sync.
 *   2. `auth_logo_url` IS copied, because the login page uses its presence as a
 *      layout switch; clearing it would silently restyle the first screen every
 *      staff member sees.
 *   3. A column holding a DELIBERATE custom asset is never touched. Several live
 *      tenants have real dark-mode logos; overwriting those would be a worse bug
 *      than the one being fixed. "Deliberate" == not empty and not equal to the
 *      previous `logo_url`.
 *   4. `favicon_url` is never touched — it is a separate asset with its own
 *      uploader.
 */
export interface TenantLogoColumns {
  logo_url?: string | null;
  dark_logo_url?: string | null;
  auth_logo_url?: string | null;
}

/**
 * Build the companion-column patch for a logo change.
 *
 * `current` MUST be the freshly-read row. Pass `null` when it could not be read:
 * the sync is then skipped entirely, because with no current values every column
 * looks "unset" and we would happily overwrite a custom dark logo on the
 * strength of a failed SELECT. Not syncing is recoverable; destroying a custom
 * asset is not.
 */
export function buildLogoCompanionPatch(
  current: TenantLogoColumns | null,
  nextLogoUrl: string | null,
  isExplicitlyProvided: (column: keyof TenantLogoColumns) => boolean = () => false
): Partial<Record<keyof TenantLogoColumns, string | null>> {
  const patch: Partial<Record<keyof TenantLogoColumns, string | null>> = {};
  if (!current) return patch;

  // Echoing the current logo back (a passthrough on an unrelated save) is not a
  // logo change and must not drag the companion columns along with it.
  if (nextLogoUrl === current.logo_url) return patch;

  const tracksLogo = (value: string | null | undefined) =>
    !value || value === current.logo_url;

  if (!isExplicitlyProvided("dark_logo_url") && tracksLogo(current.dark_logo_url)) {
    patch.dark_logo_url = null;
  }
  if (!isExplicitlyProvided("auth_logo_url") && tracksLogo(current.auth_logo_url)) {
    patch.auth_logo_url = nextLogoUrl;
  }
  return patch;
}

/**
 * Write a new logo to the tenants row, keeping the companion columns coherent.
 *
 * Used by surfaces that are NOT the branding mutation — currently the CMS Site
 * Settings logo editor, whose own store (cms_page_sections) is invisible to most
 * of the product. Writing through to `tenants` here is what makes "upload a logo
 * anywhere in the portal" actually change every surface.
 *
 * Never throws: the caller's primary save must not fail because this
 * best-effort mirror did. Returns why it failed so the caller can warn.
 */
export async function syncTenantLogoColumns(
  tenantId: string,
  nextLogoUrl: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data: current, error: readError } = await supabase
      .from("tenants")
      .select("logo_url, dark_logo_url, auth_logo_url")
      .eq("id", tenantId)
      .single();

    if (readError) return { ok: false, reason: readError.message };

    const patch: Record<string, string | null> = {
      logo_url: nextLogoUrl,
      ...buildLogoCompanionPatch(current as TenantLogoColumns, nextLogoUrl),
    };

    // .select() is load-bearing: PostgREST answers 204 for an UPDATE that
    // matched ZERO rows, so an RLS refusal (which filters rather than errors)
    // would otherwise look like success.
    const { data: updated, error: writeError } = await supabase
      .from("tenants")
      .update(patch)
      .eq("id", tenantId)
      .select("id");

    if (writeError) return { ok: false, reason: writeError.message };
    if (!updated || updated.length === 0) {
      return { ok: false, reason: "no permission to update this tenant" };
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
