"use client";

/**
 * Website Content — the v2 per-page editor.
 *
 * One renderer for every page, driven by `cms-spec.ts`. v1 spends fourteen
 * routes and thirty-seven editor components on this; the whole reason it reads
 * as noisy is that each of them re-invents a card, an icon, a header and a Save
 * button, four containers deep, around what is really a list of text fields.
 *
 * What is deliberately absent:
 *
 *   NO CARDS   a section is a heading and a hairline. The page has exactly one
 *              framed surface, and only when the page is off the site.
 *   NO TABS    `app-sidebar-v2` already carries the page list. A second nav
 *              inside the page would be 560px of chrome for nine pages.
 *   NO SAVE    the keystroke is the commit. v1 puts EIGHT save buttons on Home,
 *              one per section, with no shared dirty state.
 *   NO PUBLISH once the page is live. There is no draft storage in the schema —
 *              see below. A Publish button on a live page would be theatre.
 *
 * ── the state model, which is not v1's ────────────────────────────────────
 *
 * `cms_page_sections` IS the live content. booking reads those rows directly
 * and filters only on the owning page's `status`. So there are two states, not
 * three:
 *
 *   off the site   `status = 'draft'`. Visitors get the platform fallback.
 *                  Edits are private because nothing is being served.
 *   on the site    `status = 'published'`. Edits are live on the next page
 *                  load, and this screen says so instead of pretending
 *                  otherwise.
 *
 * v1 shows a Draft/Published badge that flips to "Draft" the moment you type —
 * because its write path demotes the page — which reads as "your changes are
 * pending" and actually means "your page is now off the internet". See
 * `use-cms-section-write.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award, Baby, Car, CarFront, Check, CheckCircle, ChevronRight, Clock, Crown,
  Droplets, Ellipsis, ExternalLink, FileCheck, Fuel, GlassWater, Headphones,
  Heart, History, ImageIcon, Loader2, Lock, MapPin, Phone, Plane, Plus,
  Receipt, Settings as SettingsIcon, Shield, Sparkles, Star, ThumbsUp, User,
  Users, Wifi, Wrench, X, Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSMedia } from "@/hooks/use-cms-media";
import { useCmsSectionWrite } from "@/hooks/use-cms-section-write";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useTenant } from "@/contexts/TenantContext";
import { getBookingBaseUrl } from "@/lib/booking-url";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import { CmsVisualEditor, SITE_V2_PATHS } from "./cms-visual-editor";
import {
  pageSpec,
  type FieldSpec,
  type SectionSpec,
  type SubFieldSpec,
} from "./cms-spec";

/* ══════════════════════════════════════════════════════════════════════════
 * Constants
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Where each CMS page actually lives on the customer site.
 *
 * Not derivable from the slug: the `reviews` page is served at `/testimonials`,
 * and `home` is the root. Getting this wrong sends the operator to a 404 from
 * the one link on the screen that is meant to prove their edit worked.
 */
const PAGE_PATHS: Record<string, string> = {
  home: "/",
  about: "/about",
  fleet: "/fleet",
  reviews: "/testimonials",
  promotions: "/promotions",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
};

/**
 * Only the icons the four vocabularies in `cms-spec` actually contain.
 *
 * Explicitly listed rather than `import * as Lucide` — a namespace import pulls
 * the entire icon library into the bundle to look up thirty names.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  thumbsup: ThumbsUp, users: Users, mappin: MapPin, baby: Baby,
  settings: SettingsIcon, headphones: Headphones, shield: Shield, car: Car,
  clock: Clock, phone: Phone, star: Star, award: Award, checkcircle: CheckCircle,
  fuel: Fuel, wifi: Wifi, crown: Crown, check: Check, lock: Lock, user: User,
  sparkles: Sparkles, plane: Plane, filecheck: FileCheck, wrench: Wrench,
  droplets: Droplets, glasswater: GlassWater, carfront: CarFront, receipt: Receipt,
  heart: Heart, zap: Zap,
};

const iconFor = (name?: string) => ICONS[String(name ?? "").toLowerCase()] ?? Shield;

/* ── surfaces, matching the canary's grammar ─────────────────────────────── */

const cardCls =
  "rounded-4xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";
const inputCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";
const areaCls =
  "flex w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-2 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

/* ══════════════════════════════════════════════════════════════════════════
 * Dotted-path access
 *
 * Some sections are stored nested — `contact_info.phone.number`,
 * `rental_rates.daily.title`. The editor reads and writes through the path so
 * the JSONB keeps exactly the shape booking already parses. Nothing is
 * flattened on disk; v1 and v2 write the same rows.
 * ═════════════════════════════════════════════════════════════════════════ */

function readPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Immutable set — clones only the spine, so React sees a new object. */
function writePath(obj: any, path: string, value: any): any {
  const [head, ...rest] = path.split(".");
  const base = obj && typeof obj === "object" ? obj : {};
  if (rest.length === 0) return { ...base, [head]: value };
  return { ...base, [head]: writePath(base[head], rest.join("."), value) };
}

const isBlank = (v: any) =>
  v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");

function hasContent(content: any, spec: SectionSpec) {
  return spec.fields.some((f) => !isBlank(readPath(content, f.key)));
}

/** The one line a collapsed section shows instead of its fields. */
function summarise(content: any, spec: SectionSpec): string {
  for (const f of spec.fields) {
    const v = readPath(content, f.key);
    if (isBlank(v)) continue;
    if (f.type === "list" || f.type === "lines") {
      const n = (v as any[]).length;
      return `${n} ${f.noun ?? "item"}${n === 1 ? "" : "s"}`;
    }
    if (f.type === "gallery") {
      const n = (v as any[]).length;
      return `${n} image${n === 1 ? "" : "s"}`;
    }
    if (f.type === "richtext") {
      const text = String(v).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return text.length > 64 ? `${text.slice(0, 64)}…` : text || "Written";
    }
    const text = String(v).replace(/\s+/g, " ").trim();
    return text.length > 64 ? `${text.slice(0, 64)}…` : text;
  }
  return "Not set";
}

/* ══════════════════════════════════════════════════════════════════════════
 * The screen
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Pages the v2 website actually renders. These get the visual editor — the
 * site in an iframe, edited in place. Privacy, Terms and Site settings have no
 * page on the site to click on, so they keep the field editor below.
 */
const VISUAL_PAGES = new Set(Object.keys(SITE_V2_PATHS));

export function CmsPageEditor({ slug }: { slug: string }) {
  const [mode, setMode] = useState<"visual" | "fields">(
    VISUAL_PAGES.has(slug) ? "visual" : "fields"
  );
  if (mode === "visual") {
    return <CmsVisualEditor slug={slug} onShowFields={() => setMode("fields")} />;
  }
  return <CmsFieldEditor slug={slug} onShowVisual={VISUAL_PAGES.has(slug) ? () => setMode("visual") : undefined} />;
}

function CmsFieldEditor({ slug, onShowVisual }: { slug: string; onShowVisual?: () => void }) {
  const spec = pageSpec(slug);
  const { tenant } = useTenant();
  const { data: page, isLoading } = useCMSPage(slug);
  const { publishPage, unpublishPage, isPublishing, isUnpublishing } = useCMSPages();
  const { queueSection, flushNow, saveState } = useCmsSectionWrite(slug);
  const { canEdit } = useManagerPermissions();
  const readOnly = !canEdit("cms");

  const [draft, setDraft] = useState<Record<string, any>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const seededFor = useRef<string | null>(null);

  /**
   * Seed the local draft from the server ONCE per page.
   *
   * Guarded on the page id rather than run on every `page` change: each save
   * invalidates `["cms-page", slug]`, so an unguarded effect would re-seed from
   * a refetch that is still in flight and throw away whatever was typed in the
   * meantime — the classic autosave data-loss bug.
   */
  useEffect(() => {
    if (!page?.id || seededFor.current === page.id) return;
    const next: Record<string, any> = {};
    for (const s of page.cms_page_sections ?? []) {
      next[s.section_key] = (s.content as any) ?? {};
    }
    setDraft(next);
    seededFor.current = page.id;
  }, [page]);

  /** Anything typed in the last debounce window still belongs to the operator. */
  useEffect(() => () => void flushNow(), [flushNow]);

  const setField = useCallback(
    (sectionKey: string, path: string, value: any) => {
      setDraft((all) => {
        const before = all[sectionKey] ?? {};
        let content = writePath(before, path, value);

        // The carousel back-compat dual. `carousel_media` is the real value;
        // `carousel_images` is a derived string[] that booking still falls back
        // to when the newer key is absent. v1 writes both, so v2 must too —
        // writing only the new one would leave a stale legacy list behind that
        // wins on any reader that has not been updated. Videos are dropped, as
        // in v1, because the legacy shape cannot express them.
        if (path === "carousel_media") {
          const media = Array.isArray(value) ? value : [];
          content = writePath(
            content,
            "carousel_images",
            media.filter((m: any) => m?.type !== "video").map((m: any) => m.url)
          );
        }

        queueSection(sectionKey, content);
        return { ...all, [sectionKey]: content };
      });
    },
    [queueSection]
  );

  const live = page?.status === "published";
  const siteUrl = useMemo(() => {
    const base = getBookingBaseUrl(tenant?.slug);
    const path = PAGE_PATHS[slug];
    return base && path ? `${base}${path}` : "";
  }, [tenant?.slug, slug]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-12">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-72" />
        <Skeleton className="mt-10 h-64 w-full rounded-4xl" />
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-12">
        <h1 className="font-heading text-2xl font-medium">Unknown page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          “{slug}” is not one of the pages on your website.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      <div className="mx-auto max-w-3xl px-6 pb-40 pt-10 md:px-12">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {/* The tenant's OWN name for the page, not the spec's. The sidebar
                renders `cms_pages.name` — "About Us", "Our Fleet", "Terms &
                Conditions" — so using the spec's shorter label here would make
                the rail and the heading disagree about what you just clicked. */}
            <h1 className="font-heading text-[28px] font-medium leading-tight tracking-tight">
              {page?.name || spec.name}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{spec.blurb}</p>
          </div>

          {onShowVisual && (
            <Button variant="ghost" size="sm" className="mr-2 text-muted-foreground" onClick={onShowVisual}>
              Back to the page
            </Button>
          )}
          <PageStatus
            live={live}
            saveState={saveState}
            readOnly={readOnly}
            siteUrl={siteUrl}
            busy={isPublishing || isUnpublishing}
            onHistory={() => setHistoryOpen(true)}
            onTakeOffline={() => page?.id && unpublishPage(page.id)}
          />
        </div>

        {readOnly && (
          <p className="mt-6 rounded-3xl bg-muted/50 px-5 py-3 text-[13px] text-muted-foreground ring-1 ring-foreground/5">
            You have view-only access to website content.
          </p>
        )}

        <div className="mt-9">
          {spec.sections.map((section, i) => {
            const content = draft[section.key] ?? {};
            const filled = hasContent(content, section);
            return (
              <SectionBlock
                key={section.key}
                spec={section}
                content={content}
                first={i === 0}
                readOnly={readOnly}
                open={open[section.key] ?? filled}
                onToggle={() =>
                  setOpen((o) => ({ ...o, [section.key]: !(o[section.key] ?? filled) }))
                }
                onField={(path, v) => setField(section.key, path, v)}
              />
            );
          })}
        </div>
      </div>

      {!live && (
        <OffSiteBar
          busy={isPublishing}
          disabled={readOnly}
          onPublish={() => page?.id && publishPage(page.id)}
        />
      )}

      <VersionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} pageSlug={slug} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Header status
 * ═════════════════════════════════════════════════════════════════════════ */

function PageStatus({
  live,
  saveState,
  readOnly,
  siteUrl,
  busy,
  onHistory,
  onTakeOffline,
}: {
  live: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  readOnly: boolean;
  siteUrl: string;
  busy: boolean;
  onHistory: () => void;
  onTakeOffline: () => void;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="flex shrink-0 items-start gap-1">
      <div className="text-right">
        <p className="flex items-center justify-end gap-1.5 text-[13px] font-medium">
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-success" : "border border-muted-foreground/40"
            )}
          />
          {live ? "On your website" : "Not on your website"}
        </p>
        {/* The honest second line. On a live page an edit really is live, and
            saying "saved as draft" — as v1 does — is both wrong and the exact
            opposite of what its write path actually did to the page. */}
        <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          {saveState === "saving" && <Loader2 className="size-3 animate-spin" />}
          {saveState === "error"
            ? "Last change not saved"
            : saveState === "saving"
              ? "Saving"
              : live
                ? "Changes go live as you type"
                : "Visitors see the default page"}
        </p>
      </div>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setMenu((m) => !m)}
          aria-label="Page options"
        >
          <Ellipsis className="size-4" />
        </Button>
        {menu && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenu(false)}
            />
            <div className={cn(cardCls, "absolute right-0 z-20 mt-1 w-60 p-1.5")}>
              {siteUrl && (
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMenu(false)}
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60"
                >
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                  View on your website
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  onHistory();
                  setMenu(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60"
              >
                <History className="size-3.5 text-muted-foreground" />
                Earlier versions
              </button>
              {live && !readOnly && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onTakeOffline();
                    setMenu(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  <X className="size-3.5" />
                  Take off the website
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The only framed surface, and only while the page is off the site.
 *
 * A live page gets no bar at all — there is nothing to publish, because there
 * is no pending copy anywhere in the schema to publish.
 */
function OffSiteBar({
  busy,
  disabled,
  onPublish,
}: {
  busy: boolean;
  disabled: boolean;
  onPublish: () => void;
}) {
  return (
    <div className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-6 pb-6 md:px-12">
      <div className={cn(cardCls, "pointer-events-auto flex w-full max-w-3xl items-center gap-4 py-3 pl-5 pr-3")}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">This page is not on your website</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Visitors see a default page until you put it on.
          </p>
        </div>
        <Button onClick={onPublish} disabled={busy || disabled}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Put it on the website
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Section
 * ═════════════════════════════════════════════════════════════════════════ */

function SectionBlock({
  spec,
  content,
  first,
  readOnly,
  open,
  onToggle,
  onField,
}: {
  spec: SectionSpec;
  content: any;
  first: boolean;
  readOnly: boolean;
  open: boolean;
  onToggle: () => void;
  onField: (path: string, v: any) => void;
}) {
  const filled = hasContent(content, spec);

  return (
    <section
      className={cn("scroll-mt-8 border-t border-foreground/[0.07] py-6", first && "border-t-0 pt-0")}
    >
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-start gap-2 text-left"
      >
        <ChevronRight
          className={cn(
            "mt-[3px] size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground",
            open && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-heading text-[15px] font-semibold tracking-tight">
            {spec.title}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {open ? (spec.blurb ?? "") : filled ? summarise(content, spec) : "Not set"}
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-3 pl-[22px]">
          {spec.fields.map((f) => (
            <FieldRow
              key={f.key}
              spec={f}
              value={readPath(content, f.key)}
              readOnly={readOnly}
              onChange={(v) => onField(f.key, v)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Fields
 *
 * Two columns — label left, control right, control capped. v1 stacks label,
 * control, description and error vertically for every field, which is what
 * turns five fields into a wall of identical grey bars.
 * ═════════════════════════════════════════════════════════════════════════ */

function FieldRow({
  spec,
  value,
  readOnly,
  onChange,
}: {
  spec: FieldSpec;
  value: any;
  readOnly: boolean;
  onChange: (v: any) => void;
}) {
  const wide =
    spec.type === "richtext" || spec.type === "list" || spec.type === "gallery" || spec.type === "lines";

  return (
    <div className={cn("gap-6 py-2.5", wide ? "block" : "grid grid-cols-[152px_minmax(0,1fr)] items-start")}>
      <label className={cn("block text-[13px] leading-snug text-muted-foreground", wide ? "mb-2" : "pt-2")}>
        {spec.label}
      </label>
      <div className={cn("min-w-0", !wide && "max-w-md")}>
        <FieldControl spec={spec} value={value} readOnly={readOnly} onChange={onChange} />
        {spec.hint && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{spec.hint}</p>}
      </div>
    </div>
  );
}

function FieldControl({
  spec,
  value,
  readOnly,
  onChange,
}: {
  spec: FieldSpec;
  value: any;
  readOnly: boolean;
  onChange: (v: any) => void;
}) {
  switch (spec.type) {
    case "textarea":
      return (
        <textarea
          rows={2}
          disabled={readOnly}
          value={value ?? ""}
          placeholder={spec.fallback}
          onChange={(e) => onChange(e.target.value)}
          className={areaCls}
        />
      );

    case "richtext":
      return (
        <textarea
          rows={14}
          disabled={readOnly}
          value={value ?? ""}
          placeholder="Write the page here. HTML is allowed."
          onChange={(e) => onChange(e.target.value)}
          className={cn(areaCls, "max-w-2xl resize-y leading-relaxed")}
        />
      );

    case "date":
      return (
        <input
          type="date"
          disabled={readOnly}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );

    case "number":
      return <NumberInput value={value} readOnly={readOnly} onChange={onChange} />;

    case "toggle":
      return <Switch checked={Boolean(value)} disabled={readOnly} onCheckedChange={onChange} />;

    case "choice":
      return (
        <Choice options={spec.options ?? []} value={value} readOnly={readOnly} onChange={onChange} />
      );

    case "icon":
      return (
        <IconPicker icons={spec.icons ?? []} value={value} readOnly={readOnly} onChange={onChange} />
      );

    case "image":
      return <ImageField value={value ?? ""} readOnly={readOnly} onChange={onChange} />;

    case "gallery":
      return <GalleryField value={value ?? []} readOnly={readOnly} onChange={onChange} />;

    case "lines":
      return (
        <LinesField
          value={Array.isArray(value) ? value : []}
          noun={spec.noun ?? "line"}
          readOnly={readOnly}
          onChange={onChange}
        />
      );

    case "list":
      return (
        <ListField
          rows={Array.isArray(value) ? value : []}
          item={spec.item ?? []}
          noun={spec.noun ?? "item"}
          readOnly={readOnly}
          onChange={onChange}
        />
      );

    default:
      return (
        <input
          type="text"
          disabled={readOnly}
          value={value ?? ""}
          placeholder={spec.fallback}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
  }
}

/**
 * Number field that owns the raw string it is shown.
 *
 * Round-tripping every keystroke through Number() eats the half-typed states:
 * "12." parses to 12, re-renders as "12", and a decimal price becomes
 * impossible to type.
 */
function NumberInput({
  value,
  readOnly,
  onChange,
}: {
  value: any;
  readOnly: boolean;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(value === 0 || value ? String(value) : "");
  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={readOnly}
      value={raw}
      placeholder="0"
      onChange={(e) => {
        setRaw(e.target.value);
        const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={inputCls}
    />
  );
}

function Choice({
  options,
  value,
  readOnly,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: any;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      disabled={readOnly}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, "cursor-pointer appearance-none pr-8")}
    >
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Icons, constrained to what the customer site can actually render.
 *
 * v1 offers a dropdown that has drifted from booking's icon maps in three
 * separate places, so an operator can pick an icon that silently renders as a
 * generic shield — and v1's own "Set to Default" ships several of them. Showing
 * the real glyph and offering only names that resolve makes that class of bug
 * impossible rather than merely unlikely.
 */
function IconPicker({
  icons,
  value,
  readOnly,
  onChange,
}: {
  icons: readonly string[];
  value: any;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {icons.map((name) => {
        const Icon = iconFor(name);
        const on = String(value ?? "").toLowerCase() === name.toLowerCase();
        return (
          <button
            key={name}
            type="button"
            title={name}
            disabled={readOnly}
            onClick={() => onChange(name)}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-2xl transition-colors disabled:cursor-default",
              on
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

/* ── media ───────────────────────────────────────────────────────────────── */

function ImageField({
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
    const media: any = await uploadMediaAsync({ file, folder: "cms" });
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
            className="size-9 shrink-0 rounded-2xl bg-muted object-contain ring-1 ring-foreground/5"
          />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {value.split("/").pop()}
          </span>
          {!readOnly && (
            <>
              <Button variant="ghost" size="xs" onClick={() => input.current?.click()}>
                Replace
              </Button>
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onChange("")}>
                Remove
              </Button>
            </>
          )}
        </>
      ) : (
        <Button variant="outline" size="sm" disabled={readOnly || isUploading} onClick={() => input.current?.click()}>
          {isUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add image
        </Button>
      )}
    </div>
  );
}

type MediaItem = { url: string; type: "image" | "video"; alt?: string; thumbnail?: string };

function GalleryField({
  value,
  readOnly,
  onChange,
}: {
  value: MediaItem[];
  readOnly: boolean;
  onChange: (v: MediaItem[]) => void;
}) {
  const { uploadMediaAsync, isUploading } = useCMSMedia();
  const input = useRef<HTMLInputElement | null>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: MediaItem[] = [];
    for (const file of Array.from(files)) {
      const media: any = await uploadMediaAsync({ file, folder: "cms" });
      if (media?.file_url) added.push({ url: media.file_url, type: "image" });
    }
    if (added.length) onChange([...value, ...added]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => void add(e.target.files)}
      />
      {value.map((m, i) => (
        <div key={`${m.url}-${i}`} className="group relative">
          <div className="size-16 overflow-hidden rounded-2xl bg-muted ring-1 ring-foreground/5">
            {m.type === "video" ? (
              <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                Video
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="size-full object-cover" />
            )}
          </div>
          {i === 0 && (
            <span className="absolute inset-x-0 bottom-0 bg-foreground/70 py-0.5 text-center text-[10px] font-medium text-background">
              First
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          disabled={isUploading}
          onClick={() => input.current?.click()}
          className="flex size-16 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-foreground/15 text-muted-foreground/50 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
        >
          {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </button>
      )}
    </div>
  );
}

/* ── repeaters ───────────────────────────────────────────────────────────── */

/** A plain `string[]` — trust points, subject options, term lines. */
function LinesField({
  value,
  noun,
  readOnly,
  onChange,
}: {
  value: string[];
  noun: string;
  readOnly: boolean;
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      {value.length > 0 && (
        <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
          {value.map((line, i) => (
            <div key={i} className="group flex items-center gap-2 px-3 py-1.5">
              <input
                type="text"
                disabled={readOnly}
                value={line}
                placeholder={noun}
                onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
                className={cn(inputCls, "h-7 bg-transparent px-1.5 text-[13px]")}
              />
              {!readOnly && (
                <RemoveButton label={`Remove ${noun}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...value, ""])}
          className={cn("text-muted-foreground", value.length && "mt-1.5")}
        >
          <Plus className="size-3.5" />
          Add {noun}
        </Button>
      )}
    </div>
  );
}

/**
 * A repeating row of sub-fields.
 *
 * One list on a single tinted ground, not a stack of cards. v1 gives each row
 * its own bordered card with its own delete button and its own repeated field
 * labels, so three services fill most of a screen and the repetition is louder
 * than the content.
 */
function ListField({
  rows,
  item,
  noun,
  readOnly,
  onChange,
}: {
  rows: any[];
  item: SubFieldSpec[];
  noun: string;
  readOnly: boolean;
  onChange: (v: any[]) => void;
}) {
  const patch = (i: number, key: string, v: any) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

  const blank = () => {
    const row: Record<string, any> = {};
    item.forEach((c) => (row[c.key] = c.type === "toggle" ? false : c.type === "number" ? 0 : ""));
    return row;
  };

  return (
    <div>
      {rows.length > 0 && (
        <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
          {rows.map((row, i) => (
            <div key={i} className="group flex items-start gap-2 px-3 py-2.5">
              <div className="grid min-w-0 flex-1 gap-1.5">
                {item.map((c, ci) => (
                  <SubField
                    key={c.key}
                    spec={c}
                    value={row?.[c.key]}
                    readOnly={readOnly}
                    lead={ci === 0}
                    onChange={(v) => patch(i, c.key, v)}
                  />
                ))}
              </div>
              {!readOnly && (
                <RemoveButton label={`Remove ${noun}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...rows, blank()])}
          className={cn("text-muted-foreground", rows.length && "mt-1.5")}
        >
          <Plus className="size-3.5" />
          Add {noun}
        </Button>
      )}
    </div>
  );
}

function SubField({
  spec,
  value,
  readOnly,
  lead,
  onChange,
}: {
  spec: SubFieldSpec;
  value: any;
  readOnly: boolean;
  /** The row's first column carries the weight; the rest read as detail. */
  lead: boolean;
  onChange: (v: any) => void;
}) {
  if (spec.type === "icon") {
    return <IconPicker icons={spec.icons ?? []} value={value} readOnly={readOnly} onChange={onChange} />;
  }
  if (spec.type === "toggle") {
    return (
      <label className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
        <Switch checked={Boolean(value)} disabled={readOnly} onCheckedChange={onChange} />
        {spec.label}
      </label>
    );
  }
  if (spec.type === "choice") {
    return <Choice options={spec.options ?? []} value={value} readOnly={readOnly} onChange={onChange} />;
  }
  if (spec.type === "number") {
    return <NumberInput value={value} readOnly={readOnly} onChange={onChange} />;
  }
  if (spec.type === "textarea") {
    return (
      <textarea
        rows={1}
        disabled={readOnly}
        value={value ?? ""}
        placeholder={spec.label}
        onChange={(e) => onChange(e.target.value)}
        className={cn(areaCls, "bg-transparent px-1.5 py-0.5 text-[13px] text-muted-foreground")}
      />
    );
  }
  return (
    <input
      type="text"
      disabled={readOnly}
      value={value ?? ""}
      placeholder={spec.label}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, "h-7 bg-transparent px-1.5 text-[13px]", lead && "font-medium")}
    />
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="mt-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition-opacity hover:bg-foreground/5 hover:text-foreground group-hover:opacity-100"
    >
      <X className="size-3.5" />
    </button>
  );
}
