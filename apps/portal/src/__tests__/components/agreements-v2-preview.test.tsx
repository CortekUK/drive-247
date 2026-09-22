/**
 * Agreements v2: the preview (build-spec D6, D8, D9, D11).
 *
 * The preview has to show the page the PDF renderer draws. These tests pin the
 * parts a customer's signed document depends on: every signer tag becomes a
 * labelled box at its position, the operator's signature image is drawn and
 * nothing else image-like is, nothing executable survives the sanitiser, the
 * unresolved names render.ts marks stay visible, and the fixed text the PDF
 * appends (the disclaimer, the fallback signature block, the banner) appears
 * the way the PDF appends it.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AgreementPreviewV2,
  PLATFORM_DISCLAIMER_PARAGRAPHS_V2,
  PLATFORM_DISCLAIMER_TITLE_V2,
  isBlankAgreementHtml,
  prepareAgreementPreviewV2,
  sanitizeAgreementHtmlV2,
} from "@/components/agreements-v2/agreement-preview-v2";
import { renderAgreementHtml } from "@/lib/agreements-v2/render";
import { SIGNATURE_FIELDS } from "@/lib/agreements-v2/types";
import { compile, liftDeclaration, readPortalSource } from "../helpers/edge-source";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function body(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="agreement-body"]');
  if (!el) throw new Error("no agreement body rendered");
  return el as HTMLElement;
}

describe("signer fields", () => {
  it("draws each of the three tags as its labelled box, in document order, at its position", () => {
    const { container } = render(
      <AgreementPreviewV2 html="<p>Initial here {{@init1}} please.</p><p>Customer signature: {{@sig1}}</p><p>Date: {{@date1}}</p>" />,
    );
    const boxes = Array.from(body(container).querySelectorAll(".agr-field"));
    expect(boxes.map((b) => b.getAttribute("data-field"))).toEqual(["initials", "signature", "date"]);
    expect(boxes.map((b) => b.querySelector(".agr-field-label")?.textContent)).toEqual(["Initials", "Signature", "Date signed"]);
    for (const box of boxes) expect(box.querySelector(".agr-field-hint")?.textContent).toBe("Signer completes this");
    // At its position: inside its own paragraph, between the words around it.
    const first = boxes[0].parentElement!;
    expect(first.tagName).toBe("P");
    expect(first.textContent).toBe("Initial here InitialsSigner completes this please.");
    // The raw tag text is gone from the drawn page (it is a box now)…
    expect(body(container).textContent).not.toContain("{{@");
  });

  it("labels come from SIGNATURE_FIELDS, so a renamed field renames its box", () => {
    const { container } = render(<AgreementPreviewV2 html={SIGNATURE_FIELDS.map((f) => `<p>${f.tag}</p>`).join("")} />);
    const labels = Array.from(body(container).querySelectorAll(".agr-field-label")).map((l) => l.textContent);
    expect(labels).toEqual(SIGNATURE_FIELDS.map((f) => f.label));
  });

  it("draws a box inside a table cell too (the PDF draws the tag where the cell is)", () => {
    const html = sanitizeAgreementHtmlV2("<table><tbody><tr><td><p>Signed</p></td><td><p>{{@sig1}}</p></td></tr></tbody></table>");
    const cell = new DOMParser().parseFromString(html, "text/html").querySelectorAll("td")[1];
    expect(cell.querySelector('.agr-field[data-field="signature"]')).not.toBeNull();
  });

  it("marks a tag that is not one of the three instead of pretending it is a field", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>Witness {{@sig2}}</p>" />);
    const box = body(container).querySelector(".agr-field")!;
    expect(box.getAttribute("data-field")).toBe("unknown");
    expect(box.textContent).toBe("{{@sig2}}");
  });

  it("can leave the tags as text (fieldBoxes: false)", () => {
    expect(sanitizeAgreementHtmlV2("<p>{{@sig1}}</p>", { fieldBoxes: false })).toBe("<p>{{@sig1}}</p>");
  });
});

describe("the operator's signature", () => {
  it("draws the image with exactly the signature attribute, a data URL and alt text, nothing else", () => {
    const { container } = render(
      <AgreementPreviewV2
        html={`<p>For the company</p><img data-operator-signature="true" src="${PNG}" alt="whatever" class="x" style="width:900px" onload="alert(1)" width="900">`}
      />,
    );
    const imgs = body(container).querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    const img = imgs[0];
    expect(img.getAttribute("src")).toBe(PNG);
    expect(img.getAttribute("data-operator-signature")).toBe("true");
    expect(img.getAttribute("alt")).toBe("Signature");
    expect(img.getAttributeNames().sort()).toEqual(["alt", "data-operator-signature", "src"]);
  });

  it("accepts a JPEG data URL", () => {
    expect(sanitizeAgreementHtmlV2(`<img data-operator-signature="true" src="${JPEG}">`)).toContain(`src="${JPEG}"`);
  });

  it("drops every other image: no attribute, a remote URL, an SVG or GIF data URL, a wrong attribute value", () => {
    const out = sanitizeAgreementHtmlV2(
      [
        `<img src="${PNG}">`,
        `<img data-operator-signature="true" src="https://evil.example/logo.png">`,
        `<img data-operator-signature="true" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">`,
        `<img data-operator-signature="true" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`,
        `<img data-operator-signature="false" src="${PNG}">`,
        `<img data-operator-signature="true" src="${PNG}&quot; onerror=&quot;alert(1)">`,
        `<p>kept</p>`,
      ].join(""),
    );
    expect(out).toBe("<p>kept</p>");
  });
});

describe("the sanitiser", () => {
  it("removes scripts, styles, frames, forms and their contents", () => {
    const out = sanitizeAgreementHtmlV2(
      '<p>a</p><script>alert(1)</script><style>p{display:none}</style><iframe src="https://x"></iframe><form><input value="x"><button>go</button></form><svg><script>alert(2)</script></svg><noscript><p>n</p></noscript><p>b</p>',
    );
    expect(out).toBe("<p>a</p><p>b</p>");
  });

  it("removes every event handler, style, class, id and href", () => {
    const out = sanitizeAgreementHtmlV2(
      '<p onclick="alert(1)" class="c" id="i" style="color:red;text-align:center">x <a href="javascript:alert(1)" onmouseover="alert(2)">link</a> <strong onfocus="alert(3)">b</strong></p><img src=x onerror="alert(4)">',
    );
    expect(out).toBe('<p data-align="center">x link <strong>b</strong></p>');
    expect(out).not.toMatch(/on\w+=|javascript:|href|style=|class=|id=/i);
  });

  it("does not execute anything while rendering", () => {
    const spy = vi.fn();
    (window as unknown as { __agrPwned: () => void }).__agrPwned = spy;
    render(<AgreementPreviewV2 html={'<img src="x" onerror="window.__agrPwned()"><p onmouseover="window.__agrPwned()">t</p><script>window.__agrPwned()</script>'} />);
    expect(spy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="agreement-body"] script')).toBeNull();
  });

  it("keeps text that LOOKS like markup as text", () => {
    const out = sanitizeAgreementHtmlV2("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(out).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("keeps what the PDF draws: headings, alignment, lists, tables with a header row, rules, B/I/U", () => {
    const out = sanitizeAgreementHtmlV2(
      '<h1 style="text-align: center">T</h1><h2>S</h2><h3 style="text-align:right">s</h3><p><strong>b</strong><em>i</em><u>u</u></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><hr><table style="min-width:50px"><colgroup><col></colgroup><tbody><tr><th colspan="1">H</th><th>K</th></tr><tr><td colspan="1" rowspan="1"><p>v</p></td><td><p>w</p></td></tr></tbody></table>',
    );
    expect(out).toBe(
      '<h1 data-align="center">T</h1><h2>S</h2><h3 data-align="right">s</h3><p><strong>b</strong><em>i</em><u>u</u></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><hr><table><tbody><tr data-header="true"><th>H</th><th>K</th></tr><tr><td><p>v</p></td><td><p>w</p></td></tr></tbody></table>',
    );
  });

  it("drops paragraphs with no words, as the PDF does, but keeps one holding only a field", () => {
    expect(sanitizeAgreementHtmlV2("<p></p><p> &nbsp; </p><p>x</p><p>{{@sig1}}</p>")).toMatch(
      /^<p>x<\/p><p><span class="agr-field" data-field="signature"/,
    );
  });
});

describe("unresolved names", () => {
  it("keeps render.ts's preview marker highlighted, and says how many will be blank", () => {
    const html = renderAgreementHtml("<p>Dear {{customer_name}}, ref {{promo_code}} {{no_such_thing}}.</p>", { customer_name: "Ada" }, { mode: "preview" });
    const { container } = render(<AgreementPreviewV2 html={html} />);
    const marked = Array.from(body(container).querySelectorAll("span[data-unresolved]"));
    expect(marked.map((m) => m.getAttribute("data-unresolved"))).toEqual(["promo_code", "no_such_thing"]);
    expect(marked[0].textContent).toBe("{{promo_code}}");
    expect(marked[0].getAttribute("title")).toMatch(/left blank/);
    expect(body(container).textContent).toContain("Dear Ada,");
    expect(screen.getByText(/2 highlighted names have nothing to fill them in/)).toBeInTheDocument();
  });

  it("drops a forged marker name that is not an identifier", () => {
    expect(sanitizeAgreementHtmlV2('<p><span data-unresolved="x&quot; onclick=&quot;y">a</span></p>')).toBe("<p><span>a</span></p>");
  });
});

describe("what the PDF adds around the agreement", () => {
  it("draws the banner in uppercase at the top of the page", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>x</p>" banner="  Vehicle hire — Ada  " />);
    const banner = container.querySelector('[data-slot="agreement-banner"]')!;
    expect(banner.textContent).toBe("VEHICLE HIRE — ADA");
    expect(banner.parentElement!.firstElementChild).toBe(banner);
  });

  it("draws no banner when none is given", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>x</p>" />);
    expect(container.querySelector('[data-slot="agreement-banner"]')).toBeNull();
  });

  it("appends the platform disclaimer word for word as route.ts's PLATFORM_DISCLAIMER_BLOCKS", () => {
    type Block = { type: string; runs?: { text: string; bold: boolean }[] };
    const blocks = compile<Block[]>(
      [liftDeclaration(readPortalSource("app/api/esign/route.ts"), "PLATFORM_DISCLAIMER_BLOCKS")],
      "PLATFORM_DISCLAIMER_BLOCKS",
    );
    expect(blocks[0]).toEqual({ type: "hr" });
    expect(blocks[1].runs).toEqual([expect.objectContaining({ text: PLATFORM_DISCLAIMER_TITLE_V2, bold: true })]);
    expect(blocks.slice(2).map((b) => b.runs!.map((r) => r.text).join(""))).toEqual([...PLATFORM_DISCLAIMER_PARAGRAPHS_V2]);

    const { container } = render(<AgreementPreviewV2 html="<p>x</p>" />);
    const disclaimer = container.querySelector('[data-slot="agreement-disclaimer"]')!;
    expect(disclaimer.querySelector("hr")).not.toBeNull();
    expect(disclaimer.querySelector("p strong")!.textContent).toBe("Platform Disclaimer");
    expect(Array.from(disclaimer.querySelectorAll("p")).slice(1).map((p) => p.textContent)).toEqual([...PLATFORM_DISCLAIMER_PARAGRAPHS_V2]);
    // After the agreement, as the PDF appends it.
    expect(body(container).compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("can leave the disclaimer out for a renderer that does not append it", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>x</p>" disclaimer={false} />);
    expect(container.querySelector('[data-slot="agreement-disclaimer"]')).toBeNull();
  });

  it("shows the signature block the send path appends when there is no {{@sig1}}, marked as added", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>Terms only.</p>" />);
    const auto = container.querySelector('[data-slot="agreement-auto-signature"]')!;
    expect(auto).not.toBeNull();
    expect(auto.textContent).toMatch(/Added when it is sent/);
    expect(auto.querySelector('.agr-field[data-field="signature"]')).not.toBeNull();
    expect(auto.querySelector("h3")!.textContent).toBe("Signature");
  });

  it("adds nothing when the agreement already has its Signature field", () => {
    const { container } = render(<AgreementPreviewV2 html="<p>Sign: {{@sig1}}</p>" />);
    expect(container.querySelector('[data-slot="agreement-auto-signature"]')).toBeNull();
  });

  it("shows an empty page, not a fallback signature and disclaimer, for an empty agreement", () => {
    const { container } = render(<AgreementPreviewV2 html="<p></p>" banner="Title" />);
    expect(screen.getByText(/Nothing to preview yet/)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="agreement-auto-signature"]')).toBeNull();
    expect(container.querySelector('[data-slot="agreement-disclaimer"]')).toBeNull();
    expect(container.querySelector('[data-slot="agreement-banner"]')!.textContent).toBe("TITLE");
  });

  it("is not empty with only a signature image or only a field", () => {
    expect(isBlankAgreementHtml(`<img data-operator-signature="true" src="${PNG}">`)).toBe(false);
    expect(isBlankAgreementHtml("<p>{{@sig1}}</p>")).toBe(false);
    expect(isBlankAgreementHtml("<p>&nbsp;</p><p></p>")).toBe(true);
    expect(prepareAgreementPreviewV2("<p>{{@sig1}}</p>").autoSignature).toBe("");
  });
});
