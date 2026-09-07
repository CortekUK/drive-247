"use client";

/**
 * Website content — design sandbox.
 *
 * FAKE. No Supabase, no tenant, no auth, no react-query, no network. Every
 * value is hardcoded demo data in `useState`, so this can be opened by anyone
 * at /playground/cms-fake and poked at without touching a real record.
 *
 * ── what it is arguing for ────────────────────────────────────────────────
 *
 * 1. ONE renderer, not fourteen screens. The site is described as data in
 *    `_spec.ts` and drawn once here. v1 has 14 routes and 37 editor components
 *    (~380KB) that each re-invent a card, an icon, a header and a Save button —
 *    which is precisely why it reads as noisy. Fourteen screens drift into
 *    fourteen dialects; one renderer cannot.
 *
 * 2. NO CARDS. v1 wraps every section in a Card, inside a Tabs, inside another
 *    Card — four containers around what is really a list of text fields. Here a
 *    section is a heading and a hairline. The screen has exactly one framed
 *    surface on it, and it is the publish bar, because that one IS a thing that
 *    sits above the page.
 *
 * 3. NO TABS. v1 puts an 8-tab icon strip on a screen that already has a
 *    sidebar — two navigations for one page, plus a third in the hub. Here the
 *    rail carries all of it: pages, and the current page's sections nested
 *    under it. Navigation lives in one place.
 *
 * 4. NO SAVE BUTTON — v1 has EIGHT on the Home page, one per section, with no
 *    cross-section dirty state, so Publish is enabled while a tab is still
 *    unsaved. Here a keystroke is the commit, exactly as in the vehicle and
 *    customer sandboxes. The only button on the screen is Publish, and it
 *    appears only when the draft has drifted from what is actually live.
 *
 * 5. EMPTY IS VISIBLY EMPTY. v1 pre-fills untouched fields with Drive247's own
 *    copy as real values, so every page looks full whether or not anyone has
 *    touched it — and an operator who never opened Hero ships a UK phone
 *    number. Here a default is a grey placeholder: it says what the site will
 *    show, and it is not the record.
 *
 * 6. SAVED ≠ LIVE. v1's only signal is a Draft/Published badge, which flips to
 *    "Draft" the moment you type — while the live site is still happily serving
 *    the old copy. Three states are distinct here and named plainly: never
 *    published, live, and live-with-unpublished-changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  ImageIcon,
  Plus,
  Undo2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import { cardCls, inputCls, textareaCls } from "@/app/playground/_shared";
import {
  ALL_PAGES,
  PAGES,
  SEED,
  SEED_PUBLISHED,
  SITE,
  type FieldSpec,
  type FieldValue,
  type ListRow,
  type PageSpec,
  type SectionSpec,
  type SectionValue,
  type SiteValue,
} from "./_spec";

/* ══════════════════════════════════════════════════════════════════════════
 * Helpers
 * ═════════════════════════════════════════════════════════════════════════ */

const domId = (slug: string, key: string) => `sec-${slug}-${key}`;

const isBlank = (v: FieldValue | undefined) =>
  v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");

/** Does this section carry anything the operator actually typed? */
function hasContent(section: SectionValue | undefined, spec: SectionSpec) {
  if (!section) return false;
  return spec.fields.some((f) => !isBlank(section.fields[f.key]));
}

/**
 * The one line a collapsed section shows instead of its fields.
 *
 * Prefers the first filled text field — for a hero that is the headline, which
 * is the only thing anyone scanning the page wants to see. Lists report a
 * count, because their first row is rarely representative.
 */
function summarise(section: SectionValue | undefined, spec: SectionSpec): string {
  if (!section) return "Not set";
  for (const f of spec.fields) {
    const v = section.fields[f.key];
    if (isBlank(v)) continue;
    if (f.type === "list") {
      const n = (v as ListRow[]).length;
      return `${n} ${f.noun ?? "item"}${n === 1 ? "" : "s"}`;
    }
    if (f.type === "gallery") {
      const n = (v as string[]).length;
      return `${n} image${n === 1 ? "" : "s"}`;
    }
    if (f.type === "image") return String(v);
    const text = String(v).replace(/\s+/g, " ").trim();
    return text.length > 68 ? `${text.slice(0, 68)}…` : text;
  }
  return "Not set";
}

/** Which sections of this page differ from what is published. */
function changedSections(page: Record<string, SectionValue>, snapshot: string | null): string[] {
  if (!snapshot) return [];
  let live: Record<string, SectionValue>;
  try {
    live = JSON.parse(snapshot);
  } catch {
    return [];
  }
  const keys = new Set([...Object.keys(page), ...Object.keys(live)]);
  return [...keys].filter((k) => JSON.stringify(page[k]) !== JSON.stringify(live[k]));
}

type PageState = "never" | "live" | "changed";

/* ══════════════════════════════════════════════════════════════════════════
 * Screen
 * ═════════════════════════════════════════════════════════════════════════ */

export default function CmsFakePage() {
  const [values, setValues] = useState<SiteValue>(SEED);
  const [published, setPublished] = useState<Record<string, string | null>>(SEED_PUBLISHED);
  /** Display strings, not timestamps — this screen must not read the clock. */
  const [publishedAgo, setPublishedAgo] = useState<Record<string, string>>({
    home: "2 days ago",
    contact: "3 weeks ago",
    site: "2 days ago",
  });

  const [slug, setSlug] = useState("home");
  const [active, setActive] = useState<string | null>(null);

  /**
   * Explicit open/closed overrides, keyed `page:section`.
   *
   * Absent means "decide from the content": a section with something in it
   * opens, an untouched one stays a single line. That default is what keeps a
   * finished page from being a 40-field wall on arrival — and it means the
   * sections you have never filled in are exactly the ones out of your way.
   */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const scrollerRef = useRef<HTMLElement | null>(null);
  const seq = useRef(1000);
  const nextId = () => `r-${++seq.current}`;

  const spec: PageSpec = useMemo(
    () => ALL_PAGES.find((p) => p.slug === slug) ?? PAGES[0],
    [slug]
  );
  const pageValues = values[slug] ?? {};
  const changed = useMemo(
    () => changedSections(pageValues, published[slug]),
    [pageValues, published, slug]
  );

  const stateOf = useCallback(
    (s: string): PageState => {
      if (!published[s]) return "never";
      return changedSections(values[s] ?? {}, published[s]).length > 0 ? "changed" : "live";
    },
    [published, values]
  );
  const pageState = stateOf(slug);

  /* ── writing ──────────────────────────────────────────────────────────── */

  const setField = useCallback(
    (sectionKey: string, fieldKey: string, value: FieldValue) => {
      setValues((all) => ({
        ...all,
        [slug]: {
          ...all[slug],
          [sectionKey]: {
            enabled: all[slug]?.[sectionKey]?.enabled ?? true,
            fields: { ...all[slug]?.[sectionKey]?.fields, [fieldKey]: value },
          },
        },
      }));
    },
    [slug]
  );

  const setEnabled = useCallback(
    (sectionKey: string, enabled: boolean) => {
      setValues((all) => ({
        ...all,
        [slug]: {
          ...all[slug],
          [sectionKey]: { enabled, fields: all[slug]?.[sectionKey]?.fields ?? {} },
        },
      }));
    },
    [slug]
  );

  const publish = () => {
    setPublished((p) => ({ ...p, [slug]: JSON.stringify(values[slug]) }));
    setPublishedAgo((p) => ({ ...p, [slug]: "just now" }));
  };

  /** Throw the draft away and go back to exactly what the site is serving. */
  const discard = () => {
    const snapshot = published[slug];
    if (!snapshot) return;
    setValues((all) => ({ ...all, [slug]: JSON.parse(snapshot) }));
  };

  const takeOffline = () => {
    setPublished((p) => ({ ...p, [slug]: null }));
    setPublishedAgo((p) => {
      const next = { ...p };
      delete next[slug];
      return next;
    });
  };

  /* ── navigation ───────────────────────────────────────────────────────── */

  const goToSection = (key: string) => {
    setOpen((o) => ({ ...o, [`${slug}:${key}`]: true }));
    // Next frame, so the section has expanded before we measure where it is.
    requestAnimationFrame(() => {
      document.getElementById(domId(slug, key))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /**
   * Which section the reader is looking at.
   *
   * Drives the rail's nested list. A plain scroll handler rather than an
   * IntersectionObserver: the sections are collapsible, so their boxes come and
   * go, and re-registering an observer on every expand is more machinery than
   * measuring three numbers on a scroll that is already happening.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top + 96;
      let best: string | null = null;
      for (const s of spec.sections) {
        const node = document.getElementById(domId(slug, s.key));
        if (!node) continue;
        if (node.getBoundingClientRect().top <= top) best = s.key;
      }
      setActive(best ?? spec.sections[0]?.key ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [slug, spec, open]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [slug]);

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen">
      {/* ══ rail ═══════════════════════════════════════════════════════════
          One navigation for the whole area: the site's pages, and the current
          page's sections nested under it. v1 spends a hub of cards, a tab strip
          and the app sidebar on the same job. */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-11 items-center px-2">
          <Link
            href="/playground"
            className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="text-[13px]">Back</span>
          </Link>
        </div>
        <div className="px-4 pb-1 pt-1">
          <h2 className="text-sm font-semibold text-foreground">Website</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">northwind.drive-247.com</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-3 pt-1.5">
          <div className="px-1.5">
            {PAGES.map((p) => (
              <PageRow
                key={p.slug}
                name={p.name}
                state={stateOf(p.slug)}
                active={slug === p.slug}
                onClick={() => setSlug(p.slug)}
              >
                {slug === p.slug && (
                  <SectionList
                    sections={spec.sections}
                    values={pageValues}
                    active={active}
                    changed={changed}
                    onPick={goToSection}
                  />
                )}
              </PageRow>
            ))}
          </div>

          <div className="mx-2.5 my-1.5 border-t" />

          <div className="px-1.5">
            <PageRow
              name={SITE.name}
              state={stateOf(SITE.slug)}
              active={slug === SITE.slug}
              onClick={() => setSlug(SITE.slug)}
            >
              {slug === SITE.slug && (
                <SectionList
                  sections={spec.sections}
                  values={pageValues}
                  active={active}
                  changed={changed}
                  onPick={goToSection}
                />
              )}
            </PageRow>
          </div>
        </div>
      </aside>

      {/* ══ page ═══════════════════════════════════════════════════════════ */}
      <main ref={scrollerRef} className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-12 pb-40 pt-10">
          {/* Header. A name, a state, and one quiet action — no back button
              (the rail is the back button), no icon, no gradient, no
              description card explaining what a website is. */}
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="font-heading text-[28px] font-medium leading-tight tracking-tight">
                {spec.name}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{spec.blurb}</p>
            </div>
            <PageStatus
              state={pageState}
              changedCount={changed.length}
              ago={publishedAgo[slug]}
              onTakeOffline={takeOffline}
            />
          </div>

          <div className="mt-9">
            {spec.sections.map((section, i) => (
              <SectionBlock
                key={section.key}
                id={domId(slug, section.key)}
                spec={section}
                value={pageValues[section.key]}
                first={i === 0}
                changed={changed.includes(section.key)}
                everPublished={Boolean(published[slug])}
                open={open[`${slug}:${section.key}`] ?? hasContent(pageValues[section.key], section)}
                onToggle={() =>
                  setOpen((o) => ({
                    ...o,
                    [`${slug}:${section.key}`]:
                      !(o[`${slug}:${section.key}`] ?? hasContent(pageValues[section.key], section)),
                  }))
                }
                onField={(fieldKey, v) => setField(section.key, fieldKey, v)}
                onEnabled={(v) => setEnabled(section.key, v)}
                nextId={nextId}
              />
            ))}
          </div>
        </div>

        {/* The only framed surface on the screen, and the only button. */}
        {(pageState === "changed" || pageState === "never") && (
          <PublishBar
            state={pageState}
            names={changed.map(
              (k) => spec.sections.find((s) => s.key === k)?.title ?? k
            )}
            onPublish={publish}
            onDiscard={discard}
          />
        )}
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rail pieces
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * A page in the rail.
 *
 * The dot is the entire status vocabulary — no pill, no icon, no word. Three
 * states are all there are, and at 6px they read as a column of traffic lights
 * down the rail, which is faster to scan than ten badges.
 */
function PageRow({
  name,
  state,
  active,
  onClick,
  children,
}: {
  name: string;
  state: PageState;
  active: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-sidebar-foreground/70 hover:bg-primary/10 hover:text-primary"
        )}
      >
        <StatusDot state={state} />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">{name}</span>
      </button>
      {children}
    </div>
  );
}

function StatusDot({ state }: { state: PageState }) {
  return (
    <span
      title={state === "live" ? "Live" : state === "changed" ? "Unpublished changes" : "Not published"}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "live" && "bg-success",
        state === "changed" && "bg-warning",
        state === "never" && "border border-muted-foreground/40 bg-transparent"
      )}
    />
  );
}

/** The current page's sections, nested under it. Replaces v1's tab strip. */
function SectionList({
  sections,
  values,
  active,
  changed,
  onPick,
}: {
  sections: SectionSpec[];
  values: Record<string, SectionValue>;
  active: string | null;
  changed: string[];
  onPick: (key: string) => void;
}) {
  return (
    <div className="mb-1 ml-[19px] border-l border-sidebar-border pl-2">
      {sections.map((s) => {
        const value = values[s.key];
        const disabled = s.optional && value && !value.enabled;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-left text-[12px] leading-tight transition-colors",
              active === s.key
                ? "font-medium text-primary"
                : "text-sidebar-foreground/55 hover:text-foreground"
            )}
          >
            <span className={cn("min-w-0 flex-1 truncate", disabled && "line-through opacity-50")}>
              {s.title}
            </span>
            {changed.includes(s.key) && <span className="size-1 shrink-0 rounded-full bg-warning" />}
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Page header status
 * ═════════════════════════════════════════════════════════════════════════ */

function PageStatus({
  state,
  changedCount,
  ago,
  onTakeOffline,
}: {
  state: PageState;
  changedCount: number;
  ago?: string;
  onTakeOffline: () => void;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="text-right">
        <p className="flex items-center justify-end gap-1.5 text-[13px] font-medium">
          <StatusDot state={state} />
          {state === "never" ? "Not published" : state === "changed" ? "Live — edited" : "Live"}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {state === "never"
            ? "Nothing on the site yet"
            : state === "changed"
              ? `${changedCount} section${changedCount === 1 ? "" : "s"} not published`
              : ago
                ? `Published ${ago}`
                : "Published"}
        </p>
      </div>

      {state !== "never" && (
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
              <div className={cn(cardCls, "absolute right-0 z-20 mt-1 w-56 p-1.5")}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60"
                  onClick={() => setMenu(false)}
                >
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                  View on the site
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => {
                    onTakeOffline();
                    setMenu(false);
                  }}
                >
                  <X className="size-3.5" />
                  Take page offline
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Section
 * ═════════════════════════════════════════════════════════════════════════ */

function SectionBlock({
  id,
  spec,
  value,
  first,
  changed,
  everPublished,
  open,
  onToggle,
  onField,
  onEnabled,
  nextId,
}: {
  id: string;
  spec: SectionSpec;
  value: SectionValue | undefined;
  first: boolean;
  changed: boolean;
  everPublished: boolean;
  open: boolean;
  onToggle: () => void;
  onField: (key: string, v: FieldValue) => void;
  onEnabled: (v: boolean) => void;
  nextId: () => string;
}) {
  const enabled = spec.optional ? (value?.enabled ?? false) : true;
  const filled = hasContent(value, spec);

  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-8 border-t border-foreground/[0.07] py-6",
        first && "border-t-0 pt-0"
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={!enabled}
          className="group flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left disabled:cursor-default"
        >
          <ChevronRight
            className={cn(
              "mt-[3px] size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground",
              open && enabled && "rotate-90",
              !enabled && "opacity-0"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "font-heading text-[15px] font-semibold tracking-tight",
                  !enabled && "text-muted-foreground"
                )}
              >
                {spec.title}
              </span>
              {/* Only ever shown against something actually live — an
                  unpublished page has nothing for a section to differ FROM. */}
              {changed && everPublished && (
                <span className="text-[11px] font-medium text-warning">edited</span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {!enabled
                ? "Hidden on the site"
                : open
                  ? (spec.blurb ?? "")
                  : filled
                    ? summarise(value, spec)
                    : "Not set"}
            </span>
          </span>
        </button>

        {spec.optional && (
          <Switch
            checked={enabled}
            onCheckedChange={onEnabled}
            aria-label={`Show ${spec.title} on the site`}
            className="mt-1 shrink-0"
          />
        )}
      </div>

      {open && enabled && (
        <div className="mt-3 pl-[22px]">
          {spec.fields.map((f) => (
            <FieldRow
              key={f.key}
              spec={f}
              value={value?.fields[f.key]}
              onChange={(v) => onField(f.key, v)}
              nextId={nextId}
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
 * Two columns — label left, control right. v1 stacks label, control,
 * description and error message vertically for every field, which is what makes
 * five fields look like a wall. Side by side, the labels form one scannable
 * column and the page is roughly 40% shorter.
 * ═════════════════════════════════════════════════════════════════════════ */

function FieldRow({
  spec,
  value,
  onChange,
  nextId,
}: {
  spec: FieldSpec;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  nextId: () => string;
}) {
  const wide = spec.type === "richtext" || spec.type === "list" || spec.type === "gallery";

  return (
    <div
      className={cn(
        "gap-6 py-2.5",
        wide ? "block" : "grid grid-cols-[148px_minmax(0,1fr)] items-start"
      )}
    >
      <label
        className={cn(
          "block text-[13px] leading-snug text-muted-foreground",
          wide ? "mb-2" : "pt-2"
        )}
      >
        {spec.label}
      </label>
      {/* Short values get a short control. Letting every input run the full
          width turns a five-field section into five identical grey bars, which
          is most of what made v1 feel heavy — the eye reads the boxes, not the
          content. Long-form controls keep the full measure. */}
      <div className={cn("min-w-0", !wide && "max-w-md")}>
        <FieldControl spec={spec} value={value} onChange={onChange} nextId={nextId} />
        {spec.hint && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{spec.hint}</p>}
      </div>
    </div>
  );
}

function FieldControl({
  spec,
  value,
  onChange,
  nextId,
}: {
  spec: FieldSpec;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  nextId: () => string;
}) {
  switch (spec.type) {
    case "textarea":
      return (
        <textarea
          rows={2}
          value={(value as string) ?? ""}
          placeholder={spec.fallback}
          onChange={(e) => onChange(e.target.value)}
          className={cn(textareaCls, "min-h-0 py-2")}
        />
      );

    case "richtext":
      return (
        // A policy is prose. Setting it in mono made the one screen that is
        // pure reading look like a code editor.
        <textarea
          rows={10}
          value={(value as string) ?? ""}
          placeholder="Write the policy here."
          onChange={(e) => onChange(e.target.value)}
          className={cn(textareaCls, "max-w-2xl resize-y leading-relaxed")}
        />
      );

    case "image":
      return <ImageField value={(value as string) ?? ""} onChange={onChange} />;

    case "gallery":
      return <GalleryField value={(value as string[]) ?? []} onChange={onChange} />;

    case "list":
      return (
        <ListField
          spec={spec}
          rows={(value as ListRow[]) ?? []}
          onChange={onChange}
          nextId={nextId}
        />
      );

    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          placeholder={spec.fallback}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
  }
}

/**
 * A single image, as a ROW rather than a dropzone.
 *
 * v1 gives every image a full bordered upload panel with its own heading and
 * description — three of those on one page and the text fields disappear
 * between them. An image is one value; it gets one line, like every other
 * value.
 */
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  if (!value) {
    return (
      <Button variant="outline" size="sm" onClick={() => onChange("uploaded-file.png")}>
        <Plus className="size-3.5" />
        Add image
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Thumb />
      <span className="min-w-0 flex-1 truncate text-[13px]">{value}</span>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onChange("")}>
        Remove
      </Button>
    </div>
  );
}

function GalleryField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {value.map((img, i) => (
        <div key={img} className="group relative">
          <Thumb large />
          {/* The first image is the one the site leads with — worth saying,
              not worth a badge on every tile. */}
          {i === 0 && (
            <span className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-foreground/70 py-0.5 text-center text-[10px] font-medium text-background">
              First
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${img}`}
            onClick={() => onChange(value.filter((v) => v !== img))}
            className="absolute -right-1.5 -top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, `image-${value.length + 1}.jpg`])}
        className="flex size-16 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-foreground/15 text-muted-foreground/50 transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** A flat token block. This is a sandbox: nothing here reaches the network. */
function Thumb({ large }: { large?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/5",
        large ? "size-16" : "size-9"
      )}
    >
      <ImageIcon className={cn("text-muted-foreground/40", large ? "size-5" : "size-4")} />
    </div>
  );
}

/**
 * A repeating row — services, FAQs, stats, trust badges.
 *
 * Rendered as ONE list on a single tinted ground rather than as a stack of
 * cards. v1 gives each row its own bordered card with its own delete button and
 * its own field labels repeated, so three services occupy most of a screen and
 * the repetition is louder than the content.
 */
function ListField({
  spec,
  rows,
  onChange,
  nextId,
}: {
  spec: FieldSpec;
  rows: ListRow[];
  onChange: (v: ListRow[]) => void;
  nextId: () => string;
}) {
  const cols = spec.item ?? [];
  const noun = spec.noun ?? "item";

  const add = () => {
    const row: ListRow = { id: nextId() };
    cols.forEach((c) => (row[c.key] = ""));
    onChange([...rows, row]);
  };

  return (
    <div>
      {rows.length > 0 && (
        <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
          {rows.map((row) => (
            <div key={row.id} className="group flex items-start gap-2 px-3 py-2.5">
              <div className="grid min-w-0 flex-1 gap-1.5">
                {cols.map((c, i) =>
                  c.type === "textarea" ? (
                    <textarea
                      key={c.key}
                      rows={1}
                      value={row[c.key] ?? ""}
                      placeholder={c.label}
                      onChange={(e) =>
                        onChange(rows.map((r) => (r.id === row.id ? { ...r, [c.key]: e.target.value } : r)))
                      }
                      className={cn(
                        textareaCls,
                        "min-h-0 bg-transparent px-1.5 py-0.5 text-[13px] text-muted-foreground"
                      )}
                    />
                  ) : (
                    <input
                      key={c.key}
                      type="text"
                      value={row[c.key] ?? ""}
                      placeholder={c.label}
                      onChange={(e) =>
                        onChange(rows.map((r) => (r.id === row.id ? { ...r, [c.key]: e.target.value } : r)))
                      }
                      className={cn(
                        inputCls,
                        "h-7 bg-transparent px-1.5 text-[13px]",
                        // The first column is the row's title, so it carries
                        // the weight and the rest read as detail under it.
                        i === 0 && "font-medium"
                      )}
                    />
                  )
                )}
              </div>
              <button
                type="button"
                aria-label={`Remove ${noun}`}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                className="mt-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition-opacity hover:bg-foreground/5 hover:text-foreground group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={add} className={cn("text-muted-foreground", rows.length && "mt-1.5")}>
        <Plus className="size-3.5" />
        Add {noun}
      </Button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Publish bar
 *
 * The only framed surface and the only button on the screen. It appears when
 * the draft has drifted from what is live, and says WHICH sections drifted —
 * so "Publish" is never a leap of faith, which is the job a preview would
 * otherwise have to do.
 * ═════════════════════════════════════════════════════════════════════════ */

function PublishBar({
  state,
  names,
  onPublish,
  onDiscard,
}: {
  state: PageState;
  names: string[];
  onPublish: () => void;
  onDiscard: () => void;
}) {
  const never = state === "never";

  return (
    <div className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-12 pb-6">
      <div
        className={cn(
          cardCls,
          "pointer-events-auto flex w-full max-w-3xl items-center gap-4 py-3 pl-5 pr-3"
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {never ? "This page is not on the site yet" : `${names.length} section${names.length === 1 ? "" : "s"} changed`}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {never ? "Publish it when you are ready for visitors to see it." : names.join(" · ")}
          </p>
        </div>
        {!never && (
          <Button variant="ghost" size="sm" onClick={onDiscard} className="text-muted-foreground">
            <Undo2 className="size-3.5" />
            Discard
          </Button>
        )}
        <Button onClick={onPublish}>{never ? "Publish page" : "Publish changes"}</Button>
      </div>
    </div>
  );
}
