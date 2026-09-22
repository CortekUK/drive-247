"use client";

/**
 * Agreements v2: the editor's side panel (build-spec D7, D8, D9, D10).
 *
 * It slides out OVER the preview (09:56–10:08, "it comes over it and doesn't
 * take up space"): absolutely positioned inside the preview column, against
 * its right edge and the column's full height, with no overlay. The preview
 * underneath never reflows or resizes, and nothing closes the panel but its
 * own close button, so it stays open while a variable or field is dragged out
 * of it into the agreement.
 *
 * Tabs:
 *  - Variables: every TEMPLATE_VARIABLES entry by category, searchable. Each
 *    row has a tooltip, the description over "e.g.: <sample>" (12:45).
 *  - Signature fields: Signature, Initials, Date signed. Each can be placed
 *    once, because the send path defines each tag once, for signer 1.
 *  - Your signature: the operator's own signature (./operator-signature-tab-v2).
 *
 * Every row and tile is both clickable (insert at the cursor) and draggable
 * (HTML5 drag with `text/plain` = exactly the token). A drop is inserted by
 * ProseMirror at the drop point, never at the old cursor.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { CalendarCheck, CaseUpper, Check, GripVertical, Search, Signature, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { SIGNATURE_FIELDS, type SignatureFieldKeyV2 } from "@/lib/agreements-v2/types";
import { cn } from "@/lib/utils";
import { setTokenDragData } from "./editor-extensions";
import { groupVariablesV2, variableToken, variableTooltipLines } from "./variable-help";
import { OperatorSignatureTabV2 } from "./operator-signature-tab-v2";
import { countTag } from "./starter-content";

export type SidePanelTabV2 = "variables" | "fields" | "signature";

const FIELD_ICON: Record<SignatureFieldKeyV2, LucideIcon> = {
  signature: Signature,
  initials: CaseUpper,
  date: CalendarCheck,
};

// One count for the panel, the editor's Save and the send dialog (./starter-content).
export { countTag };

function startTokenDrag(e: DragEvent<HTMLElement>, token: string) {
  setTokenDragData(e.dataTransfer, token);
}

/* -------------------------------------------------------------------------- */
/* Variables                                                                   */
/* -------------------------------------------------------------------------- */

function VariablesTab({ onInsert }: { onInsert: (token: string) => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupVariablesV2(query), [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search variables"
          aria-label="Search variables"
          className="pl-9"
        />
      </div>
      <p className="text-xs text-muted-foreground">Click to insert at the cursor, or drag into the agreement.</p>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>No variables match “{query.trim()}”.</p>
            <Button type="button" variant="link" size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.category} aria-label={group.label} className="mb-3">
              <h3 className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
              <ul className="flex flex-col">
                {group.variables.map((variable) => {
                  const token = variableToken(variable.key);
                  const lines = variableTooltipLines(variable);
                  return (
                    <li key={variable.key}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            draggable
                            data-token={token}
                            onDragStart={(e) => startTokenDrag(e, token)}
                            onClick={() => onInsert(token)}
                            className="group flex w-full cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-[hsl(var(--v2-hover,var(--muted)))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                          >
                            <GripVertical className="size-3.5 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground">{variable.label}</span>
                              <span className="block truncate font-mono text-xs text-muted-foreground">{token}</span>
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[16rem] flex-col items-start gap-0.5">
                          <span>{lines.description}</span>
                          <span className="opacity-80">{lines.example}</span>
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Signature fields                                                            */
/* -------------------------------------------------------------------------- */

function FieldsTab({ content, onInsert }: { content: string; onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Drag a field to the spot where the signer should complete it, or click to put it at the cursor. The signer is asked to
        sign exactly where each field sits.
      </p>
      <ul className="flex flex-col gap-2">
        {SIGNATURE_FIELDS.map((field) => {
          const Icon = FIELD_ICON[field.key];
          const count = countTag(content, field.tag);
          const placed = count > 0;
          return (
            <li key={field.key}>
              <button
                type="button"
                draggable={!placed}
                disabled={placed}
                aria-disabled={placed}
                data-field={field.key}
                data-state={placed ? "placed" : "available"}
                onDragStart={(e) => {
                  if (placed) {
                    e.preventDefault();
                    return;
                  }
                  startTokenDrag(e, field.tag);
                }}
                onClick={() => !placed && onInsert(field.tag)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border border-border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  placed
                    ? "cursor-default bg-muted/40"
                    : "cursor-grab bg-background hover:bg-[hsl(var(--v2-hover,var(--muted)))] active:cursor-grabbing",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed",
                    placed ? "border-border text-muted-foreground" : "border-primary text-primary",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{field.label}</span>
                  <span className="block text-xs text-muted-foreground">{field.hint}</span>
                </span>
                {placed ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3.5" aria-hidden="true" />
                    Placed
                  </span>
                ) : (
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
              {count > 1 && (
                <p role="alert" className="mt-1 flex items-center gap-1 px-1 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                  {field.label} is in the agreement {count} times. Keep one to save.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Each field can be placed once. Remove it from the agreement to place it somewhere else.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

export function EditorSidePanelV2({
  id,
  open,
  onClose,
  content,
  onInsertText,
  onInsertSignature,
  tab,
  onTabChange,
}: {
  id?: string;
  open: boolean;
  onClose: () => void;
  /** The live document HTML, for the fields' "Placed" state. */
  content: string;
  onInsertText: (token: string) => void;
  /** Puts the operator's signature at the cursor. Returns why it was not put there, or nothing when it was. */
  onInsertSignature: (src: string) => string | null | void;
  tab: SidePanelTabV2;
  onTabChange: (tab: SidePanelTabV2) => void;
}) {
  // The tabs mount the first time the panel opens (the variables tab alone is
  // over a hundred rows with tooltips), then stay mounted so closing slides
  // the panel out with its content rather than blanking it first.
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  return (
    <aside
      id={id}
      aria-label="Insert into the agreement"
      aria-hidden={!open}
      inert={!open}
      data-state={open ? "open" : "closed"}
      className={cn(
        "absolute inset-y-0 right-0 z-10 flex w-[360px] max-w-full flex-col border-l border-border bg-background shadow-xl transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">Insert</h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the panel">
          <X />
        </Button>
      </div>
      {everOpened && (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as SidePanelTabV2)} className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <TabsList className="w-full">
            <TabsTrigger value="variables">Variables</TabsTrigger>
            <TabsTrigger value="fields">Signature fields</TabsTrigger>
            <TabsTrigger value="signature">Your signature</TabsTrigger>
          </TabsList>
          <TabsContent value="variables" className="flex min-h-0 flex-1 flex-col">
            <VariablesTab onInsert={onInsertText} />
          </TabsContent>
          <TabsContent value="fields" className="min-h-0 flex-1 overflow-y-auto">
            <FieldsTab content={content} onInsert={onInsertText} />
          </TabsContent>
          <TabsContent value="signature" className="min-h-0 flex-1 overflow-y-auto">
            <OperatorSignatureTabV2 onUse={onInsertSignature} />
          </TabsContent>
        </Tabs>
      )}
    </aside>
  );
}
