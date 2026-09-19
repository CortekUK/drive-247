/**
 * Notifications v2: the pieces behind the Notion-like email editor
 * (`template-editor.tsx`, build-spec D17). v2 only: nothing in v1 imports this.
 *
 * Only packages portal already declares: `@tiptap/react` (which re-exports
 * `@tiptap/core`), `@tiptap/starter-kit`, `@tiptap/extension-placeholder` and
 * `@tiptap/pm`. No suggestion or mention package: the `/` menu and the `{{`
 * variable picker share one small ProseMirror plugin below.
 *
 * WHAT THE STORED HTML LOOKS LIKE (types.ts EmailTemplate)
 *   p, h2, h3, ul/ol/li, blockquote, hr, br, strong, em, u, a, and
 *   `<p><a data-email-button href="…">Text</a></p>` for a button. A variable is
 *   the literal text `{{key}}`: the editor shows it as a chip, and
 *   `serializeEditorHtml` writes it back as the bare `{{key}}` text, so the
 *   server's `{{key}}` substitution keeps working unchanged. (Tiptap's own
 *   getHTML() keeps a `<span data-variable>` around the same text; use
 *   `serializeEditorHtml` for anything that is stored.)
 *
 * LOADING
 *   `wrapKnownVariables` wraps each KNOWN `{{key}}` in the text (never inside
 *   an attribute, so `href="{{payment_url}}"` is left alone) in
 *   `<span data-variable="key">`, which the chip node parses. Unknown `{{x}}`
 *   stay plain text, so a typo is visible rather than silently turned into a
 *   chip.
 *
 * STABLE OUTPUT
 *   `serializeEditorHtml` is deterministic, and writes the same shape the
 *   catalog defaults use (`<li>text</li>`, not `<li><p>text</p></li>`;
 *   `data-email-button` without `=""`), so a default template loads and
 *   serialises back to the same string. The editor component also never calls
 *   onChange for a load, so an untouched template is never "changed".
 */

import { Extension, InputRule, Node, PasteRule, type CommandProps, type Editor, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { NotificationVariable } from "@/lib/notifications-v2/types";

/* -------------------------------------------------------------------------- */
/* Names and shared constants                                                  */
/* -------------------------------------------------------------------------- */

export const VARIABLE_NODE = "variable";
export const EMAIL_BUTTON_NODE = "emailButton";

/** The text a new button starts with; it is selected, so typing replaces it. */
export const EMAIL_BUTTON_DEFAULT_TEXT = "Button text";

/** A variable key, exactly as `variables.ts` and the server match it. */
const VARIABLE_KEY = /^[A-Za-z0-9_]{1,64}$/;
const VARIABLE_TOKEN = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** A start/end tag or a comment; quoted attribute values may contain ">". */
const TAG_OR_COMMENT = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;

type KnownKeys = ReadonlySet<string> | readonly string[] | ((key: string) => boolean);

function knownTest(known: KnownKeys): (key: string) => boolean {
  if (typeof known === "function") return known;
  if (known instanceof Set) return (key) => known.has(key);
  const list = known as readonly string[];
  return (key) => list.includes(key);
}

/* -------------------------------------------------------------------------- */
/* Loading: {{key}} text → chip markup                                         */
/* -------------------------------------------------------------------------- */

/**
 * Wraps every known `{{key}}` in the TEXT of `html` in
 * `<span data-variable="key">{{key}}</span>`, the markup the chip node parses.
 * Tags, attribute values and comments are copied untouched; unknown keys stay
 * plain text.
 */
export function wrapKnownVariables(html: string | null | undefined, known: KnownKeys): string {
  const src = html ?? "";
  if (src.indexOf("{{") === -1) return src;
  const isKnown = knownTest(known);
  const wrapText = (text: string) =>
    text.indexOf("{{") === -1
      ? text
      : text.replace(VARIABLE_TOKEN, (match, key: string) =>
          isKnown(key) ? `<span data-variable="${key}">${match}</span>` : match,
        );

  let out = "";
  let last = 0;
  for (const m of src.matchAll(TAG_OR_COMMENT)) {
    const at = m.index ?? 0;
    out += wrapText(src.slice(last, at)) + m[0];
    last = at + m[0].length;
  }
  return out + wrapText(src.slice(last));
}

/* -------------------------------------------------------------------------- */
/* Saving: the document → stored HTML                                          */
/* -------------------------------------------------------------------------- */

function isEmptyDoc(doc: PMNode): boolean {
  if (doc.childCount === 0) return true;
  const only = doc.childCount === 1 ? doc.firstChild : null;
  return !!only && only.type.name === "paragraph" && only.content.size === 0;
}

/** Chips are stored as their bare `{{key}}` text. */
function unwrapVariables(root: HTMLElement) {
  root.querySelectorAll("span[data-variable]").forEach((el) => {
    el.replaceWith(el.ownerDocument.createTextNode(el.textContent ?? ""));
  });
}

/**
 * `<li><p>x</p></li>` → `<li>x</li>` (and the same for a one-paragraph quote).
 * A button's `<p>` stays: without it a button alone in a list item would not
 * load back the same way.
 */
function unwrapSoleParagraphs(root: HTMLElement) {
  root.querySelectorAll("li, blockquote").forEach((el) => {
    if (el.childNodes.length !== 1) return;
    const only = el.firstChild as HTMLElement;
    if (only.nodeType !== 1 || only.nodeName !== "P" || only.attributes.length > 0) return;
    if (only.querySelector("a[data-email-button]")) return;
    while (only.firstChild) el.insertBefore(only.firstChild, only);
    el.removeChild(only);
  });
}

/**
 * The editor's document as the HTML we store (see the header). An empty
 * document is "". Same document in, same string out.
 */
export function serializeEditorHtml(source: Editor | PMNode): string {
  const doc: PMNode = "state" in source ? source.state.doc : source;
  if (isEmptyDoc(doc)) return "";
  const htmlDoc = document.implementation.createHTMLDocument("");
  const container = htmlDoc.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content, { document: htmlDoc }));
  unwrapVariables(container);
  unwrapSoleParagraphs(container);
  // The catalog writes the flag bare; innerHTML writes `=""`. In serialised
  // HTML a "<" is always a tag (text escapes it), so this cannot touch text.
  return container.innerHTML.replace(/<a data-email-button=""/g, "<a data-email-button");
}

/* -------------------------------------------------------------------------- */
/* Links                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a link or button may point at: the same three shapes the email
 * sanitiser keeps (`email-layout.ts` safeHref): http(s), mailto, or a link
 * variable such as `{{payment_url}}`.
 */
export function isAllowedHref(href: string | null | undefined): boolean {
  const v = (href ?? "").trim();
  if (!v || /[\u0000-\u0020\u007f]/.test(v)) return false;
  if (/^https?:\/\/[^\s/?#]+/i.test(v)) return true;
  if (/^mailto:\S+$/i.test(v)) return true;
  return /^\{\{[A-Za-z0-9_]+\}\}/.test(v) && !/["'<>]/.test(v);
}

/**
 * What the operator typed in a link box, made usable: "" clears the link,
 * `example.com` becomes `https://example.com`, `jo@example.com` becomes a
 * mailto link. Returns null when it can't be a safe link (javascript:, tel:,
 * text with spaces…), so the box can say so instead of saving it.
 */
export function normaliseLinkHref(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return "";
  if (isAllowedHref(v)) return v;
  if (/\s/.test(v)) return null;
  if (/^[^@/:]+@[^@/:]+\.[a-z]{2,}$/i.test(v)) return `mailto:${v}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // some other scheme
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(v)) return `https://${v}`;
  return null;
}

/** The caption beside a button in the editor: where it goes, or that it goes nowhere yet. */
export function describeButtonHref(
  href: string | null | undefined,
  getLabel: (key: string) => string,
): { text: string; missing: boolean } {
  if (!href) return { text: "Add a link to this button", missing: true };
  const only = /^\{\{([A-Za-z0-9_]+)\}\}$/.exec(href);
  return { text: `Link: ${only ? getLabel(only[1]) : href}`, missing: false };
}

/* -------------------------------------------------------------------------- */
/* The "/" and "{{" triggers                                                   */
/* -------------------------------------------------------------------------- */

export type SuggestionKind = "slash" | "variable";

export interface SuggestionMatch {
  kind: SuggestionKind;
  query: string;
  /** Characters to delete before the caret when an item is picked. */
  length: number;
}

const VARIABLE_TRIGGER = /\{\{([A-Za-z0-9_ ]{0,40})$/;
/** "/" at the start of a block or after a space, so "and/or" and URLs never open the menu. */
const SLASH_TRIGGER = /(?:^|[\s\u00a0])\/([A-Za-z0-9]{0,24})$/;

/**
 * Reads the text just before the caret: `{{cust` opens the variable picker
 * with query "cust", `/head` opens the block menu with query "head".
 */
export function matchSuggestionTrigger(textBefore: string, opts: { slash?: boolean } = {}): SuggestionMatch | null {
  const v = VARIABLE_TRIGGER.exec(textBefore);
  if (v) return { kind: "variable", query: v[1], length: v[0].length };
  if (opts.slash === false) return null;
  const s = SLASH_TRIGGER.exec(textBefore);
  if (s) return { kind: "slash", query: s[1], length: s[1].length + 1 };
  return null;
}

/* -------------------------------------------------------------------------- */
/* The block menu                                                              */
/* -------------------------------------------------------------------------- */

export type SlashCommandId =
  | "text"
  | "heading"
  | "subheading"
  | "bullet_list"
  | "numbered_list"
  | "quote"
  | "divider"
  | "button"
  | "variable";

export interface SlashCommand {
  id: SlashCommandId;
  title: string;
  description: string;
  keywords: readonly string[];
}

/** The "/" menu, in display order (D17). */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "text", title: "Text", description: "A plain paragraph.", keywords: ["paragraph", "plain", "p"] },
  { id: "heading", title: "Heading", description: "A section title.", keywords: ["h2", "title", "large"] },
  { id: "subheading", title: "Subheading", description: "A smaller title.", keywords: ["h3", "heading", "small"] },
  { id: "bullet_list", title: "Bulleted list", description: "A list with dots.", keywords: ["ul", "unordered", "list", "bullet"] },
  { id: "numbered_list", title: "Numbered list", description: "A list with numbers.", keywords: ["ol", "ordered", "list", "number", "steps"] },
  { id: "quote", title: "Quote", description: "Text set apart with a line.", keywords: ["blockquote", "callout", "note"] },
  { id: "divider", title: "Divider", description: "A line between sections.", keywords: ["hr", "line", "separator", "rule"] },
  { id: "button", title: "Button", description: "A link that looks like a button.", keywords: ["cta", "link", "action"] },
  { id: "variable", title: "Variable", description: "Customer name, amount and more.", keywords: ["field", "placeholder", "merge", "insert"] },
];

export type TurnIntoId = "text" | "heading" | "subheading" | "bullet_list" | "numbered_list" | "quote";

/** The block types the selection bubble can turn a block into. */
export const TURN_INTO_COMMANDS: readonly SlashCommand[] = SLASH_COMMANDS.filter((c) =>
  (["text", "heading", "subheading", "bullet_list", "numbered_list", "quote"] as const).includes(c.id as TurnIntoId),
);

/**
 * The block-menu items for what was typed after "/". Title prefix first, then
 * keyword prefix, then anywhere in the title; ties keep menu order.
 */
export function filterSlashCommands(query: string, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [...commands];
  return commands
    .map((c, i) => {
      const title = c.title.toLowerCase();
      let score = -1;
      if (title.startsWith(q) || title.split(" ").some((w) => w.startsWith(q))) score = 0;
      else if (c.keywords.some((k) => k.startsWith(q))) score = 1;
      else if (title.includes(q)) score = 2;
      return { c, i, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.c);
}

/* -------------------------------------------------------------------------- */
/* Variables in menus                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The variables matching what was typed after `{{`: by label ("cust" →
 * Customer name) or by key ("customer_n"). Label prefix first.
 */
export function filterVariables(variables: readonly NotificationVariable[], query: string): NotificationVariable[] {
  const q = (query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [...variables];
  const qKey = q.replace(/ /g, "_");
  return variables
    .map((v, i) => {
      const label = v.label.toLowerCase();
      const key = v.key.toLowerCase();
      let score = -1;
      if (label.startsWith(q) || key.startsWith(qKey)) score = 0;
      else if (label.split(" ").some((w) => w.startsWith(q))) score = 1;
      else if (label.includes(q) || key.includes(qKey)) score = 2;
      return { v, i, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.v);
}

/* -------------------------------------------------------------------------- */
/* The variable chip                                                           */
/* -------------------------------------------------------------------------- */

/** The chip's look. Inherits the weight (a chip inside bold text is bold). */
export const VARIABLE_CHIP_CLASS =
  "mx-px inline-block whitespace-nowrap rounded-full bg-primary/10 px-1.5 align-baseline text-[0.92em] leading-snug text-primary select-none dark:bg-primary/20 dark:text-[hsl(var(--v2-link,var(--primary)))]";

export interface VariableNodeOptions {
  getLabel: (key: string) => string;
  isKnown: (key: string) => boolean;
}

export const VariableNode = Node.create<VariableNodeOptions>({
  name: VARIABLE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { getLabel: (key: string) => key, isKnown: () => true };
  },

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-variable")?.trim() || null,
        renderHTML: () => ({}),
      },
    };
  },

  // Only this notification's variables become chips; any other span falls
  // through and its `{{key}}` text stays plain text.
  parseHTML() {
    const { isKnown } = this.options;
    return [
      {
        tag: "span[data-variable]",
        priority: 1000,
        getAttrs: (el: HTMLElement) => {
          const key = el.getAttribute("data-variable")?.trim() ?? "";
          return VARIABLE_KEY.test(key) && isKnown(key) ? null : false;
        },
      },
    ];
  },

  // An element, because ProseMirror draws with this whenever the chip's node
  // view is not installed (React's EditorContent removes node views on
  // unmount). The stored form is still the bare text: `serializeEditorHtml`
  // unwraps the span, and the email sanitiser allows it anyway.
  renderHTML({ node }) {
    return ["span", { "data-variable": node.attrs.key }, `{{${node.attrs.key}}}`];
  },

  renderText({ node }) {
    return `{{${node.attrs.key}}}`;
  },

  addNodeView() {
    const getLabel = this.options.getLabel;
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = VARIABLE_CHIP_CLASS;
      dom.contentEditable = "false";
      dom.setAttribute("data-variable", node.attrs.key);
      dom.title = `{{${node.attrs.key}}}`;
      dom.textContent = getLabel(node.attrs.key);
      return { dom };
    };
  },

  // Typing a whole `{{customer_name}}` by hand turns it into a chip.
  addInputRules() {
    const { isKnown } = this.options;
    const type = this.type;
    return [
      new InputRule({
        find: (text: string) => {
          const m = /\{\{([A-Za-z0-9_]+)\}\}$/.exec(text);
          if (!m || !isKnown(m[1])) return null;
          return { index: m.index, text: m[0], data: { key: m[1] } };
        },
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, type.create({ key: match.data?.key }));
        },
      }),
    ];
  },

  // Pasted `{{key}}` text becomes chips (a copied chip comes back through its span).
  addPasteRules() {
    const { isKnown } = this.options;
    const type = this.type;
    return [
      new PasteRule({
        find: (text: string) => {
          const found: { index: number; text: string; data: { key: string } }[] = [];
          for (const m of text.matchAll(VARIABLE_TOKEN)) {
            if (isKnown(m[1])) found.push({ index: m.index ?? 0, text: m[0], data: { key: m[1] } });
          }
          return found.length ? found : null;
        },
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, type.create({ key: match.data?.key }));
        },
      }),
    ];
  },
});

/* -------------------------------------------------------------------------- */
/* The email button                                                            */
/* -------------------------------------------------------------------------- */

/** A `<p>` whose only content is one `<a data-email-button>`: that anchor. */
function soleButtonAnchor(el: HTMLElement): HTMLElement | null {
  let anchor: HTMLElement | null = null;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      if ((child.textContent ?? "").trim()) return null;
      continue;
    }
    if (child.nodeType !== 1) continue;
    const e = child as HTMLElement;
    if (anchor || e.nodeName !== "A" || !e.hasAttribute("data-email-button")) return null;
    anchor = e;
  }
  return anchor;
}

function buttonHrefFrom(el: HTMLElement): string | null {
  const anchor = el.nodeName === "A" ? el : soleButtonAnchor(el);
  const href = anchor?.getAttribute("href")?.trim() ?? "";
  return isAllowedHref(href) ? href : null;
}

export const BUTTON_BLOCK_CLASS = "my-3 flex flex-wrap items-center gap-x-3 gap-y-1";
export const BUTTON_LABEL_CLASS =
  "inline-block min-w-[7rem] rounded-full bg-primary px-4 py-2 text-center text-sm font-medium leading-5 text-primary-foreground";
export const BUTTON_CAPTION_CLASS =
  "max-w-full truncate text-xs text-muted-foreground select-none data-[missing=true]:text-amber-700 dark:data-[missing=true]:text-amber-400";

export interface EmailButtonOptions {
  getVariableLabel: (key: string) => string;
}

/**
 * A call-to-action button: its text is edited in place, its link in the
 * button panel. Stored as `<p><a data-email-button href="…">Text</a></p>`,
 * which `inlineEmailStyles` turns into a bulletproof table button.
 */
export const EmailButtonNode = Node.create<EmailButtonOptions>({
  name: EMAIL_BUTTON_NODE,
  group: "block",
  content: `(text|${VARIABLE_NODE})*`,
  marks: "",
  defining: true,

  addOptions() {
    return { getVariableLabel: (key: string) => key };
  },

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (el: HTMLElement) => buttonHrefFrom(el),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "p",
        priority: 1000,
        getAttrs: (el: HTMLElement) => (soleButtonAnchor(el) ? null : false),
        contentElement: (el: globalThis.Node) => soleButtonAnchor(el as HTMLElement) as HTMLElement,
      },
      { tag: "a[data-email-button]", priority: 1000 },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = { "data-email-button": "" };
    if (node.attrs.href && isAllowedHref(node.attrs.href)) attrs.href = node.attrs.href;
    return ["p", {}, ["a", attrs, 0]];
  },

  addNodeView() {
    const getLabel = this.options.getVariableLabel;
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = BUTTON_BLOCK_CLASS;
      dom.setAttribute("data-button-block", "");
      const label = document.createElement("span");
      label.className = BUTTON_LABEL_CLASS;
      label.setAttribute("data-button-label", "");
      const caption = document.createElement("span");
      caption.className = BUTTON_CAPTION_CLASS;
      caption.contentEditable = "false";
      caption.setAttribute("data-button-caption", "");
      const paint = (n: PMNode) => {
        const d = describeButtonHref(n.attrs.href, getLabel);
        caption.textContent = d.text;
        caption.setAttribute("data-missing", d.missing ? "true" : "false");
      };
      paint(node);
      dom.append(label, caption);
      return {
        dom,
        contentDOM: label,
        update: (next: PMNode) => {
          if (next.type.name !== EMAIL_BUTTON_NODE) return false;
          paint(next);
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter leaves the button for a new line below, instead of splitting it.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== EMAIL_BUTTON_NODE) return false;
        const pos = $from.after();
        return editor.chain().insertContentAt(pos, { type: "paragraph" }).setTextSelection(pos + 1).scrollIntoView().run();
      },
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Suggestion plugin: "/" and "{{"                                             */
/* -------------------------------------------------------------------------- */

export interface SuggestionPluginState {
  active: boolean;
  kind: SuggestionKind | null;
  /** Where the trigger ("/" or "{{") starts. */
  from: number;
  /** The caret. */
  to: number;
  query: string;
  /** The trigger the operator closed with Escape; it stays closed until it is gone. */
  dismissedAt: number | null;
}

const INACTIVE: SuggestionPluginState = { active: false, kind: null, from: 0, to: 0, query: "", dismissedAt: null };

export const suggestionPluginKey = new PluginKey<SuggestionPluginState>("notificationEditorSuggestion");

/** Hooks the editor component fills in, read at key-press time. */
export interface EditorMenuHandlers {
  /** A key while a trigger is active; return true when the open menu used it. */
  onSuggestionKeyDown?: (event: KeyboardEvent) => boolean;
  /** Ctrl/Cmd+K; return true when the link box opened. */
  onLinkShortcut?: () => boolean;
}

function findSuggestion(state: EditorState): Omit<SuggestionPluginState, "active" | "dismissedAt"> | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $pos = selection.$from;
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const start = Math.max(0, $pos.parentOffset - 64);
  // Leaves (chips, line breaks) count as one non-space character, so offsets
  // match document positions; "x" stops a cut-off line matching as a line start.
  const textBefore = (start > 0 ? "x" : "") + parent.textBetween(start, $pos.parentOffset, undefined, "\ufffc");
  const match = matchSuggestionTrigger(textBefore, { slash: parent.type.name !== EMAIL_BUTTON_NODE });
  if (!match) return null;
  return { kind: match.kind, query: match.query, from: $pos.pos - match.length, to: $pos.pos };
}

/** Closes the open menu, leaving what was typed (Escape). */
export function dismissSuggestion(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(suggestionPluginKey, { dismiss: true }));
}

function suggestionPlugin(getHandlers: () => EditorMenuHandlers) {
  return new Plugin<SuggestionPluginState>({
    key: suggestionPluginKey,
    state: {
      init: () => INACTIVE,
      apply(tr, prev, _oldState, newState) {
        const found = findSuggestion(newState);
        if (!found) return INACTIVE;
        let dismissedAt = prev.dismissedAt === null ? null : tr.mapping.map(prev.dismissedAt);
        if ((tr.getMeta(suggestionPluginKey) as { dismiss?: boolean } | undefined)?.dismiss) dismissedAt = found.from;
        if (dismissedAt === found.from) return { ...INACTIVE, dismissedAt };
        return { ...found, active: true, dismissedAt: null };
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!suggestionPluginKey.getState(view.state)?.active) return false;
        return getHandlers().onSuggestionKeyDown?.(event) ?? false;
      },
    },
  });
}

/**
 * Runs before the list and paragraph keymaps, so Enter picks from an open menu.
 * The handlers come through a getter: Tiptap deep-copies plain option objects
 * in `configure`, which would cut a `{ current }` ref off from its owner.
 */
const EditorMenus = Extension.create<{ getHandlers: () => EditorMenuHandlers }>({
  name: "notificationEditorMenus",
  priority: 10000,

  addOptions() {
    return { getHandlers: () => ({}) };
  },

  addProseMirrorPlugins() {
    return [suggestionPlugin(this.options.getHandlers)];
  },

  addKeyboardShortcuts() {
    return { "Mod-k": () => this.options.getHandlers().onLinkShortcut?.() ?? false };
  },
});

/* -------------------------------------------------------------------------- */
/* The extension set                                                           */
/* -------------------------------------------------------------------------- */

export interface NotificationEditorExtensionOptions {
  /** The empty-editor placeholder (read each time it is drawn). */
  placeholder?: () => string;
  getVariableLabel?: (key: string) => string;
  isKnownVariable?: (key: string) => boolean;
  handlers?: { current: EditorMenuHandlers };
}

export const DEFAULT_EDITOR_PLACEHOLDER = "Write your message, or type / for blocks";

/**
 * Everything the email editor needs, and nothing it doesn't: no code, strike,
 * tables, alignment, colours or images, because an email body keeps only what
 * the sanitiser allows. The trailing-paragraph plugin is off, so loading a
 * template never adds an empty line to it.
 */
export function createNotificationEditorExtensions(opts: NotificationEditorExtensionOptions = {}): Extensions {
  const getLabel = opts.getVariableLabel ?? ((key: string) => key);
  const isKnown = opts.isKnownVariable ?? (() => true);
  const placeholder = opts.placeholder ?? (() => DEFAULT_EDITOR_PLACEHOLDER);
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: true,
        HTMLAttributes: { target: null, rel: null, class: null },
        isAllowedUri: (url: string) => isAllowedHref(url),
      },
    }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node }) => {
        if (node.type.name === "heading") return node.attrs.level === 3 ? "Subheading" : "Heading";
        if (node.type.name === EMAIL_BUTTON_NODE) return "";
        return editor.isEmpty ? placeholder() : "Type / for blocks";
      },
    }),
    VariableNode.configure({ getLabel, isKnown }),
    EmailButtonNode.configure({ getVariableLabel: getLabel }),
    EditorMenus.configure({ getHandlers: () => opts.handlers?.current ?? {} }),
  ];
}

/* -------------------------------------------------------------------------- */
/* Commands the menus run                                                      */
/* -------------------------------------------------------------------------- */

type Range = { from: number; to: number };

/** The button the selection is in (or on), with its position. */
export function emailButtonAt(state: EditorState): { pos: number; node: PMNode } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === EMAIL_BUTTON_NODE) return { pos: sel.from, node: sel.node };
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === EMAIL_BUTTON_NODE) return { pos: $from.before(d), node: n };
  }
  return null;
}

/** The block type at the selection, for the bubble's "Turn into" label. */
export function activeBlockId(state: EditorState): TurnIntoId | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList") return "bullet_list";
    if (name === "orderedList") return "numbered_list";
    if (name === "blockquote") return "quote";
  }
  const parent = $from.parent;
  if (parent.type.name === "heading") return parent.attrs.level === 3 ? "subheading" : "heading";
  if (parent.type.name === "paragraph") return "text";
  return null;
}

/**
 * Puts a button where the caret is: an empty line becomes the button, anything
 * else gets the button on the next line. Its text is selected, so typing
 * replaces "Button text".
 */
function insertEmailButton(text: string = EMAIL_BUTTON_DEFAULT_TEXT) {
  return ({ tr, state, dispatch }: CommandProps) => {
    const type = state.schema.nodes[EMAIL_BUTTON_NODE];
    if (!type) return false;
    const node = type.create({ href: null }, text ? state.schema.text(text) : undefined);
    const { $from } = tr.selection;
    let from = $from.pos;
    let to = $from.pos;
    if ($from.depth > 0) {
      const top = $from.node(1);
      if (top.type.name === "paragraph" && top.content.size === 0) {
        from = $from.before(1);
        to = $from.after(1);
      } else {
        from = to = $from.after(1);
      }
    }
    if (dispatch) {
      tr.replaceWith(from, to, node);
      tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + text.length));
      tr.scrollIntoView();
    }
    return true;
  };
}

/**
 * Runs one block-menu or "Turn into" command. With `range` (the "/query" the
 * operator typed) that text is removed first. "Variable" types `{{`, which
 * opens the variable picker in place.
 */
export function applyBlockCommand(editor: Editor, id: SlashCommandId, range?: Range | null): boolean {
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  switch (id) {
    case "text":
      return chain.clearNodes().run();
    case "heading":
      return chain.clearNodes().setNode("heading", { level: 2 }).run();
    case "subheading":
      return chain.clearNodes().setNode("heading", { level: 3 }).run();
    case "bullet_list":
      return chain.clearNodes().toggleBulletList().run();
    case "numbered_list":
      return chain.clearNodes().toggleOrderedList().run();
    case "quote":
      return chain.clearNodes().setBlockquote().run();
    case "divider":
      return chain.setHorizontalRule().run();
    case "button":
      return chain.command(insertEmailButton()).run();
    case "variable":
      return chain.insertContent("{{").run();
    default:
      return false;
  }
}

/** Inserts a chip at the caret, replacing `range` (the typed "{{query") when given. */
export function insertVariable(editor: Editor, key: string, range?: Range | null): boolean {
  if (!VARIABLE_KEY.test(key)) return false;
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  return chain.insertContent({ type: VARIABLE_NODE, attrs: { key } }).run();
}

/** Sets (or, with "", clears) the link of the button the selection is in. */
export function setEmailButtonHref(editor: Editor, href: string): boolean {
  const found = emailButtonAt(editor.state);
  if (!found) return false;
  const next = href && isAllowedHref(href) ? href : null;
  if ((found.node.attrs.href ?? null) === next) return true;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, href: next }));
  return true;
}

/** Links the selected text (or the link around the caret); "" removes the link. */
export function setLinkHref(editor: Editor, href: string): boolean {
  const chain = editor.chain().focus().extendMarkRange("link");
  return href ? chain.setLink({ href }).run() : chain.unsetLink().run();
}
