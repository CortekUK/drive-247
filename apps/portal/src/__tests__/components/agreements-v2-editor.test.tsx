/**
 * Agreements v2: the editor's parts (build-spec D6-D10).
 *
 *  - The Tiptap setup round-trips every real built-in template without losing
 *    a `{{variable}}`, a `{{#if}}` block marker or a BoldSign tag.
 *  - The operator-signature node accepts exactly a PNG/JPEG data URL carrying
 *    `data-operator-signature="true"`, and nothing else.
 *  - A dropped token lands at the DROP POINT (ProseMirror's own drop handler),
 *    not at the old cursor.
 *  - The side panel: each signature field emits its exact tag by click and by
 *    drag, and reads "Placed" once it is in the document; each variable's
 *    tooltip is its catalogue description over its example.
 *  - The signature pad's two v1 defects stay fixed, and uploads are checked.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";

const signatureHook = vi.hoisted(() => ({
  state: { signature: null as string | null, isLoading: false },
  save: vi.fn(async (_dataUrl: string) => ({ persisted: false })),
}));
// The real module (for its validation rule), with only the hook swapped out;
// its Supabase / tenant / auth imports are stubbed so nothing real is touched.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {}, supabaseUntyped: {} }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null }) }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: () => null }));
vi.mock("@/hooks/use-operator-signature-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-operator-signature-v2")>()),
  useOperatorSignatureV2: () => ({ ...signatureHook.state, save: signatureHook.save }),
}));

import {
  AgreementDropGuard,
  OPERATOR_SIGNATURE_NODE,
  classifyToken,
  createAgreementEditorExtensions,
  dragHasFiles,
  isInsideTableOrList,
  isOperatorSignatureSrc,
  setTokenDragData,
  SIGNATURE_PLACEMENT_REASON,
} from "@/components/agreements-v2/editor/editor-extensions";
import { OPERATOR_SIGNATURE_MAX_LENGTH, operatorSignatureHtml } from "@/components/agreements-v2/editor/operator-signature";
import { EditorSidePanelV2, countTag } from "@/components/agreements-v2/editor/editor-side-panel-v2";
import {
  VARIABLE_EXAMPLE_FALLBACK,
  groupVariablesV2,
  variableTooltipLines,
} from "@/components/agreements-v2/editor/variable-help";
import {
  SIGNATURE_PAD_HEIGHT,
  SIGNATURE_PAD_WIDTH,
  SignaturePadV2,
  cropRect,
  extendBounds,
  resolveInkColor,
  toPadPoint,
} from "@/components/agreements-v2/editor/signature-pad-v2";
import {
  BOOKING_SITE_SIGNATURE_NOTE,
  SIGNATURE_UPLOAD_MAX_BYTES,
  checkSignatureFile,
  signatureBytesMatchType,
} from "@/components/agreements-v2/editor/operator-signature-tab-v2";
import {
  AGREEMENT_STARTER_V2,
  duplicateSignerFieldsReasonV2,
  duplicatedSignerFieldsV2,
  withSignaturesSection,
} from "@/components/agreements-v2/editor/starter-content";
import { sanitizeAgreementHtmlV2 } from "@/components/agreements-v2/agreement-preview-v2";
import { TooltipProvider } from "@/components/ui-v2/tooltip";
import { OPERATOR_SIGNATURE_MAX_BYTES, isValidOperatorSignature } from "@/hooks/use-operator-signature-v2";
import {
  DEFAULT_AGREEMENT_TEMPLATE,
  DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE,
  EXTENSION_AGREEMENT_TEMPLATE,
  PAYG_AGREEMENT_TEMPLATE,
} from "@/lib/default-agreement-template";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";
import { SIGNATURE_FIELDS } from "@/lib/agreements-v2/types";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  const list = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = list;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function makeEditor(content: string, mount = false): Editor {
  const element = mount ? document.body.appendChild(document.createElement("div")) : undefined;
  const editor = new Editor({ extensions: createAgreementEditorExtensions(), content, element });
  editors.push(editor);
  return editor;
}

/** Every `{{…}}` token, in order, so a lost or rewritten one shows up by count and position. */
const tokens = (html: string) => html.match(/\{\{[^{}]*\}\}/g) ?? [];

/* -------------------------------------------------------------------------- */

describe("round-trip: the editor keeps every token of a real template", () => {
  const TEMPLATES = {
    standard: DEFAULT_AGREEMENT_TEMPLATE,
    payg: PAYG_AGREEMENT_TEMPLATE,
    extension: EXTENSION_AGREEMENT_TEMPLATE,
    installment: DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE,
  };

  it.each(Object.entries(TEMPLATES))("%s: same tokens, same order, after load and save", (_name, template) => {
    const before = tokens(template);
    expect(before.length).toBeGreaterThan(10);
    const editor = makeEditor(template);
    const html = editor.getHTML();
    expect(tokens(html)).toEqual(before);
    // …and loading what it saved again keeps them all too, with the same words.
    const again = makeEditor(html);
    expect(tokens(again.getHTML())).toEqual(before);
    expect(again.getText().replace(/\s+/g, " ")).toBe(editor.getText().replace(/\s+/g, " "));
  });

  it("keeps the BoldSign tags and the conditional block markers exactly", () => {
    const html = makeEditor(DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE).getHTML();
    expect(html).toContain("{{@sig1}}");
    expect(html).toContain("{{@date1}}");
    const withIf = makeEditor(DEFAULT_AGREEMENT_TEMPLATE).getHTML();
    expect(withIf).toContain("{{#if is_gig_driver}}");
    expect(withIf).toContain("{{/if}}");
  });

  it("keeps a variable inside a link target and a triple-brace variable", () => {
    const html = makeEditor('<p>Book at <a href="{{booking_link}}">here</a>, {{{customer_name}}}</p>').getHTML();
    expect(html).toContain('href="{{booking_link}}"');
    expect(html).toContain("{{{customer_name}}}");
  });

  it("keeps the words of formatting the PDF cannot draw, and drops only the formatting", () => {
    const html = makeEditor("<blockquote><p>Quoted {{customer_name}}</p></blockquote><p><s>struck</s> <code>{{@init1}}</code></p>").getHTML();
    expect(html).not.toMatch(/<blockquote|<s>|<code/);
    expect(tokens(html)).toEqual(["{{customer_name}}", "{{@init1}}"]);
    expect(html).toContain("struck");
  });
});

describe("the starter a new agreement begins with", () => {
  it("ends with the signatures section, company side first, and survives the editor", () => {
    const html = makeEditor(AGREEMENT_STARTER_V2).getHTML();
    expect(tokens(html)).toEqual(tokens(AGREEMENT_STARTER_V2));
    expect(html.indexOf("FOR THE COMPANY")).toBeLessThan(html.indexOf("FOR THE CUSTOMER"));
    expect(html.indexOf("FOR THE CUSTOMER")).toBeLessThan(html.indexOf("{{@sig1}}"));
    expect(html).toContain("{{@date1}}");
    // Only signer 1's fields, each once.
    expect(countTag(html, "{{@sig1}}")).toBe(1);
    expect(countTag(html, "{{@date1}}")).toBe(1);
  });

  it("appends the section only when there is no Signature field", () => {
    // The one shared definition: a "By signing below" sign-off first (the clause
    // injection anchors on it, so terms never land under the signatures), then
    // the section, company side before customer side.
    const signed = withSignaturesSection("<p>Terms</p>");
    expect(signed).toMatch(/^<p>Terms<\/p>\s*<p><strong>By signing below/);
    expect(signed).toMatch(/<hr>\s*<h2>Signatures<\/h2>/);
    expect(signed.indexOf("FOR THE COMPANY")).toBeLessThan(signed.indexOf("FOR THE CUSTOMER"));
    expect(signed.match(/\{\{@sig1\}\}/g)).toHaveLength(1);
    expect(withSignaturesSection("<p>Sign {{@sig1}}</p>")).toBe("<p>Sign {{@sig1}}</p>");
  });
});

describe("the operator's signature node", () => {
  it("round-trips the exact element, with a PNG or a JPEG data URL", () => {
    for (const src of [PNG, JPEG]) {
      const html = makeEditor(`<p>For the company</p>${operatorSignatureHtml(src)}`).getHTML();
      expect(html).toContain(`<img data-operator-signature="true" src="${src}" alt="Signature">`);
    }
  });

  it("is a block: it never ends up inside a paragraph", () => {
    const editor = makeEditor("<p>Before after</p>");
    editor.commands.setTextSelection(8);
    expect(editor.commands.insertOperatorSignature(PNG)).toBe(true);
    expect(editor.getHTML()).toBe(`<p>Before </p><img data-operator-signature="true" src="${PNG}" alt="Signature"><p>after</p>`);
  });

  it("drops every other image when loading", () => {
    const html = makeEditor(
      [
        `<img src="${PNG}">`,
        `<img data-operator-signature="true" src="https://evil.example/x.png">`,
        `<img data-operator-signature="true" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">`,
        `<img data-operator-signature="false" src="${PNG}">`,
        `<p>kept</p>`,
      ].join(""),
    ).getHTML();
    expect(html).toBe("<p>kept</p>");
  });

  it("refuses to insert anything but a PNG/JPEG data URL", () => {
    const editor = makeEditor("<p>x</p>");
    for (const bad of ["https://evil.example/x.png", "data:image/gif;base64,R0lGODlh", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", ""]) {
      expect(editor.commands.insertOperatorSignature(bad)).toBe(false);
    }
    expect(editor.getHTML()).toBe("<p>x</p>");
    expect(() => operatorSignatureHtml("https://evil.example/x.png")).toThrow();
  });

  it("uses the same rule as the hook and the table's size cap", () => {
    expect(OPERATOR_SIGNATURE_MAX_LENGTH).toBe(OPERATOR_SIGNATURE_MAX_BYTES);
    const big = `data:image/png;base64,${"A".repeat(OPERATOR_SIGNATURE_MAX_LENGTH)}`;
    for (const src of [PNG, JPEG, big, "data:image/gif;base64,R0lGODlh", "https://x/y.png", `${PNG}"`]) {
      expect(isOperatorSignatureSrc(src)).toBe(isValidOperatorSignature(src));
    }
    expect(OPERATOR_SIGNATURE_NODE).toBe("operatorSignature");
  });
});

/** Put the cursor inside the first text node containing `text`. */
function cursorIn(editor: Editor, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(text)) at = pos + 1;
  });
  expect(at).toBeGreaterThan(0);
  editor.commands.setTextSelection(at);
}

describe("the operator's signature: never inside a table or a list (the PDF drops it there)", () => {
  it.each([
    ["a table cell", "<table><tbody><tr><td><p>cell text</p></td></tr></tbody></table><p>after</p>"],
    ["a table header cell", "<table><tbody><tr><th><p>cell text</p></th></tr></tbody></table><p>after</p>"],
    ["a bullet list item", "<ul><li><p>cell text</p></li></ul><p>after</p>"],
    ["a numbered list item", "<ol><li><p>cell text</p></li></ol><p>after</p>"],
  ])("refuses to insert in %s, and changes nothing", (_where, content) => {
    const editor = makeEditor(content);
    cursorIn(editor, "cell text");
    const before = editor.getHTML();
    expect(isInsideTableOrList(editor.state.selection)).toBe(true);
    expect(editor.commands.insertOperatorSignature(PNG)).toBe(false);
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toContain("<img");
  });

  it("still inserts on a line of its own, outside any table or list", () => {
    const editor = makeEditor("<ul><li><p>item</p></li></ul><p>after</p>");
    cursorIn(editor, "after");
    expect(isInsideTableOrList(editor.state.selection)).toBe(false);
    expect(editor.commands.insertOperatorSignature(PNG)).toBe(true);
    expect(editor.getHTML()).toContain(`<img data-operator-signature="true" src="${PNG}" alt="Signature">`);
  });

  it("says why, in the operator's words", () => {
    expect(SIGNATURE_PLACEMENT_REASON).toBe("Put your signature on its own line, outside a table or list — it can't be printed there.");
  });

  it("the preview drops a signature that sits inside a td, th or li, and keeps one on its own line", () => {
    const sig = operatorSignatureHtml(PNG);
    for (const html of [
      `<table><tbody><tr><td>${sig}</td></tr></tbody></table>`,
      `<table><tbody><tr><th><p>${sig}</p></th></tr></tbody></table>`,
      `<ul><li><p>x</p>${sig}</li></ul>`,
      `<ol><li>${sig}</li></ol>`,
    ]) {
      expect(sanitizeAgreementHtmlV2(html)).not.toContain("<img");
    }
    expect(sanitizeAgreementHtmlV2(`<p>Signed:</p>${sig}`)).toContain(`src="${PNG}"`);
  });
});

describe("each signer field once", () => {
  it("finds the fields that appear more than once, with how often", () => {
    expect(duplicatedSignerFieldsV2("<p>{{@sig1}}</p><p>{{@init1}}</p><p>{{@date1}}</p>")).toEqual([]);
    expect(duplicatedSignerFieldsV2("<p>{{@sig1}} {{@sig1}}</p><p>{{@date1}}</p><p>{{@date1}}{{@date1}}</p>")).toEqual([
      { label: "Signature", tag: "{{@sig1}}", count: 2 },
      { label: "Date signed", tag: "{{@date1}}", count: 3 },
    ]);
  });

  it("says why, or nothing when each is there at most once", () => {
    expect(duplicateSignerFieldsReasonV2("<p>{{@sig1}}</p>")).toBeNull();
    expect(duplicateSignerFieldsReasonV2("")).toBeNull();
    expect(duplicateSignerFieldsReasonV2("<p>{{@init1}}</p><p>{{@init1}}</p>")).toMatch(/^Initials is in the agreement 2 times\. Keep one/);
    expect(duplicateSignerFieldsReasonV2("{{@sig1}}{{@sig1}}{{@init1}}{{@init1}}{{@date1}}{{@date1}}")).toMatch(
      /^Signature, Initials and Date signed are each in the agreement more than once\. Keep one of each/,
    );
  });
});

describe("dropping a token from the side panel", () => {
  const drop = (editor: Editor, text: string, pos: number, extra: Partial<DataTransfer> = {}) => {
    editor.view.posAtCoords = () => ({ pos, inside: -1 });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, {
      clientX: 40,
      clientY: 12,
      dataTransfer: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
        types: ["text/plain"],
        files: [],
        dropEffect: "copy",
        effectAllowed: "copy",
        ...extra,
      },
    });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    return event;
  };

  it("inserts at the drop point, not at the cursor", () => {
    const editor = makeEditor("<p>Hello world</p><p>Sign here</p>", true);
    editor.commands.setTextSelection(1); // the cursor is at the very start
    drop(editor, "{{@sig1}}", 7); // dropped between "Hello " and "world"
    expect(editor.getHTML()).toBe("<p>Hello {{@sig1}}world</p><p>Sign here</p>");
  });

  it("drops a variable into a later paragraph, far from the cursor", () => {
    const editor = makeEditor("<p>Hello world</p><p>Dear X</p>", true);
    editor.commands.setTextSelection(3);
    drop(editor, "{{customer_name}}", 19); // after "Dear " in the second paragraph
    expect(editor.getHTML()).toBe("<p>Hello world</p><p>Dear {{customer_name}}X</p>");
  });

  it("swallows a dropped file instead of letting the browser open it", () => {
    const editor = makeEditor("<p>x</p>", true);
    const event = drop(editor, "", 2, { types: ["Files"], files: [new File(["x"], "a.png")] as unknown as FileList });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe("<p>x</p>");
    expect(dragHasFiles({ dataTransfer: { types: ["Files"], files: [] } as unknown as DataTransfer })).toBe(true);
    expect(dragHasFiles({ dataTransfer: { types: ["text/plain"], files: [] } as unknown as DataTransfer })).toBe(false);
    expect(AgreementDropGuard.name).toBe("agreementDropGuard");
  });

  it("carries exactly the token as text/plain", () => {
    const set = vi.fn();
    const transfer = { setData: set, effectAllowed: "all" } as unknown as DataTransfer;
    setTokenDragData(transfer, "{{@init1}}");
    expect(set).toHaveBeenCalledWith("text/plain", "{{@init1}}");
    expect(transfer.effectAllowed).toBe("copy");
  });
});

describe("token highlighting is view-only", () => {
  it("tints tokens without changing the stored HTML", () => {
    const html = "<p>{{customer_name}} {{@sig1}} {{@sig9}} {{#if is_payg}}x{{/if}}</p>";
    const editor = makeEditor(html, true);
    const marks = Array.from(editor.view.dom.querySelectorAll(".agr-token")).map((el) => [
      el.textContent,
      el.getAttribute("data-token"),
      el.getAttribute("data-field"),
    ]);
    expect(marks).toEqual([
      ["{{customer_name}}", "variable", null],
      ["{{@sig1}}", "field", "signature"],
      ["{{@sig9}}", "field-unknown", null],
      ["{{#if is_payg}}", "logic", null],
      ["{{/if}}", "logic", null],
    ]);
    expect(editor.getHTML()).toBe(html);
    expect(classifyToken("{{@date1}}")).toEqual({ kind: "field", field: "date" });
  });
});

describe("no nested lists", () => {
  it("Tab in a list item does not nest it (the PDF cannot draw a nested list)", () => {
    const editor = makeEditor("<ul><li><p>one</p></li><li><p>two</p></li></ul>", true);
    editor.commands.setTextSelection(13); // inside "two"
    const before = editor.getHTML();
    const handled = editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })));
    expect(handled).toBe(true);
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toMatch(/<li><p>one<\/p><ul>/);
  });
});

/* -------------------------------------------------------------------------- */

describe("variable tooltips", () => {
  it("for every catalogue entry: its description, then 'e.g.:' and its sample, never blank", () => {
    expect(TEMPLATE_VARIABLES.length).toBeGreaterThan(100);
    for (const v of TEMPLATE_VARIABLES) {
      const lines = variableTooltipLines(v);
      expect(lines.description).toBe(v.description);
      expect(lines.example).toBe(`e.g.: ${v.sample.trim() || VARIABLE_EXAMPLE_FALLBACK}`);
      expect(lines.example.replace("e.g.:", "").trim()).not.toBe("");
    }
  });

  it("lists every variable exactly once, grouped by category", () => {
    const listed = groupVariablesV2("").flatMap((g) => g.variables.map((v) => v.key));
    expect(listed.sort()).toEqual(TEMPLATE_VARIABLES.map((v) => v.key).sort());
    expect(groupVariablesV2("{{customer_email")[0].variables.map((v) => v.key)).toContain("customer_email");
  });

  it("shows the description and the example in the row's tooltip", async () => {
    renderPanel({ tab: "variables" });
    const customerName = TEMPLATE_VARIABLES.find((v) => v.key === "customer_name")!;
    const row = document.querySelector('[data-token="{{customer_name}}"]') as HTMLElement;
    fireEvent.focus(row);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(customerName.description);
    expect(tip.textContent).toContain(`e.g.: ${customerName.sample}`);
  });

  it("a variable with an empty sample still says something", async () => {
    const blank = TEMPLATE_VARIABLES.find((v) => !v.sample.trim());
    expect(blank).toBeDefined();
    renderPanel({ tab: "variables" });
    fireEvent.focus(document.querySelector(`[data-token="{{${blank!.key}}}"]`) as HTMLElement);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(blank!.description);
    expect(tip.textContent).toContain(`e.g.: ${VARIABLE_EXAMPLE_FALLBACK}`);
  });

  it("clicking a row inserts {{key}}; dragging it carries {{key}}", () => {
    const { onInsertText } = renderPanel({ tab: "variables" });
    const row = document.querySelector('[data-token="{{vehicle_reg}}"]') as HTMLElement;
    fireEvent.click(row);
    expect(onInsertText).toHaveBeenCalledWith("{{vehicle_reg}}");
    const setData = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: "all" } });
    expect(setData).toHaveBeenCalledWith("text/plain", "{{vehicle_reg}}");
  });

  it("filters by search, with a no-match state", () => {
    renderPanel({ tab: "variables" });
    fireEvent.change(screen.getByLabelText("Search variables"), { target: { value: "odometer-nothing-matches" } });
    expect(screen.getByText(/No variables match/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

function renderPanel({ tab, content = "" }: { tab: "variables" | "fields" | "signature"; content?: string }) {
  const onInsertText = vi.fn();
  const onInsertSignature = vi.fn();
  const utils = render(
    <TooltipProvider>
      <EditorSidePanelV2
        open
        onClose={() => {}}
        content={content}
        onInsertText={onInsertText}
        onInsertSignature={onInsertSignature}
        tab={tab}
        onTabChange={() => {}}
      />
    </TooltipProvider>,
  );
  return { ...utils, onInsertText, onInsertSignature };
}

describe("signature fields", () => {
  it("clicking each field inserts its exact tag", () => {
    const { onInsertText } = renderPanel({ tab: "fields" });
    for (const field of SIGNATURE_FIELDS) {
      fireEvent.click(document.querySelector(`[data-field="${field.key}"]`) as HTMLElement);
    }
    expect(onInsertText.mock.calls.map((c) => c[0])).toEqual(["{{@sig1}}", "{{@init1}}", "{{@date1}}"]);
  });

  it("dragging each field carries exactly its tag as text/plain", () => {
    renderPanel({ tab: "fields" });
    for (const field of SIGNATURE_FIELDS) {
      const setData = vi.fn();
      const tile = document.querySelector(`[data-field="${field.key}"]`) as HTMLElement;
      expect(tile.getAttribute("draggable")).toBe("true");
      fireEvent.dragStart(tile, { dataTransfer: { setData, effectAllowed: "all" } });
      expect(setData).toHaveBeenCalledWith("text/plain", field.tag);
    }
  });

  it("a field already in the document reads Placed and cannot be placed again", () => {
    const { onInsertText } = renderPanel({ tab: "fields", content: "<p>Sign: {{@sig1}}</p>" });
    const sig = document.querySelector('[data-field="signature"]') as HTMLButtonElement;
    expect(sig.getAttribute("data-state")).toBe("placed");
    expect(within(sig).getByText("Placed")).toBeInTheDocument();
    expect(sig.disabled).toBe(true);
    expect(sig.getAttribute("draggable")).toBe("false");
    fireEvent.click(sig);
    expect(onInsertText).not.toHaveBeenCalled();
    // The other two are still available.
    for (const key of ["initials", "date"]) {
      const tile = document.querySelector(`[data-field="${key}"]`) as HTMLButtonElement;
      expect(tile.getAttribute("data-state")).toBe("available");
      expect(tile.disabled).toBe(false);
    }
  });

  it("warns when a tag is in the document twice", () => {
    renderPanel({ tab: "fields", content: "<p>{{@date1}}</p><p>{{@date1}}</p>" });
    expect(screen.getByRole("alert").textContent).toMatch(/Date signed is in the agreement 2 times/);
    expect(countTag("{{@sig1}}{{@sig1}}{{@sig1}}", "{{@sig1}}")).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */

describe("your signature", () => {
  beforeEach(() => {
    signatureHook.state = { signature: null, isLoading: false };
    signatureHook.save.mockReset();
    signatureHook.save.mockResolvedValue({ persisted: false });
  });

  it("with a saved signature, 'Use my signature' inserts it", () => {
    signatureHook.state = { signature: PNG, isLoading: false };
    const { onInsertSignature } = renderPanel({ tab: "signature" });
    fireEvent.click(screen.getByRole("button", { name: "Use my signature" }));
    expect(onInsertSignature).toHaveBeenCalledWith(PNG);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("'Use my signature' where it cannot go says why", () => {
    signatureHook.state = { signature: PNG, isLoading: false };
    const { onInsertSignature } = renderPanel({ tab: "signature" });
    onInsertSignature.mockReturnValue(SIGNATURE_PLACEMENT_REASON);
    fireEvent.click(screen.getByRole("button", { name: "Use my signature" }));
    expect(screen.getByRole("status").textContent).toBe(`Not added. ${SIGNATURE_PLACEMENT_REASON}`);
  });

  it("Save & use where it cannot go says why, and keeps the drawing to try again", async () => {
    const { onInsertSignature } = renderPanel({ tab: "signature" });
    onInsertSignature.mockReturnValue(SIGNATURE_PLACEMENT_REASON);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Upload/ }));
    const bytes = Uint8Array.from(atob(PNG.split(",")[1]), (c) => c.charCodeAt(0));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload your signature"), {
        target: { files: [new File([bytes], "sig.png", { type: "image/png" })] },
      });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & use" }));
    });
    expect(onInsertSignature).toHaveBeenCalledWith(PNG);
    expect(screen.getByRole("status").textContent).toBe(`Not added. ${SIGNATURE_PLACEMENT_REASON}`);
    // Not kept (persisted: false), so the image is still there for another go.
    expect(screen.getByRole("button", { name: "Save & use" })).toBeEnabled();
  });

  it("says, quietly, that the booking site's checkout agreements do not carry it yet", () => {
    renderPanel({ tab: "signature" });
    expect(screen.getByText(BOOKING_SITE_SIGNATURE_NOTE)).toBeInTheDocument();
    expect(BOOKING_SITE_SIGNATURE_NOTE).toBe(
      "Your signature is added to agreements sent from the portal. Agreements your booking site sends automatically at checkout don't include it yet.",
    );
    // Quiet: not an alert, not a status.
    expect(screen.getByText(BOOKING_SITE_SIGNATURE_NOTE).getAttribute("role")).toBeNull();
  });

  it("Save & use stays disabled until there is an image, then saves AND inserts it", async () => {
    const { onInsertSignature } = renderPanel({ tab: "signature" });
    const saveUse = screen.getByRole("button", { name: "Save & use" });
    expect(saveUse).toBeDisabled();
    expect(screen.getByText("I understand that this is a legal representation of my signature.")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Upload/ }));
    const input = screen.getByLabelText("Upload your signature") as HTMLInputElement;
    const bytes = Uint8Array.from(atob(PNG.split(",")[1]), (c) => c.charCodeAt(0));
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([bytes], "sig.png", { type: "image/png" })] } });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(saveUse).toBeEnabled();
    await act(async () => {
      fireEvent.click(saveUse);
    });
    expect(signatureHook.save).toHaveBeenCalledWith(PNG);
    expect(onInsertSignature).toHaveBeenCalledWith(PNG);
    // Not kept (the table is not there yet): said quietly, the insert still happened.
    expect(screen.getByRole("status").textContent).toMatch(/not kept for next time/);
  });

  it("refuses a non-image upload with a reason", async () => {
    renderPanel({ tab: "signature" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Upload/ }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload your signature"), {
        target: { files: [new File(["GIF89a"], "sig.gif", { type: "image/gif" })] },
      });
    });
    expect(screen.getByRole("alert").textContent).toBe("Choose a PNG or JPEG image.");
    expect(screen.getByRole("button", { name: "Save & use" })).toBeDisabled();
  });

  it("checks files: type, size that still fits the stored cap, and real PNG/JPEG bytes", () => {
    expect(checkSignatureFile({ type: "image/svg+xml", size: 10 })).toMatch(/PNG or JPEG/);
    expect(checkSignatureFile({ type: "image/png", size: SIGNATURE_UPLOAD_MAX_BYTES + 1 })).toMatch(/too large/);
    expect(checkSignatureFile({ type: "image/jpeg", size: SIGNATURE_UPLOAD_MAX_BYTES })).toBeNull();
    // The largest allowed file still encodes within the 512 000-character cap.
    expect("data:image/jpeg;base64,".length + (SIGNATURE_UPLOAD_MAX_BYTES / 3) * 4).toBeLessThanOrEqual(OPERATOR_SIGNATURE_MAX_LENGTH);
    expect(signatureBytesMatchType(PNG)).toBe(true);
    expect(signatureBytesMatchType(JPEG)).toBe(true);
    expect(signatureBytesMatchType("data:image/png;base64,R0lGODlhAQABAAAAACw=")).toBe(false);
  });
});

describe("the signature pad", () => {
  it("maps a pointer into the same drawing space whatever size the pad is shown at", () => {
    const small = { left: 10, top: 20, width: 300, height: 100 };
    const large = { left: 10, top: 20, width: 900, height: 300 };
    expect(toPadPoint(160, 70, small)).toEqual({ x: SIGNATURE_PAD_WIDTH / 2, y: SIGNATURE_PAD_HEIGHT / 2 });
    expect(toPadPoint(460, 170, large)).toEqual({ x: SIGNATURE_PAD_WIDTH / 2, y: SIGNATURE_PAD_HEIGHT / 2 });
    expect(toPadPoint(-50, 999, small)).toEqual({ x: 0, y: SIGNATURE_PAD_HEIGHT });
  });

  it("the ink is a real CSS colour read from the pad, not a bare HSL triple", () => {
    const el = document.createElement("canvas");
    el.style.color = "rgb(15, 23, 42)";
    document.body.appendChild(el);
    expect(resolveInkColor(el)).toBe("rgb(15, 23, 42)");
    expect(resolveInkColor(el)).not.toMatch(/^\d+\s+\d+%\s+\d+%$/);
    expect(resolveInkColor(null)).toBe("#0f172a");
  });

  it("a window resize never resizes (and so never wipes) the drawing bitmap", () => {
    render(<SignaturePadV2 onChange={() => {}} />);
    const canvas = screen.getByLabelText("Draw your signature") as HTMLCanvasElement;
    const before = [canvas.width, canvas.height];
    expect(before).toEqual([SIGNATURE_PAD_WIDTH * 2, SIGNATURE_PAD_HEIGHT * 2]);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect([canvas.width, canvas.height]).toEqual(before);
  });

  it("crops the exported image to the strokes", () => {
    let b = extendBounds(null, { x: 100, y: 50 });
    b = extendBounds(b, { x: 300, y: 120 });
    // Strokes span x 97.5-302.5, y 47.5-122.5 (line width included), plus a
    // 10-unit margin, at 2 bitmap pixels per unit.
    expect(cropRect(b)).toEqual({ x: 175, y: 75, width: 450, height: 190 });
  });
});
