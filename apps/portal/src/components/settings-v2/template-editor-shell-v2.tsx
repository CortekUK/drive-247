"use client";

/**
 * v2 Settings: the frame both template editors (email, rental agreement) sit
 * in. v2 ONLY: the v1 editor pages render their own layout and hand off to the
 * v2 editors behind `useV2('chrome')`.
 *
 * It owns the states v1 did not have: a skeleton while loading, a retry card
 * when the read fails (never an editor seeded with default wording, which one
 * Save would write over the stored template), a real empty state for an
 * unknown link, and a read-only mode for viewers. At phone width the editor
 * and preview swap behind a toggle instead of two 180px columns.
 */

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Edit3, Eye, FileQuestion, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { cn } from "@/lib/utils";
import { SettingsEmptyState, SettingsLoadError, SettingsReadOnlyNotice, SettingsSectionSkeleton } from "./section-states";

export interface EditorIconAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "default" | "destructive";
}

/** An icon-only control with its name in a tooltip and in `aria-label`. */
export function IconActionButton({ action }: { action: EditorIconAction }) {
  const Icon = action.busy ? Loader2 : action.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={action.onClick}
          disabled={action.disabled || action.busy}
          aria-label={action.label}
          className={cn(action.tone === "destructive" && "text-destructive hover:text-destructive")}
        >
          <Icon className={cn(action.busy && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

export type EditorShellState =
  | { kind: "loading" }
  | { kind: "error"; thing: string; error: unknown; onRetry: () => unknown; retrying?: boolean }
  | { kind: "not-found"; headline: string; body: string }
  | { kind: "ready" };

const PREVIEW_CSS = `
.template-preview-v2 h1{font-size:1.75rem;font-weight:700;margin:0 0 .75rem}
.template-preview-v2 h2{font-size:1.375rem;font-weight:600;margin:1.25rem 0 .5rem}
.template-preview-v2[data-kind="agreement"] h2{padding-bottom:.25rem;border-bottom:1px solid hsl(var(--border))}
.template-preview-v2 h3{font-size:1.125rem;font-weight:600;margin:1rem 0 .5rem}
.template-preview-v2 p{margin-bottom:.5rem}
.template-preview-v2 ul{padding-left:1.5rem;margin-bottom:.75rem;list-style-type:disc}
.template-preview-v2 ol{padding-left:1.5rem;margin-bottom:.75rem;list-style-type:decimal}
.template-preview-v2 li{margin-bottom:.25rem}
.template-preview-v2 table{border-collapse:collapse;margin:.75rem 0;width:100%;display:block;overflow-x:auto}
.template-preview-v2 th,.template-preview-v2 td{border:1px solid hsl(var(--border));padding:.5rem .75rem;text-align:left}
.template-preview-v2 th{background-color:hsl(var(--muted));font-weight:600}
.template-preview-v2 img{max-width:100%;height:auto}
`;

export function TemplateEditorShellV2({
  title,
  badges,
  description,
  backLabel,
  onBack,
  state,
  readOnly,
  actions = [],
  onSave,
  saveDisabled,
  saving,
  aboveEditor,
  editor,
  preview,
  previewKind,
  children,
}: {
  title: string;
  badges?: ReactNode;
  description?: ReactNode;
  backLabel: string;
  onBack: () => void;
  state: EditorShellState;
  readOnly: boolean;
  actions?: EditorIconAction[];
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  aboveEditor?: ReactNode;
  editor: ReactNode;
  preview: ReactNode;
  previewKind: "email" | "agreement";
  /** Dialogs. */
  children?: ReactNode;
}) {
  const [pane, setPane] = useState<"editor" | "preview">("editor");

  let body: ReactNode;
  if (state.kind === "loading") {
    body = (
      <div className="px-4 sm:px-6">
        <SettingsSectionSkeleton variant="cards" rows={2} label="Loading template" />
      </div>
    );
  } else if (state.kind === "error") {
    body = (
      <div className="px-4 sm:px-6">
        <SettingsLoadError thing={state.thing} error={state.error} onRetry={state.onRetry} retrying={state.retrying} />
      </div>
    );
  } else if (state.kind === "not-found") {
    body = (
      <div className="px-4 sm:px-6">
        <SettingsEmptyState
          icon={FileQuestion}
          headline={state.headline}
          body={state.body}
          primaryAction={{ label: backLabel, onClick: onBack, icon: ArrowLeft }}
        />
      </div>
    );
  } else {
    body = (
      <>
        {aboveEditor && <div className="space-y-3 px-4 pb-3 sm:px-6">{aboveEditor}</div>}
        <div role="tablist" aria-label="Editor or preview" className="flex gap-1 px-4 pb-3 sm:px-6 md:hidden">
          {(["editor", "preview"] as const).map((p) => (
            <Button
              key={p}
              type="button"
              role="tab"
              aria-selected={pane === p}
              variant={pane === p ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPane(p)}
            >
              {p === "editor" ? <Edit3 data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
              {p === "editor" ? (readOnly ? "Template" : "Editor") : "Preview"}
            </Button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-4 sm:px-6 md:grid-cols-2">
          <section
            aria-label="Editor"
            className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card", pane !== "editor" && "hidden md:flex")}
          >
            <p className="flex items-center gap-2 px-4 pb-2 pt-3 text-sm font-medium text-muted-foreground">
              <Edit3 className="size-4" aria-hidden="true" />
              {readOnly ? "Template (view only)" : "Editor"}
            </p>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {/* `inert` blocks typing and focus but not scrolling: the scroller is the parent. */}
              <div className="flex min-h-0 flex-1 flex-col" inert={readOnly || undefined} data-read-only={readOnly || undefined}>
                {editor}
              </div>
            </div>
          </section>
          <section
            aria-label="Preview"
            className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card", pane !== "preview" && "hidden md:flex")}
          >
            <p className="flex items-center gap-2 px-4 pb-2 pt-3 text-sm font-medium text-muted-foreground">
              <Eye className="size-4" aria-hidden="true" />
              Preview
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">Sample data</span>
            </p>
            <div className="template-preview-v2 min-h-0 flex-1 overflow-auto px-5 pb-5 [overflow-wrap:anywhere]" data-kind={previewKind}>
              {preview}
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <TooltipProvider>
      <style>{PREVIEW_CSS}</style>
      <div className="flex h-[calc(100vh-4rem)] flex-col md:h-[calc(100vh-66px)] md:pt-[14px]">
        {/* The title block wants 12rem before the actions may share its line.
            With a zero basis (plain `flex-1`) the row never wrapped, and at phone
            width the view-only chip squeezed the title to one letter per line.
            Save and Reset still fit beside the title on a phone; the longer chip
            drops under it. */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2 sm:gap-3">
            <IconActionButton action={{ label: backLabel, icon: ArrowLeft, onClick: onBack }} />
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
                {badges}
              </h1>
              {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
            </div>
          </div>
          {state.kind === "ready" && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              {actions.map((action) => (
                <IconActionButton key={action.label} action={action} />
              ))}
              {readOnly ? (
                <SettingsReadOnlyNotice />
              ) : (
                <Button type="button" size="sm" onClick={onSave} disabled={saveDisabled || saving}>
                  {saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              )}
            </div>
          )}
        </header>
        {body}
      </div>
      <>{children}</>
    </TooltipProvider>
  );
}

/** A small status chip for editor headers ("Customized", "Unsaved changes"). */
export function EditorChip({ tone = "muted", children }: { tone?: "muted" | "primary" | "amber"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "primary" && "bg-primary/10 text-primary dark:text-indigo-300",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
