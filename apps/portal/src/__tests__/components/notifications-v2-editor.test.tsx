/**
 * Notifications v2: the Notion-like email editor (build-spec D17) and the
 * plain variable field. Behaviour only — no source-text pins.
 *
 *  - pure helpers: loading {{key}} as chips, the "/" and "{{" triggers, menu
 *    filtering, link clean-up, caret insertion;
 *  - a real Tiptap editor (jsdom): stored HTML survives load → save unchanged
 *    (every catalog default included), buttons and dividers serialise as the
 *    email layout expects, and the "/" menu state follows the caret;
 *  - the React editor: no onChange on mount or on an outside value swap,
 *    read-only, and Insert variable;
 *  - VariableTextInput: inserts at the caret and respects maxLength.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  EMAIL_BUTTON_DEFAULT_TEXT,
  SLASH_COMMANDS,
  TURN_INTO_COMMANDS,
  activeBlockId,
  applyBlockCommand,
  createNotificationEditorExtensions,
  describeButtonHref,
  emailButtonAt,
  filterSlashCommands,
  filterVariables,
  insertVariable,
  isAllowedHref,
  matchSuggestionTrigger,
  normaliseLinkHref,
  serializeEditorHtml,
  setEmailButtonHref,
  suggestionPluginKey,
  wrapKnownVariables,
} from "@/components/settings-v2/notifications-v2/editor-extensions";
import NotificationTemplateEditor from "@/components/settings-v2/notifications-v2/template-editor";
import { VariableTextInput, groupVariables, insertAtSelection } from "@/components/settings-v2/notifications-v2/variable-text-input";
import { NOTIFICATION_CATALOG } from "@/lib/notifications-v2/catalog";
import { NOTIFICATION_VARIABLES, getVariable } from "@/lib/notifications-v2/variables";
import type { NotificationVariable } from "@/lib/notifications-v2/types";

/* -------------------------------------------------------------------------- */
/* jsdom gaps ProseMirror and Radix touch                                      */
/* -------------------------------------------------------------------------- */

beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  const list = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = list;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  // Radix menus measure with a constructible ResizeObserver; the shared setup mock isn't one.
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

const vars = (...keys: string[]) => keys.map((k) => getVariable(k)!).filter(Boolean) as NotificationVariable[];
const ALL_KEYS = NOTIFICATION_VARIABLES.map((v) => v.key);

/** A headless editor with the same extension set the component uses. */
function makeEditor(html: string, known: readonly string[] = ALL_KEYS) {
  const isKnown = (k: string) => known.includes(k);
  const editor = new Editor({
    extensions: createNotificationEditorExtensions({
      isKnownVariable: isKnown,
      getVariableLabel: (k) => getVariable(k)?.label ?? k,
    }),
    content: wrapKnownVariables(html, isKnown),
  });
  editors.push(editor);
  return editor;
}

const roundTrip = (html: string, known?: readonly string[]) => serializeEditorHtml(makeEditor(html, known));

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe("wrapKnownVariables", () => {
  it("wraps known {{key}} in text as chip markup and leaves unknown ones as text", () => {
    expect(wrapKnownVariables("<p>Hi {{customer_name}}, {{mystery}}</p>", ["customer_name"])).toBe(
      '<p>Hi <span data-variable="customer_name">{{customer_name}}</span>, {{mystery}}</p>',
    );
  });

  it("never touches attribute values, even with > inside quotes", () => {
    const html = '<p><a data-email-button href="{{payment_url}}" title="a > b {{payment_url}}">Pay {{rental_amount}}</a></p>';
    expect(wrapKnownVariables(html, ["payment_url", "rental_amount"])).toBe(
      '<p><a data-email-button href="{{payment_url}}" title="a > b {{payment_url}}">Pay <span data-variable="rental_amount">{{rental_amount}}</span></a></p>',
    );
  });

  it("returns text without variables unchanged, and handles empty input", () => {
    expect(wrapKnownVariables("<p>Hello</p>", ["x"])).toBe("<p>Hello</p>");
    expect(wrapKnownVariables("", ["x"])).toBe("");
    expect(wrapKnownVariables(null, ["x"])).toBe("");
  });
});

describe("matchSuggestionTrigger", () => {
  it("opens the block menu for / at the start of a line or after a space", () => {
    expect(matchSuggestionTrigger("/")).toEqual({ kind: "slash", query: "", length: 1 });
    expect(matchSuggestionTrigger("Hello /head")).toEqual({ kind: "slash", query: "head", length: 5 });
  });

  it("ignores / inside words and links", () => {
    expect(matchSuggestionTrigger("and/or")).toBeNull();
    expect(matchSuggestionTrigger("https://")).toBeNull();
    expect(matchSuggestionTrigger("Hello / there")).toBeNull();
  });

  it("opens the variable picker after {{, with the query typed so far", () => {
    expect(matchSuggestionTrigger("Hi {{")).toEqual({ kind: "variable", query: "", length: 2 });
    expect(matchSuggestionTrigger("Hi {{cust")).toEqual({ kind: "variable", query: "cust", length: 6 });
    expect(matchSuggestionTrigger("Hi {{customer_name}}")).toBeNull();
  });

  it("can switch the block menu off (inside a button) but keep variables", () => {
    expect(matchSuggestionTrigger("/", { slash: false })).toBeNull();
    expect(matchSuggestionTrigger("{{pay", { slash: false })?.kind).toBe("variable");
  });
});

describe("the block menu", () => {
  it("lists the nine blocks the lead asked for, in order", () => {
    expect(SLASH_COMMANDS.map((c) => c.title)).toEqual([
      "Text",
      "Heading",
      "Subheading",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Divider",
      "Button",
      "Variable",
    ]);
    expect(TURN_INTO_COMMANDS.map((c) => c.id)).toEqual(["text", "heading", "subheading", "bullet_list", "numbered_list", "quote"]);
  });

  it("filters by title first, then keywords", () => {
    expect(filterSlashCommands("").length).toBe(SLASH_COMMANDS.length);
    expect(filterSlashCommands("head").map((c) => c.id)).toEqual(["heading", "subheading"]);
    expect(filterSlashCommands("h3").map((c) => c.id)).toEqual(["subheading"]);
    expect(filterSlashCommands("list").map((c) => c.id)).toEqual(["bullet_list", "numbered_list"]);
    expect(filterSlashCommands("BUT").map((c) => c.id)).toEqual(["button"]);
    expect(filterSlashCommands("hr").map((c) => c.id)).toEqual(["divider"]);
    expect(filterSlashCommands("zzz")).toEqual([]);
  });
});

describe("variables in menus", () => {
  const list = vars("customer_name", "customer_email", "rental_amount", "payment_url", "company_name");

  it("filters by label or key, label prefix first", () => {
    expect(filterVariables(list, "").map((v) => v.key)).toEqual(list.map((v) => v.key));
    expect(filterVariables(list, "cust").map((v) => v.key)).toEqual(["customer_name", "customer_email"]);
    expect(filterVariables(list, "customer em").map((v) => v.key)).toEqual(["customer_email"]);
    expect(filterVariables(list, "payment_u").map((v) => v.key)).toEqual(["payment_url"]);
    expect(filterVariables(list, "nothing-like-this")).toEqual([]);
  });

  it("groups them in a fixed order and drops empty groups", () => {
    const groups = groupVariables(list);
    expect(groups.map((g) => g.group)).toEqual(["customer", "money", "company", "links"]);
    expect(groups[0].items.map((v) => v.key)).toEqual(["customer_name", "customer_email"]);
  });
});

describe("links", () => {
  it("allows only what the email sanitiser keeps", () => {
    expect(isAllowedHref("https://example.com")).toBe(true);
    expect(isAllowedHref("mailto:jo@example.com")).toBe(true);
    expect(isAllowedHref("{{payment_url}}")).toBe(true);
    expect(isAllowedHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedHref("tel:+15550100")).toBe(false);
    expect(isAllowedHref("")).toBe(false);
  });

  it("cleans up what the operator typed, or says it can't be used", () => {
    expect(normaliseLinkHref("  ")).toBe("");
    expect(normaliseLinkHref("example.com/book")).toBe("https://example.com/book");
    expect(normaliseLinkHref("www.example.com")).toBe("https://www.example.com");
    expect(normaliseLinkHref("jo@example.com")).toBe("mailto:jo@example.com");
    expect(normaliseLinkHref("{{customer_portal_url}}")).toBe("{{customer_portal_url}}");
    expect(normaliseLinkHref("javascript:alert(1)")).toBeNull();
    expect(normaliseLinkHref("not a link")).toBeNull();
  });

  it("describes where a button goes, by variable label when it is one", () => {
    const label = (k: string) => getVariable(k)?.label ?? k;
    expect(describeButtonHref(null, label)).toEqual({ text: "Add a link to this button", missing: true });
    expect(describeButtonHref("{{payment_url}}", label)).toEqual({ text: `Link: ${label("payment_url")}`, missing: false });
    expect(describeButtonHref("https://example.com", label).text).toBe("Link: https://example.com");
  });
});

describe("insertAtSelection", () => {
  it("replaces the selection with the token and puts the caret after it", () => {
    expect(insertAtSelection("Hi , welcome", "{{customer_name}}", { start: 3, end: 3 })).toEqual({
      ok: true,
      value: "Hi {{customer_name}}, welcome",
      caret: 20,
    });
    expect(insertAtSelection("Hi NAME!", "{{x}}", { start: 3, end: 7 }).value).toBe("Hi {{x}}!");
  });

  it("appends when there is no selection, and clamps a stale one", () => {
    expect(insertAtSelection("Hi", " {{x}}", null).value).toBe("Hi {{x}}");
    expect(insertAtSelection("Hi", "{{x}}", { start: 40, end: 50 }).value).toBe("Hi{{x}}");
  });

  it("refuses rather than cutting text when it would pass maxLength", () => {
    const r = insertAtSelection("12345678", "{{abc}}", { start: 8, end: 8 }, 10);
    expect(r.ok).toBe(false);
    expect(r.value).toBe("12345678");
    expect(insertAtSelection("123", "{{a}}", { start: 3, end: 3 }, 10).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* A real editor                                                               */
/* -------------------------------------------------------------------------- */

describe("load → save round trip", () => {
  it("shows a known variable as a chip and saves it back as {{key}}", () => {
    const html = "<p>Hi {{customer_name}},</p>";
    const editor = makeEditor(html);
    const chips: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "variable") chips.push(n.attrs.key);
    });
    expect(chips).toEqual(["customer_name"]);
    expect(editor.view.dom.querySelector('[data-variable="customer_name"]')?.textContent).toBe("Customer name");
    expect(serializeEditorHtml(editor)).toBe(html);
    // Tiptap's own getHTML() carries the same literal text inside a span.
    expect(editor.getHTML()).toContain("{{customer_name}}");
  });

  it("turns chip markup for another notification's variable back into plain text", () => {
    const editor = makeEditor('<p><span data-variable="payment_url">{{payment_url}}</span></p>', ["customer_name"]);
    let chips = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "variable") chips++;
    });
    expect(chips).toBe(0);
    expect(serializeEditorHtml(editor)).toBe("<p>{{payment_url}}</p>");
  });

  it("keeps unknown {{x}} as plain text", () => {
    const editor = makeEditor("<p>Hi {{mystery}} and {{customer_name}}</p>", ["customer_name"]);
    let chips = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "variable") chips++;
    });
    expect(chips).toBe(1);
    expect(serializeEditorHtml(editor)).toBe("<p>Hi {{mystery}} and {{customer_name}}</p>");
  });

  it("keeps marks, lists, quotes, headings and dividers in the stored shape", () => {
    for (const html of [
      "<p><strong>{{customer_name}}</strong> just booked.</p>",
      "<ul><li>Booking: {{rental_number}}</li><li>Total: {{rental_amount}}</li></ul>",
      "<ol><li>One</li><li>Two</li></ol>",
      "<h2>Title</h2><h3>Sub</h3><p>Body <em>x</em> <u>y</u></p>",
      "<blockquote>Quoted</blockquote><hr><p>After</p>",
      '<p>See <a href="{{customer_portal_url}}">your booking</a>.</p>',
      "<p>Line one<br>Line two</p>",
    ]) {
      expect(roundTrip(html)).toBe(html);
    }
  });

  it("gives the same output for the same input, and an empty editor is empty", () => {
    const html = '<p>Hi {{customer_name}}</p><p><a data-email-button href="{{payment_url}}">Pay now</a></p>';
    expect(roundTrip(html)).toBe(roundTrip(html));
    expect(roundTrip("")).toBe("");
    expect(roundTrip("<p></p>")).toBe("");
  });

  it("drops what an email can't carry (h1 becomes text, scripts go)", () => {
    expect(roundTrip("<h1>Big</h1>")).toBe("<p>Big</p>");
    expect(roundTrip('<p>Hi</p><script>alert(1)</script><img src="x" onerror="alert(1)">')).toBe("<p>Hi</p>");
    expect(roundTrip('<p><a href="javascript:alert(1)">x</a></p>')).toBe("<p>x</p>");
  });

  it("round-trips every catalog email default byte for byte", () => {
    const bodies = NOTIFICATION_CATALOG.flatMap((item) =>
      item.channels.email ? [{ key: item.key, body: item.channels.email.defaultTemplate.body, vars: item.variables }] : [],
    );
    expect(bodies.length).toBeGreaterThan(0);
    for (const { key, body, vars: itemVars } of bodies) {
      expect({ key, html: roundTrip(body, itemVars) }).toEqual({ key, html: body });
    }
  });
});

describe("the email button", () => {
  it("parses and serialises as <p><a data-email-button href>Text</a></p>", () => {
    const html = '<p><a data-email-button href="{{payment_url}}">Pay {{rental_amount}}</a></p>';
    const editor = makeEditor(html);
    expect(editor.state.doc.firstChild?.type.name).toBe("emailButton");
    expect(editor.state.doc.firstChild?.attrs.href).toBe("{{payment_url}}");
    expect(serializeEditorHtml(editor)).toBe(html);
  });

  it("shows where it goes beside it in the editor", () => {
    const editor = makeEditor('<p><a data-email-button href="{{payment_url}}">Pay</a></p>');
    const caption = editor.view.dom.querySelector("[data-button-caption]");
    expect(caption?.textContent).toBe(`Link: ${getVariable("payment_url")!.label}`);
    expect(caption?.getAttribute("data-missing")).toBe("false");
  });

  it("is inserted from the block menu on an empty line with its text selected", () => {
    const editor = makeEditor("<p>Intro</p><p>/</p>");
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    const s = suggestionPluginKey.getState(editor.state)!;
    expect(s).toMatchObject({ active: true, kind: "slash", query: "" });
    applyBlockCommand(editor, "button", { from: s.from, to: s.to });
    expect(serializeEditorHtml(editor)).toBe(`<p>Intro</p><p><a data-email-button>${EMAIL_BUTTON_DEFAULT_TEXT}</a></p>`);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe(EMAIL_BUTTON_DEFAULT_TEXT);
    expect(editor.view.dom.querySelector("[data-button-caption]")?.getAttribute("data-missing")).toBe("true");

    expect(setEmailButtonHref(editor, "{{payment_url}}")).toBe(true);
    expect(emailButtonAt(editor.state)?.node.attrs.href).toBe("{{payment_url}}");
    expect(serializeEditorHtml(editor)).toBe(
      `<p>Intro</p><p><a data-email-button href="{{payment_url}}">${EMAIL_BUTTON_DEFAULT_TEXT}</a></p>`,
    );
    expect(setEmailButtonHref(editor, "javascript:alert(1)")).toBe(true);
    expect(emailButtonAt(editor.state)?.node.attrs.href).toBeNull();
  });

  it("goes on the next line when the current one has text", () => {
    const editor = makeEditor("<p>Pay here</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    applyBlockCommand(editor, "button");
    expect(serializeEditorHtml(editor)).toBe(`<p>Pay here</p><p><a data-email-button>${EMAIL_BUTTON_DEFAULT_TEXT}</a></p>`);
  });

  it("turns back into text", () => {
    const editor = makeEditor('<p><a data-email-button href="{{payment_url}}">Pay</a></p>');
    editor.commands.setTextSelection(2);
    applyBlockCommand(editor, "text");
    expect(serializeEditorHtml(editor)).toBe("<p>Pay</p>");
  });
});

describe("block commands and the suggestion state", () => {
  const typeAtEnd = (editor: Editor, text: string) => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(text);
  };

  it("turns '/head' into a heading and removes what was typed", () => {
    const editor = makeEditor("<p>Welcome</p>");
    typeAtEnd(editor, " /head");
    const s = suggestionPluginKey.getState(editor.state)!;
    expect(s).toMatchObject({ active: true, kind: "slash", query: "head" });
    applyBlockCommand(editor, filterSlashCommands(s.query)[0].id, { from: s.from, to: s.to });
    expect(serializeEditorHtml(editor)).toBe("<h2>Welcome </h2>");
    expect(activeBlockId(editor.state)).toBe("heading");
  });

  it("inserts a divider, a list and a quote", () => {
    const editor = makeEditor("<p>A</p>");
    editor.commands.setTextSelection(2);
    applyBlockCommand(editor, "bullet_list");
    expect(serializeEditorHtml(editor)).toBe("<ul><li>A</li></ul>");
    expect(activeBlockId(editor.state)).toBe("bullet_list");
    applyBlockCommand(editor, "quote");
    expect(serializeEditorHtml(editor)).toBe("<blockquote>A</blockquote>");
    applyBlockCommand(editor, "text");
    expect(serializeEditorHtml(editor)).toBe("<p>A</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    applyBlockCommand(editor, "divider");
    expect(serializeEditorHtml(editor)).toMatch(/^<p>A<\/p><hr>/);
  });

  it("opens the variable picker on {{ and replaces '{{cust' with a chip", () => {
    const editor = makeEditor("<p>Hi</p>");
    typeAtEnd(editor, " {{cust");
    const s = suggestionPluginKey.getState(editor.state)!;
    expect(s).toMatchObject({ active: true, kind: "variable", query: "cust" });
    insertVariable(editor, "customer_name", { from: s.from, to: s.to });
    expect(serializeEditorHtml(editor)).toBe("<p>Hi {{customer_name}}</p>");
    expect(suggestionPluginKey.getState(editor.state)!.active).toBe(false);
  });

  it("'Variable' in the block menu types {{ so the picker opens in place", () => {
    const editor = makeEditor("<p>/var</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const s = suggestionPluginKey.getState(editor.state)!;
    applyBlockCommand(editor, "variable", { from: s.from, to: s.to });
    expect(suggestionPluginKey.getState(editor.state)).toMatchObject({ active: true, kind: "variable", query: "" });
  });

  it("stays closed after Escape until the trigger is gone", () => {
    const editor = makeEditor("<p>x</p>");
    typeAtEnd(editor, " /");
    editor.view.dispatch(editor.state.tr.setMeta(suggestionPluginKey, { dismiss: true }));
    expect(suggestionPluginKey.getState(editor.state)!.active).toBe(false);
    editor.commands.insertContent("he");
    expect(suggestionPluginKey.getState(editor.state)!.active).toBe(false);
    editor.commands.insertContent(" /");
    expect(suggestionPluginKey.getState(editor.state)!.active).toBe(true);
  });

  it("turns a hand-typed {{known}} into a chip and leaves unknown ones", () => {
    const editor = makeEditor("<p>Hi</p>", ["customer_name"]);
    const typeChar = (text: string) => {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, text, () => editor.state.tr));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
    };
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    for (const ch of " {{customer_name}} {{nope}}") typeChar(ch);
    expect(serializeEditorHtml(editor)).toBe("<p>Hi {{customer_name}} {{nope}}</p>");
    let chips = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "variable") chips++;
    });
    expect(chips).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The React editor                                                            */
/* -------------------------------------------------------------------------- */

const EDITOR_VARS = vars("customer_name", "rental_amount", "company_name", "payment_url");

function editorDom(container: HTMLElement) {
  return container.querySelector(".ProseMirror") as HTMLElement & { editor?: Editor };
}

describe("NotificationTemplateEditor", () => {
  it("never calls onChange on mount, even when its own spelling of the value differs", async () => {
    const onChange = vi.fn();
    // Tiptap would spell this <li><p>…</p></li> and data-email-button="" without our serialiser.
    const value = '<p>Hi {{customer_name}}</p><ul><li>{{rental_amount}}</li></ul><p><a data-email-button href="{{payment_url}}">Pay</a></p>';
    const { container } = render(<NotificationTemplateEditor value={value} onChange={onChange} variables={EDITOR_VARS} />);
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    expect(editorDom(container).querySelector('[data-variable="customer_name"]')?.textContent).toBe("Customer name");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loads an outside value swap silently, then reports real edits", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <NotificationTemplateEditor value="<p>First</p>" onChange={onChange} variables={EDITOR_VARS} />,
    );
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    rerender(<NotificationTemplateEditor value="<p>Second {{company_name}}</p>" onChange={onChange} variables={EDITOR_VARS} />);
    await waitFor(() => expect(editorDom(container).textContent).toContain("Second"));
    expect(onChange).not.toHaveBeenCalled();

    const editor = editorDom(container).editor!;
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent("!");
    });
    expect(onChange).toHaveBeenLastCalledWith("<p>Second {{company_name}}!</p>");
  });

  it("reports the original string when an edit is undone back to it", async () => {
    const value = "<ul><li>One</li></ul>";
    function Harness({ spy }: { spy: (v: string) => void }) {
      const [v, setV] = useState(value);
      return (
        <NotificationTemplateEditor
          value={v}
          onChange={(next) => {
            spy(next);
            setV(next);
          }}
          variables={EDITOR_VARS}
        />
      );
    }
    const spy = vi.fn();
    const { container } = render(<Harness spy={spy} />);
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    const editor = editorDom(container).editor!;
    act(() => {
      editor.commands.setTextSelection(4);
      editor.commands.insertContent("X");
    });
    expect(spy).toHaveBeenLastCalledWith("<ul><li>OXne</li></ul>");
    act(() => {
      editor.commands.setTextSelection({ from: 4, to: 5 });
      editor.commands.deleteSelection();
    });
    expect(spy).toHaveBeenLastCalledWith(value);
  });

  it("is read-only when asked: not editable, no menus, no Insert variable", async () => {
    const { container, rerender } = render(
      <NotificationTemplateEditor value="<p>Hi</p>" onChange={vi.fn()} variables={EDITOR_VARS} readOnly ariaLabel="Booking email" />,
    );
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    const dom = editorDom(container);
    expect(dom.getAttribute("contenteditable")).toBe("false");
    expect(dom.getAttribute("aria-readonly")).toBe("true");
    expect(dom.getAttribute("aria-label")).toBe("Booking email");
    expect(screen.queryByRole("button", { name: /insert variable/i })).toBeNull();

    rerender(<NotificationTemplateEditor value="<p>Hi</p>" onChange={vi.fn()} variables={EDITOR_VARS} ariaLabel="Booking email" />);
    await waitFor(() => expect(editorDom(container).getAttribute("contenteditable")).toBe("true"));
    expect(screen.getByRole("button", { name: /insert variable/i })).toBeTruthy();
  });

  it("inserts a variable chip from the Insert variable menu", async () => {
    const onChange = vi.fn();
    const { container } = render(<NotificationTemplateEditor value="<p>Hi</p>" onChange={onChange} variables={EDITOR_VARS} />);
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    const trigger = screen.getByRole("button", { name: /insert variable/i });
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    });
    const item = (await screen.findAllByRole("menuitem")).find((m) => m.textContent?.includes("Customer name"))!;
    act(() => item.click());
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // Never focused, so the chip goes at the end.
    expect(onChange.mock.calls.at(-1)![0]).toBe("<p>Hi{{customer_name}}</p>");
  });

  it("shows the block menu at the caret and filters it as you type", async () => {
    const { container } = render(<NotificationTemplateEditor value="<p></p>" onChange={vi.fn()} variables={EDITOR_VARS} />);
    await waitFor(() => expect(editorDom(container)).toBeTruthy());
    const editor = editorDom(container).editor!;
    act(() => {
      editor.commands.focus();
      editor.view.dom.dispatchEvent(new FocusEvent("focus"));
      editor.commands.insertContent("/");
    });
    const listbox = await screen.findByRole("listbox", { name: "Blocks" });
    expect(Array.from(listbox.querySelectorAll('[role="option"]')).map((o) => o.querySelector("span span")?.textContent)).toEqual(
      SLASH_COMMANDS.map((c) => c.title),
    );
    act(() => {
      editor.commands.insertContent("quo");
    });
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Blocks" }).querySelectorAll('[role="option"]').length).toBe(1));

    let handled: unknown;
    act(() => {
      handled = editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Enter" })));
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(activeBlockId(editor.state)).toBe("quote");
  });
});

describe("NotificationTemplateEditor menus", () => {
  const key = (editor: Editor, k: string) => {
    let handled: unknown;
    act(() => {
      handled = editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: k })));
    });
    return handled;
  };

  async function mount(value: string, onChange = vi.fn()) {
    const utils = render(<NotificationTemplateEditor value={value} onChange={onChange} variables={EDITOR_VARS} />);
    await waitFor(() => expect(editorDom(utils.container)).toBeTruthy());
    const editor = editorDom(utils.container).editor!;
    act(() => {
      editor.commands.focus("end");
      editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    });
    return { ...utils, editor, onChange };
  }

  it("moves through the block menu with the arrow keys and closes it with Escape", async () => {
    const { editor } = await mount("<p></p>");
    act(() => {
      editor.commands.insertContent("/");
    });
    const listbox = await screen.findByRole("listbox", { name: "Blocks" });
    const selected = () => listbox.querySelector('[aria-selected="true"]')?.textContent ?? "";
    expect(selected()).toMatch(/^Text/);
    expect(key(editor, "ArrowDown")).toBe(true);
    await waitFor(() => expect(selected()).toMatch(/^Heading/));
    expect(key(editor, "ArrowUp")).toBe(true);
    expect(key(editor, "ArrowUp")).toBe(true);
    await waitFor(() => expect(selected()).toMatch(/^Variable/));
    expect(key(editor, "Escape")).toBe(true);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // Escape leaves the "/" as typed, and the next Enter is an ordinary new line.
    expect(serializeEditorHtml(editor)).toBe("<p>/</p>");
    expect(key(editor, "Enter")).toBe(true);
    expect(serializeEditorHtml(editor)).toBe("<p>/</p><p></p>");
  });

  it("picks a variable after {{ with Enter", async () => {
    const { editor, onChange } = await mount("<p>Dear</p>");
    act(() => {
      editor.commands.insertContent(" {{comp");
    });
    const listbox = await screen.findByRole("listbox", { name: "Variables" });
    expect(listbox.querySelectorAll('[role="option"]').length).toBe(1);
    expect(key(editor, "Enter")).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("<p>Dear {{company_name}}</p>");
  });

  it("formats a selection from the bubble, and links it", async () => {
    const { editor, onChange } = await mount("<p>Pay today</p>");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 });
    });
    const toolbar = await screen.findByRole("toolbar", { name: "Format text" }, { timeout: 2000 });
    act(() => {
      (toolbar.querySelector('button[aria-label="Bold"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith("<p><strong>Pay</strong> today</p>");

    act(() => {
      (toolbar.querySelector('button[aria-label="Add link"]') as HTMLButtonElement).click();
    });
    const input = await screen.findByRole("textbox", { name: "Link address" });
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/web address/i);
    fireEvent.change(input, { target: { value: "example.com/pay" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith('<p><a href="https://example.com/pay"><strong>Pay</strong></a> today</p>');
  });

  it("sets where a button goes from its panel", async () => {
    const { editor, onChange } = await mount('<p>Intro</p><p><a data-email-button>Pay now</a></p>');
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    });
    const panel = await screen.findByRole("group", { name: "Button link" });
    expect(panel.textContent).toMatch(/needs a link/i);
    const chip = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === getVariable("payment_url")!.label)!;
    act(() => chip.click());
    expect(onChange).toHaveBeenLastCalledWith('<p>Intro</p><p><a data-email-button href="{{payment_url}}">Pay now</a></p>');
  });
});

/* -------------------------------------------------------------------------- */
/* VariableTextInput                                                           */
/* -------------------------------------------------------------------------- */

describe("VariableTextInput", () => {
  function openAndPick(label: string) {
    const trigger = screen.getByRole("button", { name: /insert variable/i });
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    });
    const item = screen.getAllByRole("menuitem").find((m) => m.textContent?.includes(label))!;
    act(() => item.click());
  }

  it("inserts {{key}} where the caret was", () => {
    const onChange = vi.fn();
    render(<VariableTextInput id="subject" ariaLabel="Subject" value="Hi , welcome" onChange={onChange} variables={EDITOR_VARS} />);
    const input = screen.getByRole("textbox", { name: "Subject" }) as HTMLInputElement;
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    openAndPick("Customer name");
    expect(onChange).toHaveBeenLastCalledWith("Hi {{customer_name}}, welcome");
  });

  it("shows a counter and refuses a variable that would pass maxLength", () => {
    const onChange = vi.fn();
    render(
      <VariableTextInput id="title" ariaLabel="Push title" value="1234567890" maxLength={12} onChange={onChange} variables={EDITOR_VARS} />,
    );
    expect(screen.getByText(/10 \/ 12/)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Push title" }) as HTMLInputElement;
    expect(input.maxLength).toBe(12);
    openAndPick("Customer name");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/no room for Customer name/i);
  });

  it("works as a multi-line field and hides the menu when read-only", () => {
    const { rerender } = render(
      <VariableTextInput id="body" ariaLabel="Push body" multiline value="Body" onChange={vi.fn()} variables={EDITOR_VARS} />,
    );
    expect(screen.getByRole("textbox", { name: "Push body" }).tagName).toBe("TEXTAREA");
    rerender(<VariableTextInput id="body" ariaLabel="Push body" multiline readOnly value="Body" onChange={vi.fn()} variables={EDITOR_VARS} />);
    expect(screen.queryByRole("button", { name: /insert variable/i })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Push body" }) as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
