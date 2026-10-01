"use client";

/**
 * Agreements v2 — the Notion-style editing in Template Studio (Oct 1 2026):
 * no toolbar across the top. Type "/" for a menu of blocks, signer fields and
 * variables; select text for a small formatting bar.
 *
 * THE SLASH MENU is a tiny ProseMirror plugin of our own (no
 * @tiptap/suggestion in this repo): after every transaction it looks at the
 * text before the cursor in the current block, and a "/" at the start of the
 * block or after a space, followed by up to 30 word characters, opens the
 * menu with that text as the query. Escape closes it until the slash moves.
 * While it is open the plugin hands ↑ ↓ Enter Tab Escape to the menu.
 *
 * Choosing an item deletes the "/query" first, then runs the item, so nothing
 * of the slash is ever left in the agreement.
 *
 * VARIABLES are searchable straight from the slash ("/deposit", "/licence"):
 * the operator does not have to know the catalogue, which was the pain.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  CalendarCheck,
  CaseUpper,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Signature,
  Table,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";
import { SIGNATURE_FIELDS } from "@/lib/agreements-v2/types";

/* -------------------------------------------------------------------------- */
/* The plugin                                                                  */
/* -------------------------------------------------------------------------- */

interface SlashState {
  active: boolean;
  from: number;
  to: number;
  query: string;
  /** The slash position Escape closed; stays closed until the slash moves. */
  dismissed: number | null;
}

const IDLE: SlashState = { active: false, from: 0, to: 0, query: "", dismissed: null };
const TRIGGER = /(?:^|\s)\/([\w-]{0,30})$/;

export const slashKey = new PluginKey<SlashState>("agrSlashV2");

function read(state: EditorState, dismissed: number | null): SlashState {
  const { selection } = state;
  if (!selection.empty) return { ...IDLE, dismissed };
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return { ...IDLE, dismissed };
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = before.match(TRIGGER);
  if (!m) return { ...IDLE, dismissed: null };
  const from = $from.pos - m[1].length - 1;
  if (dismissed === from) return { ...IDLE, dismissed };
  return { active: true, from, to: $from.pos, query: m[1], dismissed: null };
}

/** `keys` is read on every key press, so the menu can swap its handler freely. */
export function createSlashPlugin(keys: MutableRefObject<((e: KeyboardEvent) => boolean) | null>) {
  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => IDLE,
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(slashKey) as { dismiss: number } | undefined;
        const dismissed = meta ? meta.dismiss : prev.dismissed;
        if (!tr.docChanged && !tr.selectionSet && !meta) return prev;
        return read(next, dismissed);
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashKey.getState(view.state);
        if (!state?.active) return false;
        return keys.current?.(event) ?? false;
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The items                                                                   */
/* -------------------------------------------------------------------------- */

interface SlashItem {
  id: string;
  group: "Basic blocks" | "Signer fields" | "Variables";
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords: string;
  run: (editor: Editor, range: { from: number; to: number }) => void;
}

const chainAt = (editor: Editor, range: { from: number; to: number }) => editor.chain().focus().deleteRange(range);

const BLOCKS: SlashItem[] = [
  { id: "p", group: "Basic blocks", label: "Text", icon: Pilcrow, keywords: "text paragraph plain", run: (e, r) => chainAt(e, r).setParagraph().run() },
  { id: "h1", group: "Basic blocks", label: "Heading 1", icon: Heading1, keywords: "heading title h1 big", run: (e, r) => chainAt(e, r).setHeading({ level: 1 }).run() },
  { id: "h2", group: "Basic blocks", label: "Heading 2", icon: Heading2, keywords: "heading section h2", run: (e, r) => chainAt(e, r).setHeading({ level: 2 }).run() },
  { id: "h3", group: "Basic blocks", label: "Heading 3", icon: Heading3, keywords: "heading subsection h3 small", run: (e, r) => chainAt(e, r).setHeading({ level: 3 }).run() },
  { id: "ul", group: "Basic blocks", label: "Bulleted list", icon: List, keywords: "bullet list unordered points", run: (e, r) => chainAt(e, r).toggleBulletList().run() },
  { id: "ol", group: "Basic blocks", label: "Numbered list", icon: ListOrdered, keywords: "numbered list ordered terms clauses", run: (e, r) => chainAt(e, r).toggleOrderedList().run() },
  { id: "hr", group: "Basic blocks", label: "Divider", icon: Minus, keywords: "divider line rule separator hr", run: (e, r) => chainAt(e, r).setHorizontalRule().run() },
  { id: "table", group: "Basic blocks", label: "Table", hint: "Two columns: label and value", icon: Table, keywords: "table grid details rows", run: (e, r) => chainAt(e, r).insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run() },
];

const FIELD_ICON = { signature: Signature, initials: CaseUpper, date: CalendarCheck } as const;
const FIELDS: SlashItem[] = SIGNATURE_FIELDS.map((f) => ({
  id: `field-${f.key}`,
  group: "Signer fields" as const,
  label: f.label,
  hint: f.hint,
  icon: FIELD_ICON[f.key],
  keywords: `${f.label} ${f.key} sign signer field ${f.key === "date" ? "date signed" : ""}`,
  run: (e: Editor, r: { from: number; to: number }) => chainAt(e, r).insertContent(f.tag).run(),
}));

const VARIABLES: SlashItem[] = TEMPLATE_VARIABLES.map((v) => ({
  id: `var-${v.key}`,
  group: "Variables" as const,
  label: v.label,
  hint: `{{${v.key}}}${v.sample ? ` · e.g. ${v.sample}` : ""}`,
  icon: Braces,
  keywords: `${v.label} ${v.key.replace(/_/g, " ")} ${v.description} ${v.category}`,
  run: (e: Editor, r: { from: number; to: number }) => chainAt(e, r).insertContent(`{{${v.key}}}`).run(),
}));

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase().replace(/[-_]/g, " ");
  const match = (i: SlashItem) => !q || `${i.label} ${i.keywords}`.toLowerCase().includes(q);
  const blocks = BLOCKS.filter(match);
  const fields = FIELDS.filter(match);
  // Variables only once the operator has typed something: 113 of them would bury the blocks.
  const vars = q.length >= 2 ? VARIABLES.filter(match).slice(0, 8) : [];
  return [...blocks, ...fields, ...vars];
}

/* -------------------------------------------------------------------------- */
/* The menu                                                                    */
/* -------------------------------------------------------------------------- */

export function SlashMenuV2({ editor }: { editor: Editor | null }) {
  const keysRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const [slash, setSlash] = useState<SlashState>(IDLE);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Register the plugin once per editor, and follow its state.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(createSlashPlugin(keysRef));
    const sync = () => {
      const next = slashKey.getState(editor.state) ?? IDLE;
      setSlash((prev) => (prev.active === next.active && prev.from === next.from && prev.query === next.query && prev.to === next.to ? prev : next));
    };
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
      if (!editor.isDestroyed) editor.unregisterPlugin(slashKey);
    };
  }, [editor]);

  const items = useMemo(() => (slash.active ? filterItems(slash.query) : []), [slash.active, slash.query]);
  useEffect(() => setIndex(0), [slash.query, slash.from]);

  const choose = (item: SlashItem | undefined) => {
    if (!editor || !item) return;
    item.run(editor, { from: slash.from, to: slash.to });
  };
  const dismiss = () => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(slashKey, { dismiss: slash.from }));
  };

  keysRef.current = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      dismiss();
      return true;
    }
    if (items.length === 0) return false;
    if (event.key === "ArrowDown") {
      setIndex((i) => (i + 1) % items.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      setIndex((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      choose(items[index]);
      return true;
    }
    return false;
  };

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!editor || !slash.active || items.length === 0) return null;
  let coords: { left: number; bottom: number; top: number };
  try {
    coords = editor.view.coordsAtPos(slash.from);
  } catch {
    return null;
  }
  const below = coords.bottom + 320 < window.innerHeight;
  let lastGroup = "";

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert"
      onMouseDown={(e) => e.preventDefault()}
      className="animate-in fade-in-0 slide-in-from-bottom-3 fixed z-[60] max-h-80 w-72 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl duration-200 ease-out motion-reduce:animate-none"
      style={below ? { left: coords.left, top: coords.bottom + 6 } : { left: coords.left, bottom: window.innerHeight - coords.top + 6 }}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const header = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{item.group}</p>}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left",
                i === index ? "bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-foreground",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The selection bar                                                           */
/* -------------------------------------------------------------------------- */

const BAR_BUTTON =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-foreground motion-reduce:transition-none";
const BAR_ON = "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]";

/** Select text: bold, italic, underline, heading and alignment, right above it. */
export function SelectionBarV2({ editor }: { editor: Editor | null }) {
  // The studio's editor does not re-render on every transaction, so the
  // pressed states are read live here.
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      !e || e.isDestroyed
        ? null
        : {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            left: e.isActive({ textAlign: "left" }),
            center: e.isActive({ textAlign: "center" }),
            right: e.isActive({ textAlign: "right" }),
          },
  });
  if (!editor || !on) return null;
  const btn = (label: string, Icon: LucideIcon, active: boolean, run: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(BAR_BUTTON, active && BAR_ON)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {btn("Bold", Bold, on.bold, () => c().toggleBold().run())}
      {btn("Italic", Italic, on.italic, () => c().toggleItalic().run())}
      {btn("Underline", Underline, on.underline, () => c().toggleUnderline().run())}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      {btn("Heading 2", Heading2, on.h2, () => c().toggleHeading({ level: 2 }).run())}
      {btn("Heading 3", Heading3, on.h3, () => c().toggleHeading({ level: 3 }).run())}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      {btn("Align left", AlignLeft, on.left, () => c().setTextAlign("left").run())}
      {btn("Align center", AlignCenter, on.center, () => c().setTextAlign("center").run())}
      {btn("Align right", AlignRight, on.right, () => c().setTextAlign("right").run())}
    </BubbleMenu>
  );
}
