"use client";

/**
 * Agreements v2: pick one of the tenant's agreement templates (D12, D14).
 *
 * Used by the Send agreement dialog (pick the template, or Create new) and by
 * the v2 rental detail's Agreement stage (Change). It only chooses: it never
 * reads, writes or copies a template, and it never opens the editor itself.
 * `onCreateNew`, when given, is how the caller offers "start from nothing".
 *
 * ORDER. Default templates first (the one a rental sends today), then the
 * rest, each group in the order it was given. The templates hook already
 * sorts by name, so the list reads the same everywhere.
 *
 * KEYBOARD (the listbox pattern). Focus stays in the search field while
 * typing; ArrowUp/ArrowDown, Home/End move the highlighted row and Enter picks
 * it. The list itself is also one tab stop with the same keys, plus Space.
 * The highlighted row is announced through aria-activedescendant, so the
 * screen reader follows it without focus leaving the field.
 */

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check, FileText, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { SettingsEmptyState, SettingsNoMatch } from "@/components/settings-v2/section-states";
import { AGREEMENT_CATEGORY_LABEL, agreementPreviewSnippet } from "@/components/settings-v2/message-rules";
import { EditorChip } from "@/components/settings-v2/template-editor-shell-v2";
import type { AgreementTemplateV2 } from "@/lib/agreements-v2/types";
import { cn } from "@/lib/utils";

/** Defaults first, then the rest; stable within each group. */
export function orderTemplatesForPickerV2(templates: readonly AgreementTemplateV2[]): AgreementTemplateV2[] {
  return [...templates.filter((t) => t.isDefault), ...templates.filter((t) => !t.isDefault)];
}

/** Case-insensitive match on the template's NAME only (ticket: "searchable by name"). */
export function matchTemplatesByNameV2<T extends Pick<AgreementTemplateV2, "name">>(templates: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...templates];
  return templates.filter((t) => (t.name || "").toLocaleLowerCase().includes(q));
}

/** What a template with no name is called on screen. */
export const UNNAMED_TEMPLATE = "Untitled template";

const OPTION_CLASS =
  "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors data-[active=true]:bg-primary/10 dark:data-[active=true]:bg-[hsl(var(--v2-hover,var(--muted)))] aria-selected:ring-1 aria-selected:ring-primary/40";

export interface TemplatePickerV2Props {
  templates: AgreementTemplateV2[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** Offer "Create new" (the caller opens the editor on a blank or starter copy). */
  onCreateNew?(): void;
  /** The list's accessible name. */
  label?: string;
  className?: string;
}

export function TemplatePickerV2({
  templates,
  selectedId,
  onSelect,
  onCreateNew,
  label = "Agreement templates",
  className,
}: TemplatePickerV2Props) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (id: string) => `${baseId}-option-${id}`;

  const [query, setQuery] = useState("");
  const ordered = useMemo(() => orderTemplatesForPickerV2(templates), [templates]);
  const visible = useMemo(() => matchTemplatesByNameV2(ordered, query), [ordered, query]);

  // The highlighted row: the selected template when it is on screen, else the first.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = (() => {
    const byActive = activeId ? visible.findIndex((t) => t.id === activeId) : -1;
    if (byActive !== -1) return byActive;
    const bySelected = selectedId ? visible.findIndex((t) => t.id === selectedId) : -1;
    return bySelected !== -1 ? bySelected : visible.length > 0 ? 0 : -1;
  })();
  const active = activeIndex >= 0 ? visible[activeIndex] : null;

  // A new search starts from its first match (or the selected one, if it matches).
  const search = (value: string) => {
    setQuery(value);
    setActiveId(null);
  };

  const moveTo = (index: number) => {
    const next = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (!next) return;
    setActiveId(next.id);
    if (typeof document !== "undefined") {
      document.getElementById(optionId(next.id))?.scrollIntoView?.({ block: "nearest" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, allowSpace: boolean) => {
    if (visible.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case "Home":
        if (!allowSpace) return; // Home/End move the caret in the search field.
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        if (!allowSpace) return;
        event.preventDefault();
        moveTo(visible.length - 1);
        break;
      case "Enter":
        if (active) {
          event.preventDefault();
          onSelect(active.id);
        }
        break;
      case " ":
        if (allowSpace && active) {
          event.preventDefault();
          onSelect(active.id);
        }
        break;
      default:
        break;
    }
  };

  const activeDescendant = active ? optionId(active.id) : undefined;

  // Nothing to search or pick yet: the empty state carries the one action.
  if (templates.length === 0) {
    return (
      <div className={className} data-template-picker="">
        <SettingsEmptyState
          variant="compact"
          icon={FileText}
          headline="No templates yet"
          body={onCreateNew ? "Start a new agreement from scratch." : "Agreement templates you create appear here."}
          primaryAction={onCreateNew ? { label: "Create new", onClick: () => onCreateNew(), icon: Plus } : undefined}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-template-picker="">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search templates by name"
            placeholder="Search templates"
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, false)}
            aria-controls={visible.length > 0 ? listId : undefined}
            aria-activedescendant={activeDescendant}
            autoComplete="off"
            className="pl-9 pr-9"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => search("")}
            >
              <X />
            </Button>
          )}
        </div>
        {onCreateNew && (
          <Button type="button" variant="outline" size="sm" onClick={() => onCreateNew()}>
            <Plus data-icon="inline-start" />
            Create new
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <SettingsNoMatch query={query} noun="templates" size="compact" onClear={() => search("")} />
      ) : (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={0}
          aria-activedescendant={activeDescendant}
          onKeyDown={(e) => onKeyDown(e, true)}
          className="-mx-1 max-h-72 space-y-1 overflow-y-auto rounded-xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible.map((template, index) => {
            const selected = template.id === selectedId;
            const snippet = agreementPreviewSnippet(template.content, 120);
            return (
              <div
                key={template.id}
                id={optionId(template.id)}
                role="option"
                aria-selected={selected}
                data-active={index === activeIndex ? "true" : undefined}
                data-template-id={template.id}
                onClick={() => onSelect(template.id)}
                onMouseMove={() => {
                  if (activeId !== template.id) setActiveId(template.id);
                }}
                className={OPTION_CLASS}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {template.name || UNNAMED_TEMPLATE}
                    </span>
                    {template.isDefault && <EditorChip tone="primary">Default</EditorChip>}
                    {template.category !== "standard" && <EditorChip>{AGREEMENT_CATEGORY_LABEL[template.category]}</EditorChip>}
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {snippet ?? <span className="italic">No wording yet</span>}
                  </p>
                </div>
                <Check
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
                    !selected && "invisible",
                  )}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
