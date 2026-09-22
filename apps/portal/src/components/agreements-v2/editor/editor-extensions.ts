/**
 * Agreements v2: the editor's own Tiptap setup (build-spec D6, D8, D9).
 *
 * NOT the shared `components/settings/tiptap-editor.tsx`: that one also drives
 * the v1 email-template and agreement editors, and nothing here may change
 * them. The set below starts from the same extensions (StarterKit with h1–h3,
 * Underline, TextAlign, Placeholder, Table*), so a template written in v1 loads
 * and saves here without losing anything v1 kept, and adds:
 *
 *  - `OperatorSignatureImage`: the ONE image the agreement can carry, the
 *    operator's own signature, as
 *    `<img data-operator-signature="true" src="data:image/png;base64,…" alt="Signature">`.
 *    It is a BLOCK node, so it always serialises between blocks, never inside
 *    a `<p>`. It parses only that exact element with a PNG or JPEG data URL;
 *    every other `<img>` (a pasted logo, a remote URL, a `data:image/svg+xml`)
 *    is dropped, because the PDF renderers draw only this one.
 *  - `AgreementTokenHighlight`: decorations that tint `{{variables}}` and the
 *    three signer fields while editing. Decorations are view-only: the stored
 *    HTML is exactly the text the operator typed.
 *  - `AgreementDropGuard`: a file dropped on the editor is swallowed, instead
 *    of the browser opening it in the tab and taking the unsaved edits with it.
 *
 * What the editor does NOT do: rewrite, wrap or strip `{{…}}` text. Variables
 * and the BoldSign text tags `{{@sig1}}`, `{{@init1}}`, `{{@date1}}` are plain
 * text in the document, byte for byte what the send path reads.
 *
 * Drag and drop of a variable or a signer field from the side panel uses
 * ProseMirror's own external-text drop (prosemirror-view `handleDrop`): the
 * panel puts the token in `dataTransfer` as `text/plain`, and ProseMirror
 * inserts it at `posAtCoords(drop point)`, not at the old cursor.
 */

import { Extension, mergeAttributes, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Image } from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { OPERATOR_SIGNATURE_ATTR, SIGNATURE_FIELDS, type SignatureFieldKeyV2 } from "@/lib/agreements-v2/types";
import { isOperatorSignatureSrc, OPERATOR_SIGNATURE_MAX_LENGTH } from "./operator-signature";

/* -------------------------------------------------------------------------- */
/* The operator's signature                                                    */
/* -------------------------------------------------------------------------- */

export const OPERATOR_SIGNATURE_NODE = "operatorSignature";

// The rule for what counts as the operator's signature lives in
// ./operator-signature.ts, shared with the preview's sanitiser.
export { isOperatorSignatureSrc, OPERATOR_SIGNATURE_MAX_LENGTH };

/**
 * Where the signature cannot go. Both PDF renderers draw the signature image
 * only as a block of its own: one inside a table cell or a list item is
 * DROPPED from the signed document (the preview drops it too, so it never
 * promises what the PDF lacks). So it is refused there, with this reason.
 */
const SIGNATURE_FORBIDDEN_IN = new Set(["tableCell", "tableHeader", "listItem"]);

export const SIGNATURE_PLACEMENT_REASON =
  "Put your signature on its own line, outside a table or list — it can't be printed there.";

/** Is either end of the selection inside a table cell, a header cell or a list item? */
export function isInsideTableOrList(selection: Pick<Selection, "$from" | "$to">): boolean {
  for (const $pos of [selection.$from, selection.$to]) {
    for (let depth = $pos.depth; depth > 0; depth--) {
      if (SIGNATURE_FORBIDDEN_IN.has($pos.node(depth).type.name)) return true;
    }
  }
  return false;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    operatorSignature: {
      /**
       * Insert the operator's signature at the selection. False for anything
       * but a PNG/JPEG data URL, and inside a table or a list
       * (`SIGNATURE_PLACEMENT_REASON`).
       */
      insertOperatorSignature: (src: string) => ReturnType;
    };
  }
}

export const OperatorSignatureImage = Image.extend({
  name: OPERATOR_SIGNATURE_NODE,

  addOptions() {
    return { ...this.parent?.(), inline: false, allowBase64: true, HTMLAttributes: {}, resize: false };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("src"),
        renderHTML: (attributes: { src?: unknown }) => (isOperatorSignatureSrc(attributes.src) ? { src: attributes.src } : {}),
      },
      // Always "Signature": the image is a signature, whatever alt it was pasted with.
      alt: {
        default: "Signature",
        parseHTML: () => "Signature",
        renderHTML: () => ({ alt: "Signature" }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `img[${OPERATOR_SIGNATURE_ATTR}]`,
        getAttrs: (element: HTMLElement) =>
          element.getAttribute(OPERATOR_SIGNATURE_ATTR) === "true" && isOperatorSignatureSrc(element.getAttribute("src"))
            ? null
            : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes({ [OPERATOR_SIGNATURE_ATTR]: "true" }, HTMLAttributes)];
  },

  // No markdown `![](url)` rule: an image that is not the signature must not appear.
  addInputRules() {
    return [];
  },

  addCommands() {
    return {
      insertOperatorSignature:
        (src: string) =>
        ({ tr, commands }) =>
          isOperatorSignatureSrc(src) && !isInsideTableOrList(tr.selection)
            ? commands.insertContent({ type: this.name, attrs: { src } })
            : false,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Token highlighting (view only)                                              */
/* -------------------------------------------------------------------------- */

const FIELD_BY_TAG = new Map<string, SignatureFieldKeyV2>(SIGNATURE_FIELDS.map((f) => [f.tag, f.key]));

/** A signer tag, or a `{{variable}}` with the send path's 2–3 brace tolerance (and `{{#if x}}` / `{{/if}}`). */
const TOKEN = /\{\{@\w+\}\}|\{{2,3}\s*[#/]?[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)?\s*\}{2,3}/g;

export type TokenKindV2 = "field" | "field-unknown" | "variable" | "logic";

export function classifyToken(token: string): { kind: TokenKindV2; field?: SignatureFieldKeyV2 } {
  if (token.startsWith("{{@")) {
    const field = FIELD_BY_TAG.get(token);
    return field ? { kind: "field", field } : { kind: "field-unknown" };
  }
  return /^\{{2,3}\s*[#/]/.test(token) ? { kind: "logic" } : { kind: "variable" };
}

function tokenDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text || node.text.indexOf("{{") === -1) return;
    for (const match of node.text.matchAll(TOKEN)) {
      const from = pos + (match.index ?? 0);
      const { kind, field } = classifyToken(match[0]);
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: "agr-token",
          "data-token": kind,
          ...(field ? { "data-field": field } : {}),
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const tokenHighlightKey = new PluginKey<DecorationSet>("agreementTokenHighlight");

export const AgreementTokenHighlight = Extension.create({
  name: "agreementTokenHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: tokenHighlightKey,
        state: {
          init: (_config, state) => tokenDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? tokenDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return tokenHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});

/* -------------------------------------------------------------------------- */
/* Drops                                                                       */
/* -------------------------------------------------------------------------- */

/** Does this drag carry files (an image dragged in from the desktop)? */
export function dragHasFiles(event: Pick<DragEvent, "dataTransfer"> | null | undefined): boolean {
  const transfer = event?.dataTransfer;
  if (!transfer) return false;
  if (transfer.files && transfer.files.length > 0) return true;
  return Array.from(transfer.types ?? []).includes("Files");
}

export const AgreementDropGuard = Extension.create({
  name: "agreementDropGuard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("agreementDropGuard"),
        props: {
          // True = handled: ProseMirror calls preventDefault, so the browser
          // does not navigate to the dropped file. Text drops fall through to
          // ProseMirror's own insertion at the drop point.
          handleDrop: (_view, event) => dragHasFiles(event as DragEvent),
        },
      }),
    ];
  },
});

/** The `text/plain` a side-panel drag carries: exactly the token that is inserted. */
export function setTokenDragData(transfer: DataTransfer | null | undefined, token: string): void {
  if (!transfer) return;
  transfer.setData("text/plain", token);
  transfer.effectAllowed = "copy";
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tab inside a list does nothing, instead of nesting the item. The PDF
 * renderer matches lists with a lazy regex (route.ts `parseListItems`), so a
 * nested list comes out garbled: the inner items glued onto the outer one and
 * the rest of the list printed without bullets. Shift-Tab still un-nests a
 * nested list pasted in from elsewhere.
 */
export const AgreementNoNestedLists = Extension.create({
  name: "agreementNoNestedLists",
  // Ahead of ListItem's own `Tab: sinkListItem`.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => editor.isActive("listItem"),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* The extension set                                                           */
/* -------------------------------------------------------------------------- */

export const AGREEMENT_EDITOR_PLACEHOLDER = "Start writing your agreement…";

export function createAgreementEditorExtensions({ placeholder = AGREEMENT_EDITOR_PLACEHOLDER }: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Kept (as in v1) so an `href="{{booking_link}}"` survives a load and a
      // save, but a click in the editor never follows it and typing a URL never
      // turns into a link.
      link: { openOnClick: false, autolink: false, linkOnPaste: false },
      // Indigo, the v2 accent: where a dragged variable or field will land.
      dropcursor: { color: "#6366f1", width: 2 },
      // The PDF draws none of these (route.ts `parseInlineRuns` knows only
      // bold, italic and underline; `parseHtmlToBlocks` only h1-h3, p, lists,
      // tables and rules), so the editor does not offer them either, not even
      // through a markdown shortcut. Their text is kept when a template that
      // has them is loaded; only the formatting the PDF ignores goes.
      blockquote: false,
      codeBlock: false,
      code: false,
      strike: false,
    }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
    Placeholder.configure({ placeholder }),
    // Not resizable: the PDF renderer gives every column the same width, so a
    // dragged column edge would promise a layout the signed document lacks.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    OperatorSignatureImage,
    AgreementTokenHighlight,
    AgreementDropGuard,
    AgreementNoNestedLists,
  ];
}
