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
import { AlertTriangle, Eye, FileText, Loader2, PanelRightClose, PanelRightOpen, PenLine, Save, X } from "lucide-react";
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
import { SelectionBarV2, SlashMenuV2 } from "./slash-menu-v2";
import { EditorSidePanelV2, type SidePanelTabV2 } from "./editor-side-panel-v2";
import { AGREEMENT_STARTER_V2, duplicateSignerFieldsReasonV2 } from "./starter-content";
import { TraxIcon } from "@/components/chat/TraxIcon";
import { TraxAgreementPane } from "@/components/agreements-v2/trax-studio/trax-agreement-pane";
import { AgreementOutlinePane, type OutlineSection } from "@/components/agreements-v2/trax-studio/agreement-outline-pane";
import { DockTip, SigningDockV2 } from "@/components/agreements-v2/trax-studio/signing-dock-v2";
import { createTraxWritingPlugin, traxWritingKey } from "@/components/agreements-v2/trax-studio/live-writer";

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
  /**
   * The Trax studio layout: Trax on the left (it writes into the document
   * live), the document in the middle (Preview or Edit), the pages on the
   * right. Off, the editor is the half-and-half layout it has always been.
   */
  trax?: boolean;
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
.agr-editor-v2.agr-studio .tiptap{padding-top:19px}
.agr-editor-v2.agr-studio .agr-preview-v2 .agr-sheet{padding-top:calc(var(--pt) * 20)}
.agr-editor-v2.agr-studio .agr-preview-v2 .agr-doc:first-child > :first-child{padding-top:0;margin-top:0}
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
.agr-editor-v2 .tiptap .agr-token[data-token=variable]{background:hsl(var(--primary) / .1);color:hsl(var(--v2-link, var(--primary)))}
.agr-editor-v2 .tiptap .agr-token[data-token=logic]{background:hsl(var(--muted));color:hsl(var(--muted-foreground))}
.agr-editor-v2 .tiptap .agr-token[data-token=field]{border:1.5px dashed currentColor;padding:0 3px;font-weight:600}
.agr-editor-v2 .tiptap .agr-token[data-field=signature]{color:hsl(var(--v2-link, var(--primary)));background:hsl(var(--primary) / .1)}
.agr-editor-v2 .tiptap .agr-token[data-field=initials]{color:#b45309;background:#fffbeb}
.agr-editor-v2 .tiptap .agr-token[data-field=date]{color:#1d4ed8;background:#eff6ff}
.agr-editor-v2 .tiptap .agr-token[data-token=field-unknown]{color:#b91c1c;background:#fef2f2}
.dark .agr-editor-v2 .tiptap .agr-token[data-field=initials]{color:#fbbf24;background:rgb(245 158 11 / .12)}
.dark .agr-editor-v2 .tiptap .agr-token[data-field=date]{color:#93c5fd;background:rgb(59 130 246 / .12)}
.dark .agr-editor-v2 .tiptap .agr-token[data-token=field-unknown]{color:#fca5a5;background:rgb(239 68 68 / .12)}
.agr-editor-v2 .tiptap .trax-writing{background:hsl(var(--primary) / .08);border-radius:2px}
.agr-editor-v2 .trax-caret,.agr-editor-v2 .trax-chat-caret{display:inline-block;width:2px;height:1.1em;margin-left:1px;vertical-align:text-bottom;background:hsl(var(--primary));border-radius:1px;animation:trax-caret-blink 1s steps(2,start) infinite}
.agr-editor-v2 .trax-chat-caret{height:1em}
@keyframes trax-caret-blink{to{visibility:hidden}}
@media (prefers-reduced-motion:reduce){.agr-editor-v2 .trax-caret,.agr-editor-v2 .trax-chat-caret{animation:none}}
`;

/** The studio's two stacked document views: the one shown, and the one fading out behind it. */
const VIEW_SHOWN = "visible opacity-100 [transition:opacity_200ms_ease-out] motion-reduce:transition-none";
const VIEW_HIDDEN =
  "invisible pointer-events-none opacity-0 [transition:opacity_200ms_ease-in,visibility_0s_linear_200ms] motion-reduce:transition-none";

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
  trax = false,
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
  // Studio (`trax`) only.
  const [docView, setDocView] = useState<"preview" | "edit">("preview");
  const [studioPhone, setStudioPhone] = useState<"trax" | "doc" | "pages">("trax");
  const [traxWriting, setTraxWriting] = useState(false);
  const [previewRoot, setPreviewRoot] = useState<HTMLElement | null>(null);
  const editScrollRef = useRef<HTMLDivElement | null>(null);
  const focusedOnce = useRef(false);
  const mounted = useRef(true);
  const panelId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The studio says how to reach everything without a toolbar.
  const extensions = useMemo(
    () => createAgreementEditorExtensions(trax ? { placeholder: "Type / for blocks, signer fields and variables…" } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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

  // A blank name is never an error (Oct 1 2026): the template keeps the name
  // it had, or gets a default, and the field shows it again on leaving.
  const fallbackName = (initialName ?? "").trim() || "Untitled agreement";
  const trimmedName = name.trim() || fallbackName;
  const nameChanged = nameEditable && trimmedName !== (initialName ?? "").trim();
  const contentChanged = baseline !== null && comparable(content) !== comparable(baseline);
  const dirty = contentChanged || nameChanged;
  const blank = baseline !== null && isBlankAgreementHtml(content);
  const nameMissing = false;
  // Each signer field once: the send path defines each tag once, for signer 1,
  // and a repeated one can confuse the signing service. Blocks Save, with why.
  const duplicateReason = useMemo(() => duplicateSignerFieldsReasonV2(content), [content]);
  // A one-off edit may be used as it is (the operator opened it to look);
  // saving a template with nothing changed would only rewrite it, and the
  // starter is not an agreement until someone has written in it.
  const canSave =
    baseline !== null && !saving && !traxWriting && !blank && !nameMissing && !duplicateReason && ((mode === "one-off" && !seeded) || dirty);

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
    if (saving || traxWriting) return;
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

  // The "Trax is writing here" highlight and caret, for the studio only.
  useEffect(() => {
    if (!trax || !editor) return;
    editor.registerPlugin(createTraxWritingPlugin());
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(traxWritingKey);
    };
  }, [trax, editor]);

  /** Trax started or stopped typing: show the page being written, and where. */
  const onTraxWriting = useCallback((writing: boolean) => {
    setTraxWriting(writing);
    if (writing) {
      setDocView("edit");
      setStudioPhone((v) => (v === "pages" ? "doc" : v));
    }
  }, []);

  const jumpTo = useCallback(
    (section: OutlineSection) => {
      setStudioPhone("doc");
      if (docView === "preview") {
        const scroller = previewRoot?.querySelector<HTMLElement>('[data-slot="agreement-preview-v2"]');
        const heading = previewRoot?.querySelectorAll<HTMLElement>('[data-slot="agreement-body"] :is(h1,h2,h3)')[section.index];
        if (scroller && heading) {
          const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
          scroller.scrollTo({ top, behavior: "smooth" });
        }
        return;
      }
      const headings = Array.from(editor?.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3") ?? []);
      const match =
        headings.find((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim() === section.text) ?? headings[section.index];
      match?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [docView, previewRoot, editor],
  );

  /** A page thumbnail: scroll the agreement there, in whichever view is showing. */
  const jumpToPage = useCallback(
    (index: number, pages: number) => {
      setStudioPhone("doc");
      if (docView === "preview") {
        const scroller = previewRoot?.querySelector<HTMLElement>('[data-slot="agreement-preview-v2"]');
        const sheet = previewRoot?.querySelector<HTMLElement>(".agr-sheet");
        if (!scroller || !sheet) return;
        const w = sheet.clientWidth;
        const pageBody = (w * 842) / 595 - ((w * 50) / 595) * 2;
        const sheetTop = sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        scroller.scrollTo({ top: Math.max(0, sheetTop + index * pageBody - 16), behavior: "smooth" });
        return;
      }
      // The editor has no pages: go to the same share of the way down.
      const host = editScrollRef.current;
      if (host) host.scrollTo({ top: (index / Math.max(1, pages)) * host.scrollHeight, behavior: "smooth" });
    },
    [docView, previewRoot],
  );

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

  /* The studio has no top bar (Oct 1 2026): the name, the save state and
     Cancel / Save ride in the agreement column's own header row. */
  // The name heads the left column, where Trax's heading was: big enough to
  // read at a glance, and still a field you can click into and rename.
  // The template's name, as the studio's title: big and bold, wrapping onto a
  // second line rather than cutting off, and still a field you click to rename
  // (Enter finishes). No box until you are in it, and then only a soft one.
  const studioName = (
    <div className="px-2 pt-[19px] pb-1">
      {nameEditable ? (
        <textarea
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\n/g, " "))}
          onBlur={() => {
            if (!name.trim()) setName(fallbackName);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={1}
          aria-label="Template name"
          aria-invalid={nameMissing || undefined}
          placeholder="Name"
          maxLength={120}
          // In the accent, in a rounded box: a soft accent tile with an accent
          // edge that firms up while you type.
          className="block w-full resize-none rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-1.5 font-heading text-base leading-snug font-medium tracking-tight text-primary [field-sizing:content] outline-none placeholder:text-primary/40 transition-colors duration-200 ease-out hover:bg-primary/10 focus-visible:border-primary/40 focus-visible:bg-primary/10 motion-reduce:transition-none dark:border-primary/25 dark:bg-primary/[0.12] dark:text-[hsl(var(--v2-link,var(--primary)))] dark:placeholder:text-[hsl(var(--v2-link,var(--primary))/0.45)]"
        />
      ) : (
        <p className="rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-1.5 font-heading text-base leading-snug font-medium tracking-tight break-words text-primary dark:border-primary/25 dark:bg-primary/[0.12] dark:text-[hsl(var(--v2-link,var(--primary)))]">{title}</p>
      )}
    </div>
  );
  // Cancel and Save live in the signing dock now (Oct 1 2026), one section each
  // end, at the dock's own slot size.
  const studioCancel = (
    <DockTip label="Cancel" hint="Close without saving. You'll be asked first if anything changed.">
    <button
      type="button"
      onClick={requestClose}
      disabled={saving || traxWriting}
      aria-label="Cancel"
      className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-xl text-red-700 transition-colors duration-200 ease-out hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none dark:text-red-400"
    >
      <X className="size-5" strokeWidth={2.4} aria-hidden="true" />
    </button>
    </DockTip>
  );
  const studioSave = (
    <DockTip label={label} hint={canSave ? "Keep your changes to this template." : "Nothing to save yet."}>
    <button
      type="button"
      onClick={() => void save()}
      aria-disabled={!canSave || undefined}
      aria-label={saving ? "Saving…" : label}
      aria-describedby={duplicateReason ? duplicateReasonId : undefined}
      className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-primary transition-colors duration-200 ease-out hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
    >
      {saving ? <Loader2 className="size-[18px] animate-spin" aria-hidden="true" /> : <Save className="size-5" strokeWidth={2.4} aria-hidden="true" />}
    </button>
    </DockTip>
  );
  // One icon for the view: it shows where a click takes you (the eye while
  // editing, the pen while previewing).
  const studioViewToggle = (
    <DockTip
      label={docView === "edit" ? "Preview" : "Edit"}
      hint={docView === "edit" ? "See the agreement as the customer gets it." : "Change the wording yourself. Type / for blocks, fields and variables."}
    >
    <button
      type="button"
      onClick={() => setDocView((v) => (v === "edit" ? "preview" : "edit"))}
      disabled={traxWriting}
      aria-label={docView === "edit" ? "Show the preview" : "Edit the agreement"}
      // The most prominent thing in the dock, without shouting: a solid accent
      // rounded square a touch larger than the slots around it. No glow, no shadow.
      className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none"
    >
      {docView === "edit" ? <Eye className="size-[22px]" aria-hidden="true" /> : <PenLine className="size-[22px]" aria-hidden="true" />}
    </button>
    </DockTip>
  );
  const studioActions = (
    // Cancel and Save side by side, no box behind them: just the two icons,
    // a little stronger in colour and weight so they read on the wash.
    <div className="flex shrink-0 items-center gap-0.5 [&>button]:rounded-lg [&_svg]:size-[18px] [&_svg]:stroke-[2.4]">
      {/* No "Unsaved changes" label: leaving with changes asks in a dialog instead. */}
      {/* Icons only (Oct 1 2026); the words stay as their names and tooltips. */}
      {/* No outlined circle: the cross alone, in red. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        onClick={requestClose}
        disabled={saving || traxWriting}
        aria-label="Cancel"
        title="Cancel"
      >
        <X />
      </Button>
      {/* No filled circle: the icon alone, in the accent. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-primary hover:bg-primary/10 hover:text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] [&_svg]:brightness-90 dark:[&_svg]:brightness-100"
        onClick={() => void save()}
        disabled={!canSave}
        aria-label={saving ? "Saving…" : label}
        title={label}
        aria-describedby={duplicateReason ? duplicateReasonId : undefined}
      >
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
      </Button>
    </div>
  );
  const studioNotices =
    saveError || blank || nameMissing || duplicateReason ? (
      <div className="flex flex-col gap-1 border-b border-border px-4 py-2">
        {saveError && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Not saved. {saveError}</span>
          </p>
        )}
        {duplicateReason && (
          <p id={duplicateReasonId} role="alert" data-slot="duplicate-signer-fields" className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{duplicateReason}</span>
          </p>
        )}
        {blank && <p className="text-xs text-muted-foreground">The agreement is empty. Add some wording to save it.</p>}
        {nameMissing && <p className="text-xs text-destructive">Give the template a name.</p>}
      </div>
    ) : null;

  return (
    <DialogPortal>
      {/* The overlay is what carries Radix's scroll lock. Without one, a
          dialog this editor is opened from (Manage agreement templates) keeps
          ITS lock, which lets the wheel scroll only inside that dialog, so
          nothing in the editor could scroll. With it, this editor holds the
          top lock and everything inside it scrolls. It sits under the
          full-screen content, so it is never seen. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background" />
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
        // The studio wears the app's page wash (bg-app-gradient, styles/v2-theme.css);
        // the half-and-half editor keeps its plain ground.
        className={cn(
          "agr-editor-v2 fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-background text-foreground outline-none",
          trax && "bg-app-gradient agr-studio",
        )}
      >
        <style>{EDITOR_CSS}</style>
        <TooltipProvider delayDuration={300}>
          {trax && (
            <>
              <DialogTitle className="sr-only">{`Edit ${title}`}</DialogTitle>
              <DialogDescription className="sr-only">
                {hint ?? "Trax on the left writes with you; the agreement is in the middle; its pages are on the right."}
              </DialogDescription>
            </>
          )}
          {!trax && (
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
              {nameEditable ? (
                <>
                  <DialogTitle className="sr-only">{`Edit ${title}`}</DialogTitle>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      if (!name.trim()) setName(fallbackName);
                    }}
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
              <Button type="button" variant="outline" onClick={requestClose} disabled={saving || traxWriting}>
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
          )}

          {trax ? (
            <>
              {/* Phones: one pane at a time. */}
              <div className="flex border-b border-border px-4 py-2 lg:hidden" role="group" aria-label="Show">
                <div className="inline-flex rounded-full bg-muted p-1">
                  {(["trax", "doc", "pages"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={studioPhone === view}
                      onClick={() => setStudioPhone(view)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-muted-foreground",
                        studioPhone === view && "bg-background text-foreground",
                      )}
                    >
                      {view === "trax" ? <TraxIcon size={16} /> : view === "doc" ? <PenLine className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
                      {view === "trax" ? "Trax" : view === "doc" ? "Document" : "Pages"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_248px]">
                <div className={cn("min-h-0 flex-col lg:flex", studioPhone === "trax" ? "flex" : "hidden")}>
                  <TraxAgreementPane
                    // No heading over Trax: the template's name heads the Pages sidebar.
                    header={null}
                    editor={editor}
                    templateName={trimmedName || initialName || ""}
                    scrollHost={() => editScrollRef.current}
                    onWritingChange={onTraxWriting}
                  />
                </div>

                <section
                  aria-label="The agreement"
                  className={cn("relative min-h-0 flex-col overflow-hidden lg:flex", studioPhone === "doc" ? "flex" : "hidden")}
                >
                  {studioNotices}

                  <div className="relative min-h-0 flex-1">
                    <div className={cn("absolute inset-0 flex flex-col", docView === "edit" ? VIEW_SHOWN : VIEW_HIDDEN)}>
                      {/* Notion-style: no toolbar. "/" opens blocks, signer fields and
                          variables; selecting text shows a small formatting bar. */}
                      <SlashMenuV2 editor={editor} />
                      <SelectionBarV2 editor={editor} />
                      <div
                        ref={editScrollRef}
                        className={cn("min-h-0 flex-1 overflow-y-auto", traxWriting && "cursor-progress")}
                        onMouseDown={(e) => {
                          if (e.target === e.currentTarget && editor && !traxWriting) {
                            e.preventDefault();
                            editor.commands.focus("end");
                          }
                        }}
                      >
                        <EditorContent editor={editor} className="h-full" />
                      </div>
                    </div>
                    <div ref={setPreviewRoot} className={cn("absolute inset-0 flex", docView === "preview" ? VIEW_SHOWN : VIEW_HIDDEN)}>
                      {/* pb-28: the end of the agreement scrolls clear of the signing dock. */}
                      <AgreementPreviewV2 html={previewHtml} banner={previewBanner} className="min-h-0 flex-1 bg-transparent pb-28 sm:pb-28" />
                    </div>
                    <SigningDockV2
                      leading={
                        <>
                          {studioCancel}
                          {studioViewToggle}
                        </>
                      }
                      trailing={studioSave}
                      tip={
                        docView === "edit" ? (
                          <>
                            Type <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs text-foreground">/</kbd> to add blocks, fields and variables
                          </>
                        ) : (
                          <>
                            In edit, type <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs text-foreground">/</kbd> to add blocks, fields and variables
                          </>
                        )
                      }
                      content={content}
                      hidden={traxWriting}
                      onInsertText={insertText}
                      onFieldDragStart={() => setDocView("edit")}
                      onInsertSignature={insertSignature}
                      className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2"
                    />
                    <EditorSidePanelV2
                      id={panelId}
                      // The studio has no Fields & variables button (Oct 1 2026): signer fields
                      // and your signatures live in the dock, variables come through Trax.
                      open={false}
                      onClose={() => setPanelOpen(false)}
                      content={content}
                      onInsertText={insertText}
                      onInsertSignature={insertSignature}
                      tab={panelTab}
                      onTabChange={setPanelTab}
                    />
                  </div>
                </section>

                <div className={cn("min-h-0 flex-col border-border lg:flex lg:border-l", studioPhone === "pages" ? "flex" : "hidden")}>
                  <AgreementOutlinePane previewRoot={previewRoot} content={debounced} onJumpToPage={jumpToPage} heading={studioName} />
                </div>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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
