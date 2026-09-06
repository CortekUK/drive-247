"use client";

/**
 * Website settings — the settings whose ONLY effect is what a visitor sees.
 *
 * They used to live in Portal → Settings, next to tax rates, deposit rules and
 * Stripe keys. Nothing about "what my website's page title is" belongs in the
 * same screen as "how much deposit I take", and an operator looking for it
 * reasonably starts in the Website section, where every other decision about
 * their site is already made. So the controls move; the columns, the write
 * paths and the readers do not.
 *
 * ── what is NOT here, and why ─────────────────────────────────────────────
 *
 * Logo, dark logo, favicon, app name and the brand colours paint the PORTAL
 * chrome as well as the customer site — the sidebar, the login screen, invoice
 * PDFs, e-sign documents and transactional email all read `tenants.*` for them.
 * Moving those would take the portal's own appearance controls out of the
 * portal, so they stay in Settings → Branding.
 *
 * Phone, email, address, business hours, Google Maps and the social links are
 * deliberately left alone too. They exist TWICE — as `tenants` columns on the
 * Branding tab, and as CMS sections (`site-settings / contact` and
 * `site-settings / social`) right above this block. Which of the two wins is an
 * open product decision; collapsing them here would make that decision by
 * accident, in the dark, for a live tenant.
 *
 * ── the write paths are the existing ones ─────────────────────────────────
 *
 *   SEO + hero image →  `useTenantBranding().updateBranding`  (v1's own path)
 *   Blog on/off      →  `useRentalSettings().updateSettings`  (v1's own path)
 *   Theme + notice   →  `useWebsiteTenantSettings().save`     (see that hook)
 *
 * Two screens writing the same column through two mutations is how they end up
 * disagreeing, so nothing here opens a bespoke write. `updateBranding` toasts
 * on every success — which is why the text fields sit behind one Save for the
 * whole block rather than autosaving per keystroke the way the CMS sections
 * above do. That is the same trade `use-cms-section-write.ts` documents from
 * the other side: a hook that toasts is fine behind a button and unusable
 * without one.
 *
 * ── permissions ───────────────────────────────────────────────────────────
 *
 * Reaching this screen at all needs the `cms` grant (the Website view is behind
 * it in `app-sidebar-v2`). But these are SETTINGS, not content, so editing them
 * needs the matching settings grant on top — `settings.branding` for SEO and
 * appearance, `settings.rental` for the blog, `settings.general` for the
 * notice. A manager holding `cms` and nothing else sees every value, read-only.
 * The `cms` grant is never silently widened into a settings grant.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-v2/select";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useCMSMedia } from "@/hooks/use-cms-media";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  useWebsiteTenantSettings,
  type CustomerThemeMode,
} from "@/hooks/use-website-tenant-settings";

/* ── surfaces, matching `cms-page-editor.tsx` ────────────────────────────── */

const inputCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";
const areaCls =
  "flex w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-2 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

/** The text/image fields that are held locally until Save. */
interface Draft {
  meta_title: string;
  meta_description: string;
  og_image_url: string;
  ga_measurement_id: string;
  hero_background_url: string;
  maintenance_banner_message: string;
}

const EMPTY_DRAFT: Draft = {
  meta_title: "",
  meta_description: "",
  og_image_url: "",
  ga_measurement_id: "",
  hero_background_url: "",
  maintenance_banner_message: "",
};

/** Which columns each draft key belongs to — decides which mutation carries it. */
const BRANDING_KEYS = [
  "meta_title",
  "meta_description",
  "og_image_url",
  "ga_measurement_id",
  "hero_background_url",
] as const;

export function WebsiteSettings() {
  const { branding, updateBranding, isUpdating: isSavingBranding } = useTenantBranding();
  const { settings: rentalSettings, updateSettings: updateRentalSettings, isUpdating: isSavingRental } =
    useRentalSettings();
  const { values: siteValues, save: saveSiteValues, isSaving: isSavingSite } = useWebsiteTenantSettings();
  const { canEditSettings } = useManagerPermissions();

  const canEditSeo = canEditSettings("branding");
  const canEditBlog = canEditSettings("rental");
  const canEditNotice = canEditSettings("general");

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  /**
   * The server's version of the draft fields, in draft shape.
   *
   * Kept as one memo so the seeding effect below has a single, stable thing to
   * compare against and to copy from — and so `dirty` is a plain object compare
   * rather than eleven hand-written `!==` lines that rot the moment a field is
   * added (which is exactly what happened to `brandingFormDirty` in v1).
   */
  const persisted: Draft = useMemo(
    () => ({
      meta_title: branding?.meta_title ?? "",
      meta_description: branding?.meta_description ?? "",
      og_image_url: branding?.og_image_url ?? "",
      ga_measurement_id: branding?.ga_measurement_id ?? "",
      hero_background_url: branding?.hero_background_url ?? "",
      maintenance_banner_message: siteValues.maintenance_banner_message,
    }),
    [
      branding?.meta_title,
      branding?.meta_description,
      branding?.og_image_url,
      branding?.ga_measurement_id,
      branding?.hero_background_url,
      siteValues.maintenance_banner_message,
    ],
  );

  const dirty = useMemo(
    () => (Object.keys(persisted) as (keyof Draft)[]).some((k) => draft[k] !== persisted[k]),
    [draft, persisted],
  );

  /**
   * Seed the local draft from the server, and keep tracking it until touched.
   *
   * `useTenantBranding` serves `placeholderData` before its query resolves, and
   * the tenant row is refetched on every save, so `persisted` arrives in stages
   * — a one-shot seed would strand the form on whatever the first stage held.
   * Re-seeding unconditionally would instead throw away what is being typed the
   * moment any refetch lands: the classic autosave data-loss bug.
   *
   * The guard is "has the operator typed", NOT `dirty`. Guarding on `dirty`
   * looks equivalent and is not: the very first render is already dirty (an
   * empty draft against a populated server), so the effect would decline to
   * seed and the screen would open showing blank fields over real values with
   * an unprompted "Unsaved changes" bar. It did exactly that.
   */
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setDraft(persisted);
  }, [persisted]);

  const set = (key: keyof Draft, value: string) => {
    touched.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** Hand the form back to the server — after a save, and on Discard. */
  const release = () => {
    touched.current = false;
    setDraft(persisted);
  };

  const busy = isSavingBranding || isSavingSite;

  const handleSave = async () => {
    // One call per owning mutation, and only when that mutation's own fields
    // actually changed — so editing the visitor notice never issues a branding
    // write (and its toast), and vice versa.
    const brandingPatch: Record<string, string | null> = {};
    for (const key of BRANDING_KEYS) {
      if (draft[key] === persisted[key]) continue;
      brandingPatch[key] =
        key === "ga_measurement_id"
          ? draft.ga_measurement_id.trim().toUpperCase() || null
          : draft[key];
    }
    if (Object.keys(brandingPatch).length > 0) {
      // `updateBranding` is `mutateAsync`; it toasts on both outcomes, so a
      // rejection here needs catching rather than reporting a second time.
      try {
        await updateBranding(brandingPatch);
      } catch {
        return;
      }
    }

    if (draft.maintenance_banner_message !== persisted.maintenance_banner_message) {
      await saveSiteValues({
        maintenance_banner_message: draft.maintenance_banner_message,
      });
    }

    // Both writes refetch, so the draft goes back to tracking the server. Doing
    // this only on success is deliberate: a failed save must keep the operator's
    // text on screen rather than silently reverting it under the toast.
    touched.current = false;
  };

  /* ── theme, composed from the single enum, exactly as v1 does ──────────── */

  const themeMode = siteValues.customer_theme_mode;
  const themeToggleAllowed = themeMode === "dark" || themeMode === "light";
  const themeDefault: "light" | "dark" =
    themeMode === "light" || themeMode === "light_only" ? "light" : "dark";
  const setTheme = (allowToggle: boolean, def: "light" | "dark") =>
    void saveSiteValues({
      customer_theme_mode: (allowToggle ? def : `${def}_only`) as CustomerThemeMode,
    });

  const blogEnabled = (rentalSettings as unknown as { blog_enabled?: boolean })?.blog_enabled === true;

  return (
    <div className="mt-0">
      <Section
        title="Search &amp; sharing"
        blurb="How your website looks in Google results and when someone pastes a link."
        readOnly={!canEditSeo}
      >
        <Row label="Page title">
          <input
            className={inputCls}
            disabled={!canEditSeo}
            value={draft.meta_title}
            placeholder="Northwind Rentals — Car Hire in Denver"
            onChange={(e) => set("meta_title", e.target.value)}
          />
          <Hint>Shown in the browser tab and as the headline in search results.</Hint>
        </Row>

        <Row label="Description">
          <textarea
            rows={2}
            className={areaCls}
            disabled={!canEditSeo}
            value={draft.meta_description}
            placeholder="Rent a car in minutes. Free delivery across Denver."
            onChange={(e) => set("meta_description", e.target.value)}
          />
          <Hint>The grey line under your title in search results. Around 150 characters.</Hint>
        </Row>

        <Row label="Share image">
          <ImagePicker
            value={draft.og_image_url}
            readOnly={!canEditSeo}
            onChange={(v) => set("og_image_url", v)}
          />
          <Hint>Shown when your link is pasted into a message or a social post. 1200×630 works best.</Hint>
        </Row>

        <Row label="Google tag">
          <input
            className={inputCls}
            disabled={!canEditSeo}
            autoComplete="off"
            spellCheck={false}
            value={draft.ga_measurement_id}
            placeholder="G-XXXXXXXXXX"
            onChange={(e) => set("ga_measurement_id", e.target.value)}
          />
          <GaHint value={draft.ga_measurement_id} />
        </Row>
      </Section>

      <Section
        title="Appearance"
        blurb="Light or dark, and the image behind your hero. Your logo and brand colours stay in Settings → Branding, because they paint this portal too."
        readOnly={!canEditSeo}
      >
        <Row label="Theme switch">
          <div className="flex h-9 items-center">
            <Switch
              checked={themeToggleAllowed}
              disabled={!canEditSeo || isSavingSite}
              onCheckedChange={(checked) => setTheme(checked, themeDefault)}
            />
          </div>
          <Hint>
            Shows a light/dark control on your website. Turn it off to lock visitors to one theme.
          </Hint>
        </Row>

        <Row label={themeToggleAllowed ? "Starts on" : "Always shows"}>
          <Select
            value={themeDefault}
            disabled={!canEditSeo || isSavingSite}
            onValueChange={(v) => setTheme(themeToggleAllowed, v as "light" | "dark")}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
          <Hint>
            {themeMode === "light_only" && "Visitors always see the light theme — no switch is shown."}
            {themeMode === "dark_only" && "Visitors always see the dark theme — no switch is shown."}
            {themeMode === "light" && "New visitors start on light and can switch to dark."}
            {themeMode === "dark" && "New visitors start on dark and can switch to light."}
          </Hint>
        </Row>

        <Row label="Hero image">
          <ImagePicker
            value={draft.hero_background_url}
            readOnly={!canEditSeo}
            onChange={(v) => set("hero_background_url", v)}
          />
          <Hint>The picture behind the headline at the top of your home page.</Hint>
        </Row>
      </Section>

      <Section
        title="Blog"
        blurb="Whether the blog appears in your website's navigation."
        readOnly={!canEditBlog}
      >
        <Row label="Show blog">
          <div className="flex h-9 items-center">
            <Switch
              checked={blogEnabled}
              disabled={!canEditBlog || isSavingRental}
              onCheckedChange={(checked) => {
                // The same mutation the Website → Blog page's own switch uses,
                // so the two read from one React Query cache and cannot drift.
                void updateRentalSettings({ blog_enabled: checked } as never);
              }}
            />
          </div>
          <Hint>
            {blogEnabled
              ? "A Blog link is in your website's navigation and published posts are visible."
              : "The blog is hidden from visitors. Your posts are kept."}
          </Hint>
        </Row>
      </Section>

      <Section
        title="Visitor notice"
        blurb="A banner across the top of your website — for a closure, a delay, or anything a visitor should read before booking."
        readOnly={!canEditNotice}
      >
        <Row label="Show notice">
          <div className="flex h-9 items-center">
            <Switch
              checked={siteValues.maintenance_banner_enabled}
              disabled={!canEditNotice || isSavingSite}
              onCheckedChange={(checked) =>
                void saveSiteValues({ maintenance_banner_enabled: checked })
              }
            />
          </div>
          <Hint>Also appears at the top of this portal, so your team sees what visitors see.</Hint>
        </Row>

        <Row label="Message">
          <textarea
            rows={2}
            className={areaCls}
            disabled={!canEditNotice}
            value={draft.maintenance_banner_message}
            placeholder="We are closed for the public holiday. Bookings placed today are confirmed on Tuesday."
            onChange={(e) => set("maintenance_banner_message", e.target.value)}
          />
          <Hint>Left empty, a general maintenance message is shown instead.</Hint>
        </Row>
      </Section>

      {/* The one Save on the screen. Absent entirely until something changed, so
          it never sits there implying the page is unsaved. */}
      {dirty && (canEditSeo || canEditNotice) && (
        <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-end gap-3 rounded-4xl bg-card/95 p-2 shadow-md ring-1 ring-foreground/5 backdrop-blur">
          <p className="pl-3 text-[13px] text-muted-foreground">Unsaved changes</p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={release}>
            Discard
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void handleSave()}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Pieces — the same two-column grammar as the CMS sections above this block
 * ═════════════════════════════════════════════════════════════════════════ */

function Section({
  title,
  blurb,
  readOnly,
  children,
}: {
  title: string;
  blurb: string;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-foreground/[0.07] py-6">
      <div className="pl-[22px]">
        <h2 className="font-heading text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{blurb}</p>
        {readOnly && (
          <p className="mt-2 text-[12px] text-muted-foreground/70">
            View only — this needs the matching Settings permission.
          </p>
        )}
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

function Row({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "gap-6 py-2.5",
        wide ? "block" : "grid grid-cols-[152px_minmax(0,1fr)] items-start",
      )}
    >
      <label className={cn("block text-[13px] leading-snug text-muted-foreground", wide ? "mb-2" : "pt-2")}>
        {label}
      </label>
      <div className={cn("min-w-0", !wide && "max-w-md")}>{children}</div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[11px] text-muted-foreground/70">{children}</p>;
}

/**
 * The Google tag hint.
 *
 * Copied from the v1 settings page rather than simplified, because the accepted
 * formats have to match what the booking site actually loads: gtag.js serves
 * GA4 (`G-`) and Google tag (`GT-`) only, so a friendlier "looks fine" on a
 * `GTM-` container would promise analytics that never arrive.
 */
function GaHint({ value }: { value: string }) {
  const v = value.trim().toUpperCase();
  if (!v) {
    return (
      <Hint>
        Paste your GA4 Measurement ID (e.g. G-BQ0W52VG1R) to add analytics to your website. Leave
        blank to turn it off.
      </Hint>
    );
  }
  const valid = /^(G|GT)-[A-Z0-9]+$/.test(v);
  const message = valid
    ? "Looks good — your Google tag loads on your website once you save."
    : v.startsWith("GTM-")
      ? "That's a Google Tag Manager container. Enter your GA4 Measurement ID (G-XXXXXXXXXX) instead."
      : v.startsWith("UA-")
        ? "Universal Analytics has shut down. Enter your GA4 Measurement ID (G-XXXXXXXXXX)."
        : "That doesn't look like a GA4 Measurement ID. It should look like G-XXXXXXXXXX.";
  return (
    <p className={cn("mt-1.5 text-[11px]", valid ? "text-success" : "text-destructive")}>{message}</p>
  );
}

/** Same upload path and the same shape as the CMS editor's own image field. */
function ImagePicker({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const { uploadMediaAsync, isUploading } = useCMSMedia();
  const input = useRef<HTMLInputElement | null>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    const media = (await uploadMediaAsync({ file, folder: "cms" })) as { file_url?: string };
    if (media?.file_url) onChange(media.file_url);
  };

  return (
    <div className="flex items-center gap-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="size-9 shrink-0 rounded-2xl bg-muted object-cover ring-1 ring-foreground/5"
          />
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-[13px] text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{value.split("/").pop()}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
          {!readOnly && (
            <>
              <Button variant="ghost" size="xs" onClick={() => input.current?.click()}>
                Replace
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => onChange("")}
              >
                Remove
              </Button>
            </>
          )}
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={readOnly || isUploading}
          onClick={() => input.current?.click()}
        >
          {isUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add image
        </Button>
      )}
    </div>
  );
}
