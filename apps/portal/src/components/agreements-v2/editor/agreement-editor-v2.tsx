"use client";

/**
 * Agreements v2: the half-and-half agreement editor (build-spec D6-D11).
 *
 * "The two things to get genuinely right are the editor and the preview"
 * (22:18). A full-screen overlay, 100vw × 100vh (04:22): editing on the left
 * half, the agreement as the signer gets it on the right half, updating live.
 * One component for all three ways in:
 *
 *   mode="template"         Agreements tab → a template. Saves the template.
 *   mode="one-off"          Send dialog → Edit / Create new. Saves NOTHING to
 *                           any template: `onSave` hands the content back for
 *                           this one agreement (15:58, 16:37).
 *   mode="rental-template"  A rental's Agreement stage → Edit. Saves the
 *                           template, for every future agreement (21:44).
 *
 * The overlay is a Radix dialog (ui-v2's primitives), not a bare fixed div:
 * it is opened from inside other dialogs (the send dialog), and Radix is what
 * stacks the focus trap, Escape and outside clicks correctly between them.
 *
 * Editing uses its OWN Tiptap setup (./editor-extensions), never the shared
 * `components/settings/tiptap-editor.tsx`, which also drives the v1 editors.
 * Variables and the signer tags are plain text in the document, byte for byte
 * what the send path reads; the editor never rewrites or strips them.
 *
 * Leaving with unsaved changes asks first: Cancel, Escape, and (through the
 * shared `useUnsavedChangesWarning`) links, back/forward and closing the tab.
 * A failed save keeps the editor open and says why.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlertTriangle, Eye, Loader2, PanelRightClose, PanelRightOpen, PenLine } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogDescription, DialogPortal, DialogTitle } from "@/components/ui-v2/dialog";
import { Input } from "@/components/ui-v2/input";
import { TooltipProvider } from "@/components/ui-v2/tooltip";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { AgreementPreviewV2, isBlankAgreementHtml } from "@/components/agreements-v2/agreement-preview-v2";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { renderAgreementHtml } from "@/lib/agreements-v2/render";
import { cn } from "@/lib/utils";
import { createAgreementEditorExtensions, isInsideTableOrList, SIGNATURE_PLACEMENT_REASON } from "./editor-extensions";
import { EditorToolbarV2 } from "./editor-toolbar-v2";
import { EditorSidePanelV2, type SidePanelTabV2 } from "./editor-side-panel-v2";
import { AGREEMENT_STARTER_V2, duplicateSignerFieldsReasonV2 } from "./starter-content";

export type AgreementEditorModeV2 = "template" | "one-off" | "rental-template";

export interface AgreementEditorV2Props {
  open: boolean;
  onClose: () => void;
  mode: AgreementEditorModeV2;
  initialName: string;
  initialContent: string;
  /** The values the preview substitutes (renderAgreementHtml, 'preview' mode). */
  previewData: Record<string, string>;
  /**
   * Called with the content (and the name) to keep. A rejection keeps the
   * editor open and shows its message; success closes the editor.
   */
  onSave: (content: string, name: string) => Promise<void> | void;
  /** "Save template" | "Use for this agreement" | "Save to template". Defaults by mode. */
  saveLabel?: string;
  /** Show the name as an editable field (templates). Otherwise it is a heading. */
  nameEditable?: boolean;
  /** The PDF's banner text for the preview (e.g. the document title). None by default, in every mode. */
  previewBanner?: string;
  /**
   * Template mode: the template being edited is its category's DEFAULT, the
   * one rentals send. The header says so, since saving changes what goes out.
   */
  isDefaultTemplate?: boolean;
  /**
   * Applied to the editor's content before the live preview renders it (never
   * to what is saved). The rental lane passes the same clause injection its
   * Preview dialog uses, so Edit and Preview show the same document.
   */
  previewTransform?: (html: string) => string;
}

/** What the header says under the name, per mode. */
export const EDITOR_MODE_HINT_V2: Record<AgreementEditorModeV2, string | null> = {
  template: null,
  "one-off": "Changes apply to this agreement only — your template stays as it is.",
  "rental-template": "Saving updates this template for every future agreement that uses it.",
};

/** Template mode, when the template is the default (`isDefaultTemplate`). */
export const DEFAULT_TEMPLATE_HINT_V2 = "This is your default template — saving changes what rentals send from now on.";

const DEFAULT_SAVE_LABEL: Record<AgreementEditorModeV2, string> = {
  template: "Save template",
  "one-off": "Use for this agreement",
  "rental-template": "Save to template",
};

/** Where the preview's values come from, so nobody mistakes samples for a real customer. */
const PREVIEW_SOURCE: Record<AgreementEditorModeV2, string> = {
  template: "Your company details, sample customer",
  "one-off": "Filled in for this recipient",
  "rental-template": "Filled in from this rental",
};

/** How long the preview waits after the last keystroke. */
export const PREVIEW_DEBOUNCE_MS = 150;

const PHONE_QUERY = "(max-width: 767px)";

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Tiptap's TrailingNode puts an empty paragraph after a final table or list
 * on the first click into the document. That is not an edit, so it is ignored
 * when deciding whether anything changed.
 */
const comparable = (html: string) => html.replace(/(?:<p><\/p>)+$/, "");

const errorMessage = (e: unknown) =>
  e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : "Something went wrong. Try again.";

/**
 * The writing surface. Screen-friendly (theme colours, DM Sans), with the same
 * block set the PDF draws; `.agr-token` is the view-only tint the token
 * highlighter puts on variables and signer fields.
 */
const EDITOR_CSS = `
.agr-editor-v2 .tiptap{min-height:100%;box-sizing:border-box;max-width:794px;margin:0 auto;padding:24px 28px 120px;outline:none;font-size:14px;line-height:1.6;color:hsl(var(--foreground));overflow-wrap:break-word}
.agr-editor-v2 .tiptap>*:first-child{margin-top:0}
.agr-editor-v2 .tiptap p{margin:0 0 .5rem}
.agr-editor-v2 .tiptap h1{font-size:1.5rem;line-height:1.25;font-weight:700;margin:1.25rem 0 .5rem}
.agr-editor-v2 .tiptap h2{font-size:1.2rem;line-height:1.3;font-weight:700;margin:1.1rem 0 .5rem;padding-bottom:.25rem;border-bottom:1px solid hsl(var(--border))}
.agr-editor-v2 .tiptap h3{font-size:1.05rem;line-height:1.35;font-weight:700;margin:1rem 0 .4rem}
.agr-editor-v2 .tiptap ul{list-style:disc;padding-left:1.5rem;margin:0 0 .5rem}
.agr-editor-v2 .tiptap ol{list-style:decimal;padding-left:1.5rem;margin:0 0 .5rem}
.agr-editor-v2 .tiptap li>p{margin:0}
.agr-editor-v2 .tiptap hr{border:0;border-top:1px solid hsl(var(--border));margin:1rem 0}
.agr-editor-v2 .tiptap hr.ProseMirror-selectednode{border-top-color:hsl(var(--ring))}
.agr-editor-v2 .tiptap table{border-collapse:collapse;width:100%;table-layout:fixed;margin:.5rem 0 .75rem}
.agr-editor-v2 .tiptap td,.agr-editor-v2 .tiptap th{position:relative;border:1px solid hsl(var(--border));padding:.35rem .5rem;vertical-align:top;text-align:left}
.agr-editor-v2 .tiptap th{background:hsl(var(--muted));font-weight:600}
.agr-editor-v2 .tiptap td p,.agr-editor-v2 .tiptap th p{margin:0}
.agr-editor-v2 .tiptap .selectedCell::after{content:"";position:absolute;inset:0;background:hsl(var(--primary) / .08);pointer-events:none}
.agr-editor-v2 .tiptap img[data-operator-signature]{display:block;max-width:200px;max-height:70px;margin:.25rem 0;background:#fff;border-radius:4px}
.agr-editor-v2 .tiptap img.ProseMirror-selectednode{outline:2px solid hsl(var(--ring));outline-offset:2px}
.agr-editor-v2 .tiptap a{color:inherit;text-decoration:underline dotted}
.agr-editor-v2 .tiptap p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:left;height:0;pointer-events:none;color:hsl(var(--muted-foreground))}
.agr-editor-v2 .tiptap .agr-token{border-radius:4px;padding:0 1px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.agr-editor-v2 .tiptap .agr-token[data-token=variable]{background:hsl(var(--primary) / .1);color:hsl(var(--primary))}
.agr-editor-v2 .tiptap .agr-token[data-token=logic]{background:hsl(var(--muted));color:hsl(var(--muted-foreground))}
.agr-editor-v2 .tiptap .agr-token[data-token=field]{border:1.5px dashed currentColor;padding:0 3px;font-weight:600}
.agr-editor-v2 .tiptap .agr-token[data-field=signature]{color:#4f46e5;background:#eef2ff}
.agr-editor-v2 .tiptap .agr-token[data-field=initials]{color:#b45309;background:#fffbeb}
.agr-editor-v2 .tiptap .agr-token[data-field=date]{color:#1d4ed8;background:#eff6ff}
.agr-editor-v2 .tiptap .agr-token[data-token=field-unknown]{color:#b91c1c;background:#fef2f2}
`;

export function AgreementEditorV2(props: AgreementEditorV2Props) {
  // Closing is always asked for from inside (Cancel, Escape), where the
  // unsaved-changes guard runs; Radix never closes it on its own.
  return <Dialog open={props.open}>{props.open ? <EditorWorkspace {...props} /> : null}</Dialog>;
}

function EditorWorkspace({
  onClose,
  mode,
  initialName,
  initialContent,
  previewData,
  onSave,
  saveLabel,
  nameEditable = false,
  previewBanner,
  isDefaultTemplate = false,
  previewTransform,
}: AgreementEditorV2Props) {
  // An empty agreement ("Create new", or a template with no wording yet)
  // starts from the starter: a title, an opening line and the signatures
  // section, company side first (./starter-content). It must be edited
  // before it can be used.
  const [seeded] = useState(() => isBlankAgreementHtml(initialContent ?? ""));
  const startingContent = seeded ? AGREEMENT_STARTER_V2 : initialContent ?? "";
  const [name, setName] = useState(initialName ?? "");
  const [content, setContent] = useState(startingContent);
  // The editor's own serialisation of `initialContent`, taken once it has
  // loaded. Dirty means "differs from THIS", so loading a template (which
  // normalises its markup) is not an edit, and undoing back to it is clean.
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [askClose, setAskClose] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<SidePanelTabV2>("variables");
  const [phoneView, setPhoneView] = useState<"edit" | "preview">("edit");
  const focusedOnce = useRef(false);
  const mounted = useRef(true);
  const panelId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const extensions = useMemo(() => createAgreementEditorExtensions(), []);
  const editor = useEditor({
    extensions,
    content: startingContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Agreement text",
        spellcheck: "true",
      },
    },
    onCreate: ({ editor: e }) => {
      e.commands.focus("start");
    },
    onUpdate: ({ editor: e }) => setContent(e.getHTML()),
    onFocus: () => {
      focusedOnce.current = true;
    },
  });

  // The baseline is taken the moment the editor exists, in the same commit
  // that first hands it to the panel and toolbar, so no insert can land
  // before it (Tiptap's own `onCreate` fires a tick later).
  const baselineTaken = useRef(false);
  useEffect(() => {
    if (!editor || baselineTaken.current) return;
    baselineTaken.current = true;
    const html = editor.getHTML();
    setBaseline(html);
    setContent(html);
  }, [editor]);

  const trimmedName = name.trim();
  const nameChanged = nameEditable && trimmedName !== (initialName ?? "").trim();
  const contentChanged = baseline !== null && comparable(content) !== comparable(baseline);
  const dirty = contentChanged || nameChanged;
  const blank = baseline !== null && isBlankAgreementHtml(content);
  const nameMissing = nameEditable && trimmedName === "";
  // Each signer field once: the send path defines each tag once, for signer 1,
  // and a repeated one can confuse the signing service. Blocks Save, with why.
  const duplicateReason = useMemo(() => duplicateSignerFieldsReasonV2(content), [content]);
  // A one-off edit may be used as it is (the operator opened it to look);
  // saving a template with nothing changed would only rewrite it, and the
  // starter is not an agreement until someone has written in it.
  const canSave =
    baseline !== null && !saving && !blank && !nameMissing && !duplicateReason && ((mode === "one-off" && !seeded) || dirty);

  const save = useCallback(async (): Promise<boolean> => {
    if (!canSave) return false;
    setSaving(true);
    setSaveError(null);
    // Unchanged content goes back exactly as it came in, not re-serialised:
    // a rename must not rewrite a template's markup.
    const contentToSave = contentChanged || seeded ? content : initialContent ?? content;
    try {
      await onSave(contentToSave, nameEditable ? trimmedName : initialName ?? "");
    } catch (e) {
      if (mounted.current) {
        setSaveError(errorMessage(e));
        setSaving(false);
      }
      return false;
    }
    if (mounted.current) {
      setSaving(false);
      setBaseline(content);
    }
    onClose();
    return true;
  }, [canSave, contentChanged, seeded, content, initialContent, onSave, nameEditable, trimmedName, initialName, onClose]);

  const guard = useUnsavedChangesWarning({ hasChanges: dirty && !saving, onSave: save });

  const requestClose = () => {
    if (saving) return;
    if (dirty) setAskClose(true);
    else onClose();
  };

  const afterInsert = () => {
    if (typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches) setPhoneView("edit");
  };

  const insertText = (token: string) => {
    if (!editor) return;
    const chain = editor.chain();
    (focusedOnce.current ? chain.focus() : chain.focus("end")).insertContent(token).run();
    afterInsert();
  };

  /**
   * The operator's signature at the cursor. Returns why it was not put there:
   * inside a table cell or a list item both PDF renderers drop it, so it is
   * refused there (the command itself refuses; this says why).
   */
  const insertSignature = (src: string): string | null => {
    if (!editor) return "The editor is still loading. Try again in a moment.";
    const chain = editor.chain();
    const inserted = (focusedOnce.current ? chain.focus() : chain.focus("end")).insertOperatorSignature(src).run();
    if (!inserted) {
      return isInsideTableOrList(editor.state.selection) ? SIGNATURE_PLACEMENT_REASON : "The signature could not be added there.";
    }
    afterInsert();
    return null;
  };

  const debounced = useDebouncedValue(content, PREVIEW_DEBOUNCE_MS);
  // One-off edits are individual agreements: nothing supplies the rental
  // variables, so they are highlighted as blanks rather than silently dropped.
  const previewHtml = useMemo(
    () =>
      renderAgreementHtml(previewTransform ? previewTransform(debounced) : debounced, previewData ?? {}, {
        mode: "preview",
        markMissing: mode === "one-off",
      }),
    [debounced, previewData, mode, previewTransform],
  );

  const hint = mode === "template" && isDefaultTemplate ? DEFAULT_TEMPLATE_HINT_V2 : EDITOR_MODE_HINT_V2[mode];
  const duplicateReasonId = useId();
  const label = saveLabel ?? DEFAULT_SAVE_LABEL[mode];
  const title = trimmedName || (nameEditable ? "Untitled template" : "Agreement");

  return (
    <DialogPortal>
      <DialogPrimitive.Content
        data-slot="agreement-editor-v2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          if (panelOpen) setPanelOpen(false);
          else requestClose();
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="agr-editor-v2 fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-background text-foreground outline-none"
      >
        <style>{EDITOR_CSS}</style>
        <TooltipProvider delayDuration={300}>
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
              {nameEditable ? (
                <>
                  <DialogTitle className="sr-only">{`Edit ${title}`}</DialogTitle>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="Template name"
                    aria-invalid={nameMissing || undefined}
                    placeholder="Name this template"
                    maxLength={120}
                    className="h-9 max-w-md font-heading text-base font-semibold"
                  />
                </>
              ) : (
                <DialogTitle className="truncate font-heading text-lg font-semibold tracking-tight text-foreground">{title}</DialogTitle>
              )}
              <DialogDescription className={cn("text-sm text-muted-foreground", !hint && "sr-only")}>
                {hint ?? "Edit the agreement on the left. The preview shows the page the signer gets."}
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty && !saving && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>}
              {duplicateReason && (
                <p
                  id={duplicateReasonId}
                  role="alert"
                  data-slot="duplicate-signer-fields"
                  className="flex max-w-sm items-start gap-1.5 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>{duplicateReason}</span>
                </p>
              )}
              <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={!canSave}
                aria-describedby={duplicateReason ? duplicateReasonId : undefined}
              >
                {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
                {saving ? "Saving…" : label}
              </Button>
            </div>
            {(saveError || blank || nameMissing) && (
              <div className="flex basis-full flex-col gap-1">
                {saveError && (
                  <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>Not saved. {saveError}</span>
                  </p>
                )}
                {blank && <p className="text-xs text-muted-foreground">The agreement is empty. Add some wording to save it.</p>}
                {nameMissing && <p className="text-xs text-destructive">Give the template a name.</p>}
              </div>
            )}
          </header>

          {/* Phones: one half at a time. */}
          <div className="flex border-b border-border px-4 py-2 md:hidden" role="group" aria-label="Show">
            <div className="inline-flex rounded-full bg-muted p-1">
              {(["edit", "preview"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={phoneView === view}
                  onClick={() => setPhoneView(view)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-muted-foreground",
                    phoneView === view && "bg-background text-foreground",
                  )}
                >
                  {view === "edit" ? <PenLine className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  {view === "edit" ? "Edit" : "Preview"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            <section
              aria-label="Edit the agreement"
              className={cn("min-h-0 flex-col border-border md:flex md:border-r", phoneView === "edit" ? "flex" : "hidden")}
            >
              <EditorToolbarV2 editor={editor} />
              <div
                className="min-h-0 flex-1 overflow-y-auto"
                onMouseDown={(e) => {
                  // A click in the empty space under the text puts the cursor at the end.
                  if (e.target === e.currentTarget && editor) {
                    e.preventDefault();
                    editor.commands.focus("end");
                  }
                }}
              >
                <EditorContent editor={editor} className="h-full" />
              </div>
            </section>

            <section
              aria-label="Preview"
              className={cn("relative min-h-0 flex-col overflow-hidden md:flex", phoneView === "preview" ? "flex" : "hidden")}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Eye className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium text-foreground">Preview</span>
                  <span className="truncate text-xs text-muted-foreground">{PREVIEW_SOURCE[mode]}</span>
                </div>
                <Button
                  type="button"
                  variant={panelOpen ? "secondary" : "outline"}
                  size="sm"
                  aria-expanded={panelOpen}
                  aria-controls={panelId}
                  onClick={() => setPanelOpen((o) => !o)}
                >
                  {panelOpen ? <PanelRightClose data-icon="inline-start" /> : <PanelRightOpen data-icon="inline-start" />}
                  Fields &amp; variables
                </Button>
              </div>
              <AgreementPreviewV2 html={previewHtml} banner={previewBanner} className="min-h-0 flex-1" />
              <EditorSidePanelV2
                id={panelId}
                open={panelOpen}
                onClose={() => setPanelOpen(false)}
                content={content}
                onInsertText={insertText}
                onInsertSignature={insertSignature}
                tab={panelTab}
                onTabChange={setPanelTab}
              />
            </section>
          </div>
        </TooltipProvider>

        <UnsavedChangesDialog
          open={askClose || guard.isDialogOpen}
          onCancel={() => (askClose ? setAskClose(false) : guard.cancelLeave())}
          onDiscard={() => {
            if (askClose) {
              setAskClose(false);
              onClose();
            } else guard.confirmLeave();
          }}
          onSave={() => {
            if (askClose) {
              setAskClose(false);
              void save();
            } else void guard.saveAndLeave();
          }}
          isSaving={saving || guard.isSaving}
          error={saveError ? <p className="text-sm text-destructive">Not saved. {saveError}</p> : undefined}
        />
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
