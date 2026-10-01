/**
 * Notifications v2: editing a message straight in its preview (Oct 1 2026).
 *
 * Trax handles the variables; an operator who still wants to change a word
 * clicks the text in the preview and types. The preview shows EXAMPLE values
 * ("Jordan Ellis", "R-3F9A2C"), so what comes back is turned into a template
 * again: every example of a variable this notification uses becomes its
 * `{{key}}` once more. Longest examples first, so a value that contains a
 * shorter one ("Toyota RAV4" vs "RAV4") is matched whole.
 *
 * The email body comes back as the preview drew it: styled inline, buttons
 * wrapped in tables. `emailBodyFromPreview` strips that back to the plain body
 * the editor stores (the layout adds the styling again on every render).
 *
 * Browser only (DOMParser). v2 only.
 */

import { escapeEmailHtml } from "@/lib/notifications-v2/email-layout";

/** `text` with every example value of `keys` put back as `{{key}}`. */
export function unfillVariables(
  text: string,
  keys: readonly string[],
  examples: Record<string, string>,
  opts: { html?: boolean } = {},
): string {
  const pairs = keys
    .map((key) => ({ key, value: String(examples[key] ?? "").trim() }))
    .filter((p) => p.value.length >= 2)
    .sort((a, b) => b.value.length - a.value.length);
  let out = text;
  for (const { key, value } of pairs) {
    const token = `{{${key}}}`;
    out = out.split(value).join(token);
    if (opts.html) {
      const escaped = escapeEmailHtml(value);
      if (escaped !== value) out = out.split(escaped).join(token);
    }
  }
  return out;
}

/** Plain text from an edited preview element: no stray newlines or nbsp. */
export function plainFromEditable(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").replace(/ /g, " ").replace(/\s*\n\s*/g, " ").trim();
}

const LAYOUT_ATTRS = ["style", "target", "bgcolor", "align", "border", "cellpadding", "cellspacing", "role", "width", "height", "contenteditable", "spellcheck"];

/**
 * The body HTML the editor stores, from the preview's edited body cell:
 * buttons back to `<a data-email-button href>`, every layout attribute gone,
 * and the example values back to `{{key}}`.
 */
export function emailBodyFromPreview(
  cellHtml: string,
  keys: readonly string[],
  examples: Record<string, string>,
): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${cellHtml}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return "";

  // A block button is drawn as a one-cell table around the link: put the link back.
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[data-email-button]"))) {
    const table = link.closest("table");
    const button = doc.createElement("a");
    button.setAttribute("data-email-button", "");
    const href = link.getAttribute("href");
    if (href) button.setAttribute("href", href);
    button.textContent = (link.textContent ?? "").trim();
    if (table && root.contains(table)) {
      const p = doc.createElement("p");
      p.appendChild(button);
      table.replaceWith(p);
    } else {
      link.replaceWith(button);
    }
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of LAYOUT_ATTRS) el.removeAttribute(attr);
  }
  // Editing can leave empty wrappers behind (a <div> from Enter, an empty <p>).
  for (const div of Array.from(root.querySelectorAll("div"))) {
    const p = doc.createElement("p");
    p.innerHTML = div.innerHTML;
    div.replaceWith(p);
  }

  return unfillVariables(root.innerHTML.trim(), keys, examples, { html: true });
}
