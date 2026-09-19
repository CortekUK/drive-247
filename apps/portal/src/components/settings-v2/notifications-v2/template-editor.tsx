"use client";

/**
 * Notifications v2: the email body editor (build-spec D17; transcript 11:23 and
 * 13:50 — "a Notion-like editor… good quality, but it must not get heavy").
 *
 * Replaces the toolbar WYSIWYG (`components/settings/tiptap-editor.tsx`, left
 * untouched for v1) with block editing:
 *   - no toolbar; type "/" at the start of a line for the block menu (Text,
 *     Heading, Subheading, lists, Quote, Divider, Button, Variable);
 *   - select text for the bubble: Bold, Italic, Underline, Link, Turn into;
 *   - variables are chips, typed with "{{" or picked from Insert variable;
 *   - a Button block is a call-to-action link; its panel sets where it goes.
 * The HTML it produces is described in `editor-extensions.ts` and types.ts.
 *
 * DIRTY STATE (the lead's save flow, D11): loading a value never calls
 * onChange — not on mount, not when the parent swaps the value (Reset, another
 * notification) — and an edit that ends up back where the template started
 * reports the ORIGINAL string, so the page's diff sees no change.
 *
 * WEIGHT: the page loads this file with next/dynamic (hence the default
 * export). It uses only Tiptap packages portal already ships, and no React
 * node views: chips and buttons are plain DOM.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { TextSelection } from "@tiptap/pm/state";
import type { LucideIcon } from "lucide-react";
import {
  Bold,
  Braces,
  Check,
  ChevronDown,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  Underline as UnderlineIcon,
  Unlink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { cn } from "@/lib/utils";
import type { NotificationVariable } from "@/lib/notifications-v2/types";
import {
  DEFAULT_EDITOR_PLACEHOLDER,
  SLASH_COMMANDS,
  TURN_INTO_COMMANDS,
  activeBlockId,
  applyBlockCommand,
  createNotificationEditorExtensions,
  dismissSuggestion,
  emailButtonAt,
  filterSlashCommands,
  filterVariables,
  insertVariable,
  normaliseLinkHref,
  serializeEditorHtml,
  setEmailButtonHref,
  setLinkHref,
  suggestionPluginKey,
  wrapKnownVariables,
  type EditorMenuHandlers,
  type SlashCommandId,
  type SuggestionKind,
} from "./editor-extensions";
import { InsertVariableMenu } from "./variable-text-input";

/* -------------------------------------------------------------------------- */
/* Look                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The writing area. Prose-like spacing via descendant selectors (no
 * typography plugin); headings get explicit sizes because the v2 theme's bare
 * h2/h3 defaults are 32/24px. Placeholders: the empty-editor one always shows,
 * the per-line "Type / for blocks" only while the editor has focus.
 */
export const EDITOR_CONTENT_CLASS = [
  "min-h-[220px] px-4 py-3 text-sm leading-relaxed text-foreground outline-none",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-2",
  "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:tracking-tight",
  "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-heading [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-snug",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 [&_li>p]:my-0",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-[hsl(var(--v2-link,var(--primary)))]",
  "[&_[data-variable].ProseMirror-selectednode]:ring-2 [&_[data-variable].ProseMirror-selectednode]:ring-ring/50",
  "[&_hr.ProseMirror-selectednode]:border-ring",
  "[&_.ProseMirror-selectednode_[data-button-label]]:ring-2 [&_.ProseMirror-selectednode_[data-button-label]]:ring-ring/50",
  "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground [&_.is-empty]:before:content-[attr(data-placeholder)]",
  "[&:not(.ProseMirror-focused)_.is-empty:not(.is-editor-empty)]:before:hidden",
].join(" ");

/** A floating panel, as ui-v2 popovers look. */
const FLOATING = "rounded-3xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10";
const HOVER = "hover:bg-[hsl(var(--v2-hover,var(--muted)))]";
const ACTIVE = "bg-[hsl(var(--v2-hover,var(--muted)))] text-foreground";

const COMMAND_ICONS: Record<SlashCommandId, LucideIcon> = {
  text: Pilcrow,
  heading: Heading2,
  subheading: Heading3,
  bullet_list: List,
  numbered_list: ListOrdered,
  quote: Quote,
  divider: Minus,
  button: RectangleHorizontal,
  variable: Braces,
};

const MENU_WIDTH = 272;

/** Keeps the caret in the editor when a menu button is pressed. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface NotificationTemplateEditorProps {
  /** The stored body HTML (see types.ts EmailTemplate). */
  value: string;
  /** Called only for the operator's own edits, never for a load. */
  onChange: (html: string) => void;
  /** The variables this notification may use; only these become chips. */
  variables: NotificationVariable[];
  placeholder?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                  */
/* -------------------------------------------------------------------------- */

export function NotificationTemplateEditor({
  value,
  onChange,
  variables,
  placeholder = DEFAULT_EDITOR_PLACEHOLDER,
  readOnly = false,
  ariaLabel = "Email message",
  className,
}: NotificationTemplateEditorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const variablesRef = useRef(variables);
  variablesRef.current = variables ?? [];
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const ariaLabelRef = useRef(ariaLabel);
  ariaLabelRef.current = ariaLabel;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const handlersRef = useRef<EditorMenuHandlers>({});

  /** The latest value we know the parent holds: the prop, or what we last sent. */
  const lastValueRef = useRef<string>(value ?? "");
  /** The value as loaded, and how the editor serialises it (see DIRTY STATE). */
  const baselineRef = useRef<{ raw: string; html: string } | null>(null);
  const focusedOnceRef = useRef(false);

  const isKnown = useCallback((key: string) => variablesRef.current.some((v) => v.key === key), []);
  const [initialContent] = useState(() => wrapKnownVariables(value ?? "", isKnown));

  const extensions = useMemo(
    () =>
      createNotificationEditorExtensions({
        placeholder: () => placeholderRef.current,
        getVariableLabel: (key) => variablesRef.current.find((v) => v.key === key)?.label ?? key,
        isKnownVariable: isKnown,
        handlers: handlersRef,
      }),
    [isKnown],
  );

  const editorProps = useMemo(
    () => ({
      attributes: (): Record<string, string> => ({
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabelRef.current,
        "aria-readonly": readOnlyRef.current ? "true" : "false",
        class: EDITOR_CONTENT_CLASS,
      }),
    }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onFocus: () => {
      focusedOnceRef.current = true;
    },
    onUpdate: ({ editor: e }) => {
      const html = serializeEditorHtml(e);
      const base = baselineRef.current;
      // Back to exactly what was loaded: report the loaded string, not the
      // editor's spelling of it, so the page sees "unchanged".
      const next = base && html === base.html ? base.raw : html;
      if (next === lastValueRef.current) return;
      lastValueRef.current = next;
      onChangeRef.current(next);
    },
  });

  // Loads the value on first render and whenever the parent swaps it — silently.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = value ?? "";
    if (baselineRef.current && incoming === lastValueRef.current) return; // our own edit coming back
    lastValueRef.current = incoming;
    if (serializeEditorHtml(editor) !== incoming) {
      editor
        .chain()
        .setMeta("addToHistory", false)
        .setContent(wrapKnownVariables(incoming, isKnown), { emitUpdate: false })
        .run();
    }
    baselineRef.current = { raw: incoming, html: serializeEditorHtml(editor) };
  }, [editor, value, isKnown]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed) return null;
      const s = suggestionPluginKey.getState(e.state);
      const button = emailButtonAt(e.state);
      return {
        focused: e.isFocused,
        suggestion: s?.active ? { kind: s.kind as SuggestionKind, query: s.query, from: s.from, to: s.to } : null,
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        link: e.isActive("link"),
        linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
        block: activeBlockId(e.state),
        buttonHref: button ? ((button.node.attrs.href as string | null) ?? "") : null,
        buttonPos: button ? button.pos : null,
      };
    },
  });

  /* ---------------------------- "/" and "{{" menu --------------------------- */

  const suggestion = ui?.suggestion ?? null;
  const suggestionKind = suggestion?.kind ?? null;
  const suggestionQuery = suggestion?.query ?? "";
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!suggestionKind) return [];
    if (suggestionKind === "slash") {
      return filterSlashCommands(suggestionQuery).map((c) => ({
        type: "command" as const,
        id: c.id,
        title: c.title,
        detail: c.description,
        icon: COMMAND_ICONS[c.id],
      }));
    }
    return filterVariables(variables ?? [], suggestionQuery).map((v) => ({
      type: "variable" as const,
      id: v.key,
      title: v.label,
      detail: `{{${v.key}}}`,
    }));
  }, [suggestionKind, suggestionQuery, variables]);

  const menuOpen = !!suggestion && !readOnly && !!ui?.focused && menuItems.length > 0;
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestionFrom = suggestion?.from ?? -1;
  useEffect(() => {
    setActiveIndex(0);
  }, [suggestionKind, suggestionQuery, suggestionFrom]);

  const pick = (item: MenuItem | undefined) => {
    if (!editor || !suggestion || !item) return;
    const range = { from: suggestion.from, to: suggestion.to };
    if (item.type === "variable") insertVariable(editor, item.id, range);
    else applyBlockCommand(editor, item.id, range);
  };

  /* ------------------------------ Link editing ----------------------------- */

  const [linkEditing, setLinkEditing] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);

  const startLink = () => {
    setLinkDraft(ui?.linkHref ?? "");
    setLinkError(null);
    setTurnIntoOpen(false);
    setLinkEditing(true);
  };
  const closeLink = (refocus: boolean) => {
    setLinkEditing(false);
    setLinkError(null);
    if (refocus) editor?.commands.focus();
  };
  const applyLink = () => {
    if (!editor) return;
    const href = normaliseLinkHref(linkDraft);
    if (href === null) {
      setLinkError("Use a web address (https://…), an email address, or a link variable such as {{payment_url}}.");
      return;
    }
    setLinkHref(editor, href);
    closeLink(false);
  };

  // Read at key-press time by the editor's plugin (see editor-extensions).
  handlersRef.current = {
    onSuggestionKeyDown: (event) => {
      if (!menuOpen || !editor) return false;
      const n = menuItems.length;
      switch (event.key) {
        case "ArrowDown":
          setActiveIndex((i) => (i + 1) % n);
          return true;
        case "ArrowUp":
          setActiveIndex((i) => (i - 1 + n) % n);
          return true;
        case "Enter":
        case "Tab":
          pick(menuItems[Math.min(activeIndex, n - 1)]);
          return true;
        case "Escape":
          dismissSuggestion(editor);
          return true;
        default:
          return false;
      }
    },
    onLinkShortcut: () => {
      if (!editor || !editor.isEditable || editor.state.selection.empty || emailButtonAt(editor.state)) return false;
      startLink();
      return true;
    },
  };

  const onFormatHideRef = useRef<() => void>(() => undefined);
  onFormatHideRef.current = () => {
    setLinkEditing(false);
    setLinkError(null);
    setTurnIntoOpen(false);
  };

  /* ------------------------------ Bubble menus ----------------------------- */

  const bubbleOptions = useMemo(
    () => ({ placement: "top" as const, offset: 8, onHide: () => onFormatHideRef.current() }),
    [],
  );
  const buttonBubbleOptions = useMemo(() => ({ placement: "bottom-start" as const, offset: 8 }), []);

  const shouldShowFormat = useCallback(
    ({ editor: e, view, state, from, to, element }: BubbleArgs) => {
      if (!e.isEditable) return false;
      if (!view.hasFocus() && !element.contains(document.activeElement)) return false;
      if (state.selection.empty || !(state.selection instanceof TextSelection)) return false;
      if (!state.doc.textBetween(from, to, " ", "\ufffc").trim()) return false;
      return !emailButtonAt(state);
    },
    [],
  );

  const shouldShowButton = useCallback(
    ({ editor: e, view, state, element }: BubbleArgs) =>
      e.isEditable && (view.hasFocus() || element.contains(document.activeElement)) && !!emailButtonAt(state),
    [],
  );

  const buttonAnchor = useCallback(() => {
    if (!editor || editor.isDestroyed) return null;
    const found = emailButtonAt(editor.state);
    if (!found) return null;
    const dom = editor.view.nodeDOM(found.pos) as HTMLElement | null;
    const target = (dom?.querySelector?.("[data-button-label]") as HTMLElement | null) ?? dom;
    if (!target) return null;
    return {
      getBoundingClientRect: () => target.getBoundingClientRect(),
      getClientRects: () => [target.getBoundingClientRect()],
    };
  }, [editor]);

  const raiseMenu = useCallback((el: HTMLDivElement | null) => {
    if (el) el.style.zIndex = "50";
  }, []);

  /* ----------------------------- Insert variable --------------------------- */

  const insertFromMenu = (key: string) => {
    if (!editor) return;
    if (!focusedOnceRef.current) editor.commands.focus("end");
    insertVariable(editor, key);
  };

  /** A click under the last block: give the operator a line to type on. */
  const focusEnd = () => {
    if (!editor || !editor.isEditable) return;
    const last = editor.state.doc.lastChild;
    if (last && last.type.name !== "paragraph") {
      editor.chain().insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).focus("end").run();
    } else {
      editor.commands.focus("end");
    }
  };

  const editable = !!editor && !readOnly;

  return (
    <div
      ref={surfaceRef}
      data-notification-editor=""
      className={cn(
        "relative rounded-xl border bg-card transition-[border-color,box-shadow]",
        !readOnly && "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        className,
      )}
    >
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="min-h-[220px]" aria-busy="true" aria-label={ariaLabel} />
      )}

      {editable && (
        <div
          aria-hidden="true"
          className="h-4 cursor-text"
          onMouseDown={(e) => {
            e.preventDefault();
            focusEnd();
          }}
        />
      )}

      {editor && !readOnly && menuOpen && suggestion && (
        <SuggestionMenu
          editor={editor}
          containerRef={surfaceRef}
          kind={suggestion.kind}
          from={suggestion.from}
          items={menuItems}
          activeIndex={Math.min(activeIndex, menuItems.length - 1)}
          onHover={setActiveIndex}
          onPick={pick}
        />
      )}

      {editor && !readOnly && (
        <BubbleMenu
          ref={raiseMenu}
          editor={editor}
          pluginKey="notificationFormatBubble"
          shouldShow={shouldShowFormat}
          options={bubbleOptions}
        >
          <div role="toolbar" aria-label="Format text" className={cn(FLOATING, "overflow-hidden")}>
            {linkEditing ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-1 p-1.5">
                  <Input
                    autoFocus
                    aria-label="Link address"
                    value={linkDraft}
                    onChange={(e) => {
                      setLinkDraft(e.target.value);
                      setLinkError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyLink();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeLink(true);
                      }
                    }}
                    placeholder="Paste a link"
                    aria-invalid={!!linkError || undefined}
                    className="h-8 w-60 text-sm"
                  />
                  <BubbleButton label="Apply link" onClick={applyLink}>
                    <Check />
                  </BubbleButton>
                  {ui?.link && (
                    <BubbleButton
                      label="Remove link"
                      onClick={() => {
                        if (editor) setLinkHref(editor, "");
                        closeLink(false);
                      }}
                    >
                      <Unlink />
                    </BubbleButton>
                  )}
                  <BubbleButton label="Cancel" onClick={() => closeLink(true)}>
                    <X />
                  </BubbleButton>
                </div>
                {linkError && (
                  <p role="alert" className="max-w-[20rem] px-3 pb-2 text-xs text-amber-700 dark:text-amber-400">
                    {linkError}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-0.5 p-1">
                  <BubbleButton
                    label="Turn into"
                    ariaLabel={`Turn into another block (now ${blockLabel(ui?.block)})`}
                    wide
                    aria-expanded={turnIntoOpen}
                    onClick={() => setTurnIntoOpen((o) => !o)}
                  >
                    <span className="text-[13px]">{blockLabel(ui?.block)}</span>
                    <ChevronDown className="size-3.5 opacity-60" />
                  </BubbleButton>
                  <Separator />
                  <BubbleButton label="Bold" shortcut="B" pressed={!!ui?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
                    <Bold />
                  </BubbleButton>
                  <BubbleButton label="Italic" shortcut="I" pressed={!!ui?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
                    <Italic />
                  </BubbleButton>
                  <BubbleButton
                    label="Underline"
                    shortcut="U"
                    pressed={!!ui?.underline}
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                  >
                    <UnderlineIcon />
                  </BubbleButton>
                  <Separator />
                  <BubbleButton label={ui?.link ? "Edit link" : "Add link"} shortcut="K" pressed={!!ui?.link} onClick={startLink}>
                    <LinkIcon />
                  </BubbleButton>
                </div>
                {turnIntoOpen && (
                  <div role="menu" aria-label="Turn into" className="border-t p-1">
                    {TURN_INTO_COMMANDS.map((c) => {
                      const Icon = COMMAND_ICONS[c.id];
                      const current = ui?.block === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={current}
                          onMouseDown={keepFocus}
                          onClick={() => {
                            applyBlockCommand(editor, c.id);
                            setTurnIntoOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left text-[13px]",
                            HOVER,
                            current && ACTIVE,
                          )}
                        >
                          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span className="flex-1">{c.title}</span>
                          {current && <Check className="size-3.5" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </BubbleMenu>
      )}

      {editor && !readOnly && (
        <BubbleMenu
          ref={raiseMenu}
          editor={editor}
          pluginKey="notificationButtonBubble"
          shouldShow={shouldShowButton}
          getReferencedVirtualElement={buttonAnchor}
          options={buttonBubbleOptions}
        >
          <ButtonLinkPanel
            editor={editor}
            href={ui?.buttonHref ?? null}
            nodePos={ui?.buttonPos ?? null}
            variables={variables ?? []}
          />
        </BubbleMenu>
      )}

      {!readOnly && (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Type <kbd className="rounded bg-muted px-1 font-mono text-[11px]">/</kbd> for blocks, or{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[11px]">{"{{"}</kbd> for a variable
          </p>
          <InsertVariableMenu
            variables={variables ?? []}
            onPick={insertFromMenu}
            disabled={!editor}
            fieldLabel={ariaLabel}
            className="-mr-2 shrink-0"
          />
        </div>
      )}
    </div>
  );
}

export default NotificationTemplateEditor;

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

type BubbleArgs = {
  editor: Editor;
  view: Editor["view"];
  state: Editor["state"];
  from: number;
  to: number;
  element: HTMLElement;
};

type MenuItem =
  | { type: "command"; id: SlashCommandId; title: string; detail: string; icon: LucideIcon }
  | { type: "variable"; id: string; title: string; detail: string };

function blockLabel(id: string | null | undefined): string {
  return SLASH_COMMANDS.find((c) => c.id === id)?.title ?? "Text";
}

function Separator() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />;
}

function BubbleButton({
  label,
  ariaLabel,
  shortcut,
  pressed,
  wide,
  onClick,
  children,
  ...rest
}: {
  label: string;
  /** When the visible text is not the name (the "Turn into" button shows the block type). */
  ariaLabel?: string;
  shortcut?: string;
  pressed?: boolean;
  wide?: boolean;
  onClick: () => void;
  children: ReactNode;
  "aria-expanded"?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={wide ? "sm" : "icon-sm"}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={shortcut ? `${label} (Ctrl+${shortcut})` : label}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn("rounded-full", wide && "gap-1 px-2.5 font-normal", pressed && ACTIVE)}
      {...rest}
    >
      {children}
    </Button>
  );
}

/**
 * The block menu or variable picker, at the caret. Positioned inside the
 * editor's own box (not a portal), so it scrolls with it and never fights a
 * surrounding dialog's focus trap; it flips above the line near the bottom of
 * the window.
 */
function SuggestionMenu({
  editor,
  containerRef,
  kind,
  from,
  items,
  activeIndex,
  onHover,
  onPick,
}: {
  editor: Editor;
  containerRef: RefObject<HTMLDivElement | null>;
  kind: SuggestionKind;
  from: number;
  items: MenuItem[];
  activeIndex: number;
  onHover: (i: number) => void;
  onPick: (item: MenuItem) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      let caret = { top: box.top, bottom: box.top, left: box.left };
      try {
        caret = editor.view.coordsAtPos(Math.min(from, editor.state.doc.content.size));
      } catch {
        // No layout (tests, a hidden tab): keep the top-left of the editor.
      }
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - caret.bottom;
      const above = height > 0 && below < height + 12 && caret.top - box.top > height;
      const left = Math.max(0, Math.min(caret.left - box.left, box.width - MENU_WIDTH));
      setPos({ top: above ? caret.top - box.top - height - 6 : caret.bottom - box.top + 6, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [editor, containerRef, from, items.length]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Screen readers follow the highlighted row from the editor itself.
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-controls", listId);
    dom.setAttribute("aria-activedescendant", `${listId}-${activeIndex}`);
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [editor, listId, activeIndex]);

  return (
    <div
      ref={menuRef}
      id={listId}
      role="listbox"
      aria-label={kind === "slash" ? "Blocks" : "Variables"}
      data-suggestion-menu={kind}
      onMouseDown={keepFocus}
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
      className={cn(FLOATING, "absolute z-50 max-h-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5")}
    >
      <p className="px-3 pb-1 pt-1.5 text-xs text-muted-foreground">{kind === "slash" ? "Blocks" : "Variables"}</p>
      {items.map((item, i) => {
        const Icon = item.type === "command" ? item.icon : Braces;
        return (
          <div
            key={`${item.type}-${item.id}`}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(item)}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-1.5", i === activeIndex && ACTIVE)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{item.title}</span>
              <span className={cn("block truncate text-xs text-muted-foreground", item.type === "variable" && "font-mono")}>
                {item.detail}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Where a Button block goes: a web address, or one of the notification's link
 * variables (the payment link, the customer portal…). Shown under the button
 * while the caret is in it.
 */
function ButtonLinkPanel({
  editor,
  href,
  nodePos,
  variables,
}: {
  editor: Editor;
  href: string | null;
  nodePos: number | null;
  variables: NotificationVariable[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(href ?? "");
  const [error, setError] = useState<string | null>(null);
  const linkVariables = useMemo(() => variables.filter((v) => v.group === "links"), [variables]);

  // Another button, or a change from elsewhere: show its link, unless the operator is typing.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(href ?? "");
    setError(null);
  }, [href, nodePos]);

  if (href === null) return null;

  const commit = (raw: string): boolean => {
    const next = normaliseLinkHref(raw);
    if (next === null) {
      setError("Use a web address (https://…) or pick a link below.");
      return false;
    }
    setError(null);
    setDraft(next);
    if (next !== href) setEmailButtonHref(editor, next);
    return true;
  };

  return (
    <div className={cn(FLOATING, "w-72 space-y-2.5 p-3")} role="group" aria-label="Button link">
      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
          Button link
        </label>
        <Input
          ref={inputRef}
          id={inputId}
          value={draft}
          placeholder="https://"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (commit(draft)) editor.commands.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(href);
              setError(null);
              editor.commands.focus();
            }
          }}
          className="h-8 text-sm"
        />
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : !href ? (
          <p className="text-xs text-muted-foreground">A button needs a link before this email is sent.</p>
        ) : null}
      </div>
      {linkVariables.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Or use a link from this notification</p>
          <div className="flex flex-wrap gap-1">
            {linkVariables.map((v) => {
              const token = `{{${v.key}}}`;
              const selected = href === token;
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={selected}
                  title={v.description}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    setEmailButtonHref(editor, token);
                    setDraft(token);
                    setError(null);
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs",
                    selected
                      ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                      : cn("bg-muted text-foreground", HOVER),
                  )}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="xs" onMouseDown={keepFocus} onClick={() => applyBlockCommand(editor, "text")}>
          Turn into text
        </Button>
      </div>
    </div>
  );
}
