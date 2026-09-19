import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  EMAIL_LAYOUT_DEFAULTS,
  contrastRatio,
  emailBodyToPlainText,
  inlineEmailStyles,
  normaliseHexColor,
  readableTextColor,
  relativeLuminance,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from "@/lib/notifications-v2/email-layout";
import type { EmailBrand } from "@/lib/notifications-v2/types";

/**
 * The email layout is the one module both the preview (browser) and the test
 * send (Deno edge function) use, so "the preview is exactly what arrives"
 * (build-spec D15) depends on the two copies staying identical and on the
 * output staying Gmail-safe.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");
const PORTAL_COPY = "apps/portal/src/lib/notifications-v2/email-layout.ts";
const DENO_COPY = "supabase/functions/_shared/notification-email-layout-v2.ts";

const brand: EmailBrand = {
  companyName: "Coastline Car Rentals",
  logoUrl: null,
  primaryColor: "#0f172a",
  accentColor: "#2563eb",
  contactEmail: "hello@coastline.com",
  contactPhone: "+1 (415) 555-0100",
};

/** Parses with the browser's own parser, to check what a mail client would see. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("the two copies of the layout", () => {
  it("are byte-identical (edit one, copy it over the other)", () => {
    const portal = readFileSync(join(repo, PORTAL_COPY));
    const deno = readFileSync(join(repo, DENO_COPY));
    expect(deno.equals(portal)).toBe(true);
  });

  it("import nothing, so the same file runs in Deno", () => {
    const src = readFileSync(join(repo, PORTAL_COPY), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
  });

  it("accepts the shared EmailBrand type as its brand", () => {
    const asLayoutBrand: EmailLayoutBrand = brand;
    expect(asLayoutBrand.companyName).toBe("Coastline Car Rentals");
  });
});

describe("renderNotificationEmailHtml", () => {
  const html = renderNotificationEmailHtml({
    bodyHtml: '<h2>Booking confirmed</h2><p>Hi {{customer_name}}</p><p><a data-email-button href="https://x.com/pay">Pay now</a></p>',
    brand,
    preheader: "Your RAV4 is booked",
  });

  it("is a full document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("uses nothing Gmail drops or ignores", () => {
    for (const banned of ["linear-gradient", "box-shadow", "var(--", "<style", "display:flex", "display:grid", "<link"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("uses a 600px table layout with colours set as bgcolor as well as CSS", () => {
    const doc = parse(html);
    const inner = doc.querySelector('table[width="600"]');
    expect(inner).not.toBeNull();
    expect(inner?.getAttribute("style")).toContain("max-width:600px");
    const header = doc.querySelector('td[bgcolor="#0f172a"]');
    expect(header?.getAttribute("style")).toContain("background-color:#0f172a");
  });

  it("puts the company name in the header when there is no logo, readable on the primary colour", () => {
    const doc = parse(html);
    const header = doc.querySelector('td[bgcolor="#0f172a"]');
    expect(header?.textContent).toContain("Coastline Car Rentals");
    expect(header?.innerHTML).toContain("color:#ffffff");
  });

  it("shows the logo with its size fixed and the company name as alt text", () => {
    const withLogo = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { ...brand, logoUrl: "https://cdn.example.com/logo.png" },
    });
    const img = parse(withLogo).querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(img?.getAttribute("alt")).toBe("Coastline Car Rentals");
    expect(img?.getAttribute("height")).toBe("48");

    const sized = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { ...brand, logoUrl: "https://cdn.example.com/logo.png" },
      logoWidth: 400,
      logoHeight: 100,
    });
    const sizedImg = parse(sized).querySelector("img");
    expect(sizedImg?.getAttribute("width")).toBe("192");
    expect(sizedImg?.getAttribute("height")).toBe("48");
  });

  it("ignores a logo that is not an http(s) URL", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { ...brand, logoUrl: "javascript:alert(1)" },
    });
    expect(parse(out).querySelector("img")).toBeNull();
  });

  it("has a footer with the contact email and phone", () => {
    const doc = parse(html);
    expect(doc.querySelector('a[href="mailto:hello@coastline.com"]')?.textContent).toBe("hello@coastline.com");
    expect(doc.querySelector('a[href="tel:+14155550100"]')?.textContent).toBe("+1 (415) 555-0100");
  });

  it("leaves the contact line out when there are no contact details", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { companyName: "Coastline", contactEmail: null, contactPhone: null },
    });
    expect(out).not.toContain("Questions?");
    expect(out).not.toContain("mailto:");
  });

  it("carries a hidden preheader", () => {
    const doc = parse(html);
    const hidden = doc.querySelector("body > div");
    expect(hidden?.getAttribute("style")).toContain("display:none");
    expect(hidden?.textContent).toContain("Your RAV4 is booked");
    const none = renderNotificationEmailHtml({ bodyHtml: "<p>x</p>", brand });
    expect(none).not.toContain("display:none");
  });

  it("escapes every brand string", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: {
        companyName: 'Evil <script>alert(1)</script> & "Co"',
        contactEmail: "a@b.com",
        contactPhone: "<b>555</b>",
      },
      preheader: "<img src=x onerror=alert(1)>",
    });
    const doc = parse(out);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector("b")).toBeNull();
    expect(doc.title).toBe('Evil <script>alert(1)</script> & "Co"');
  });

  it("falls back to Drive247's colours when a brand colour is not #rgb / #rrggbb", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { companyName: "X", primaryColor: "red", accentColor: "hsl(0 0% 0%)" },
    });
    expect(out).toContain(`bgcolor="${EMAIL_LAYOUT_DEFAULTS.primaryColor}"`);
  });

  it("sanitises the body itself, so the preview and the send cannot differ", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: '<p onclick="x()">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      brand,
    });
    const doc = parse(out);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("[onclick]")).toBeNull();
    expect(out).not.toContain("onerror");
  });

  it("is the same with no brand at all", () => {
    const out = renderNotificationEmailHtml({ bodyHtml: "<p>x</p>", brand: null });
    expect(out).toContain("Drive247");
  });
});

describe("sanitizeEmailBodyHtml", () => {
  const clean = (html: string) => sanitizeEmailBodyHtml(html);

  it("keeps what the editor produces", () => {
    const html =
      '<h2>Title</h2><p>Hi <strong>{{customer_name}}</strong>, <em>thanks</em> <u>a lot</u> <s>old</s>.</p>' +
      '<ul><li><p>one</p></li></ul><ol><li>two</li></ol><blockquote><p>quote</p></blockquote><hr>' +
      '<p><a href="https://x.com/a?b=1&amp;c=2">link</a><br><span data-variable="customer_name">{{customer_name}}</span></p>';
    expect(clean(html)).toBe(html);
  });

  it.each([
    ["<img src=x onerror=alert(1)>hi", "hi"],
    ["<scr<script>ipt>alert(1)</script>", "ipt&gt;alert(1)"],
    ['<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
    ["<A HREF=JaVaScRiPt:alert(1)>x</A>", "<a>x</a>"],
    ['<a href="jav&#x09;ascript:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="javascript&colon;alert(1)">x</a>', "<a>x</a>"],
    ['<a href="  javascript:alert(1)">x</a>', "<a>x</a>"],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', "<a>x</a>"],
    ['<a href="//evil.com">x</a>', "<a>x</a>"],
    ['<a href="/relative">x</a>', "<a>x</a>"],
    ["<P CLASS=x ONCLICK=evil() style=color:red>Hello <B>World</B></P>", "<p>Hello <b>World</b></p>"],
    ["<!-- secret --><p>a</p><!-- unterminated", "<p>a</p>"],
    ["<style>p{color:red}</style><p>ok</p>", "<p>ok</p>"],
    ['<iframe src="https://evil.com"></iframe>after', "after"],
    ["<svg><style><img src=x onerror=alert(1)></style></svg>after", "after"],
    ["<<script>script>alert(1)<</script>/script>", "&lt;/script&gt;"],
    ["<plaintext><p>everything after is gone", ""],
    ["<p>ok</p><img src=x onerror=alert(1)", "<p>ok</p>"],
    ["a < b && c > d", "a &lt; b &amp;&amp; c &gt; d"],
    ['<p title="a>b" onmouseover="x()">x</p>', "<p>x</p>"],
    ["<div><table><tr><td>cell</td></tr></table></div>", "cell"],
  ])("cleans %j", (input, expected) => {
    expect(clean(input)).toBe(expected);
  });

  it("keeps http(s), mailto and {{variable}} links, unquoted or not", () => {
    expect(clean("<a href=https://ex.com/a?b=1&c=2 target=_blank rel=x>go</a>")).toBe(
      '<a href="https://ex.com/a?b=1&amp;c=2">go</a>',
    );
    expect(clean('<a href="mailto:hi@x.com">mail</a>')).toBe('<a href="mailto:hi@x.com">mail</a>');
    expect(clean('<a href="{{payment_url}}">pay</a>')).toBe('<a href="{{payment_url}}">pay</a>');
  });

  it("keeps data-email-button and data-variable, drops other data- attributes", () => {
    expect(clean('<a data-email-button href="{{payment_url}}" data-x="1">Pay</a>')).toBe(
      '<a href="{{payment_url}}" data-email-button="">Pay</a>',
    );
    expect(clean('<span data-variable="bad value!">x</span>')).toBe("<span>x</span>");
  });

  it("closes what was left open and nests like a browser would", () => {
    expect(clean("<p>unclosed <strong>bold")).toBe("<p>unclosed <strong>bold</strong></p>");
    expect(clean("<ul><li>one<li>two</ul>")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(clean("<p>a<p>b")).toBe("<p>a</p><p>b</p>");
    expect(clean("<p>a<h2>b</h2>")).toBe("<p>a</p><h2>b</h2>");
    expect(clean('<a href="https://a.com">a<a href="https://b.com">b</a>')).toBe(
      '<a href="https://a.com">a</a><a href="https://b.com">b</a>',
    );
    expect(clean("</p></strong>text")).toBe("text");
  });

  it("returns the same string when run twice", () => {
    const nasty = [
      '<p>Hi &amp; bye <a href="https://x.com/?a=1&b=2" data-email-button>Go</a></p><script>x</script>',
      "<ul><li>a<li>b",
      "a < b & c",
      '<span data-variable="k">{{k}}</span> &nbsp; &#39;',
    ];
    for (const n of nasty) {
      const once = clean(n);
      expect(clean(once)).toBe(once);
    }
  });

  it("never lets a browser build a script, handler or dangerous link from the output", () => {
    const inputs = [
      "<scr<script>ipt>alert(1)</scr</script>ipt>",
      '<a href="java\nscript:alert(1)">x</a>',
      '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>',
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      "<<img src=x onerror=alert(1)>>",
      "<img/src=x/onerror=alert(1)>",
      "<a/href=javascript:alert(1)>x</a>",
      "<p/onclick=alert(1)>x</p>",
      "<textarea><img src=x onerror=alert(1)></textarea>",
    ];
    for (const input of inputs) {
      const doc = parse("<body>" + clean(input) + "</body>");
      expect(doc.querySelector("script, img, iframe, svg, math, style, textarea")).toBeNull();
      for (const el of Array.from(doc.body.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name).not.toMatch(/^on/i);
          if (attr.name === "href") expect(attr.value).toMatch(/^(https?:\/\/|mailto:|\{\{)/i);
        }
      }
    }
  });

  it("handles empty and missing input", () => {
    expect(clean("")).toBe("");
    expect(sanitizeEmailBodyHtml(null)).toBe("");
    expect(sanitizeEmailBodyHtml(undefined)).toBe("");
  });
});

describe("inlineEmailStyles", () => {
  it("styles the editor's elements inline", () => {
    const out = inlineEmailStyles(
      "<h2>T</h2><h3>S</h3><p>P <a href=\"https://x.com\">l</a></p><ul><li>i</li></ul><ol><li>j</li></ol><blockquote><p>q</p></blockquote><hr>",
      brand,
    );
    const doc = parse(out);
    for (const sel of ["h2", "h3", "p", "ul", "ol", "li", "a", "blockquote", "hr"]) {
      expect(doc.querySelector(sel)?.getAttribute("style"), sel).toBeTruthy();
    }
    expect(doc.querySelector("a")?.getAttribute("style")).toContain("color:#2563eb");
  });

  it("does not restyle an element that already has a style", () => {
    const out = inlineEmailStyles('<p style="color:red">x</p>', brand);
    expect(out).toBe('<p style="color:red">x</p>');
  });

  it("turns a button on its own line into a table cell with bgcolor around a padded link", () => {
    const out = inlineEmailStyles('<p><a href="https://x.com/pay" data-email-button="">Pay now</a></p>', brand);
    const doc = parse(out);
    expect(doc.querySelector("p")).toBeNull();
    const td = doc.querySelector("table td");
    expect(td?.getAttribute("bgcolor")).toBe("#2563eb");
    expect(td?.getAttribute("style")).toContain("background-color:#2563eb");
    const a = td?.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.com/pay");
    expect(a?.textContent).toBe("Pay now");
    expect(a?.getAttribute("style")).toContain("padding:12px 24px");
    expect(a?.getAttribute("style")).toContain("color:#ffffff");
    expect(a?.hasAttribute("data-email-button")).toBe(false);
  });

  it("renders a top-level button as a block too", () => {
    const doc = parse(inlineEmailStyles('<a data-email-button href="https://x.com">Go</a>', brand));
    expect(doc.querySelector("table td a")?.textContent).toBe("Go");
  });

  it("keeps a button inside running text inline", () => {
    const doc = parse(inlineEmailStyles('<p>Text <a data-email-button href="https://y.com">inline</a> more</p>', brand));
    expect(doc.querySelector("table")).toBeNull();
    const a = doc.querySelector("p a");
    expect(a?.getAttribute("style")).toContain("background-color:#2563eb");
    expect(doc.querySelector("p")?.textContent).toBe("Text inline more");
  });

  it("picks dark text on a light button colour", () => {
    const doc = parse(
      inlineEmailStyles('<p><a data-email-button href="https://x.com">Go</a></p>', { companyName: "X", accentColor: "#c5a572" }),
    );
    expect(doc.querySelector("td")?.getAttribute("bgcolor")).toBe("#c5a572");
    expect(doc.querySelector("a")?.getAttribute("style")).toContain("color:#111111");
  });

  it("uses the primary colour for a button whose accent would vanish on the white card", () => {
    const doc = parse(
      inlineEmailStyles('<p><a data-email-button href="https://x.com">Go</a></p>', {
        companyName: "X",
        accentColor: "#fde68a",
        primaryColor: "#0f172a",
      }),
    );
    expect(doc.querySelector("td")?.getAttribute("bgcolor")).toBe("#0f172a");
    expect(doc.querySelector("a")?.getAttribute("style")).toContain("color:#ffffff");
  });

  it("is safe to run twice", () => {
    const once = inlineEmailStyles('<p><a data-email-button href="https://x.com">Go</a></p><p>x</p>', brand);
    expect(inlineEmailStyles(once, brand)).toBe(once);
  });
});

describe("colours", () => {
  it("accepts #rgb and #rrggbb only", () => {
    expect(normaliseHexColor("#ABC")).toBe("#aabbcc");
    expect(normaliseHexColor(" #1A2b3C ")).toBe("#1a2b3c");
    for (const bad of ["abc", "#abcd", "#12345g", "red", "", null, undefined, "rgb(0,0,0)"]) {
      expect(normaliseHexColor(bad as string)).toBeNull();
    }
  });

  it("computes WCAG luminance and contrast", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("chooses white text on dark colours and dark text on light ones", () => {
    expect(readableTextColor("#1a1a1a")).toBe("#ffffff");
    expect(readableTextColor("#0f172a")).toBe("#ffffff");
    expect(readableTextColor("#ffffff")).toBe("#111111");
    expect(readableTextColor("#c5a572")).toBe("#111111");
    expect(readableTextColor("#fde68a")).toBe("#111111");
  });

  it("uses dark header text on a light primary colour", () => {
    const out = renderNotificationEmailHtml({ bodyHtml: "<p>x</p>", brand: { companyName: "Pale", primaryColor: "#f8fafc" } });
    const header = parse(out).querySelector('td[bgcolor="#f8fafc"]');
    expect(header?.innerHTML).toContain("color:#111111");
  });

  it("does not use a pale accent for links on the white card", () => {
    const doc = parse(inlineEmailStyles('<p><a href="https://x.com">l</a></p>', { companyName: "X", accentColor: "#c5a572", primaryColor: "#1a1a1a" }));
    expect(doc.querySelector("a")?.getAttribute("style")).toContain("color:#1a1a1a");
  });
});

describe("emailBodyToPlainText", () => {
  it("gives readable text with links spelled out", () => {
    const text = emailBodyToPlainText(
      '<h2>Hi</h2><p>Hello <strong>you</strong> &amp; co</p><ul><li>a</li><li>b</li></ul><p><a href="https://x.com" data-email-button>Pay</a></p>',
    );
    expect(text).toBe("Hi\n\nHello you & co\n\n- a\n- b\n\nPay (https://x.com)");
  });
});
