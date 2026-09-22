import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  EMAIL_LAYOUT_DEFAULTS,
  emailBodyToPlainText,
  inlineEmailStyles,
  normaliseHexColor,
  readableTextColor,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from "@/lib/notifications-v2/email-layout";
import type { EmailBrand } from "@/lib/notifications-v2/types";

/**
 * There are now THREE copies of the email layout — the portal preview, this
 * admin preview, and the Deno edge function that actually sends — and
 * "the preview is exactly what arrives" (build-spec D15) only holds while all
 * three are the same file. The first test is the one that protects that; the
 * rest prove this copy really runs here, rather than restating the portal's
 * suite (apps/portal/src/__tests__/lib/notifications-v2-email-layout.test.ts),
 * which covers the sanitiser exhaustively.
 */

const repo = join(__dirname, "..", "..", "..", "..");
const ADMIN_COPY = "apps/admin/lib/notifications-v2/email-layout.ts";
const PORTAL_COPY = "apps/portal/src/lib/notifications-v2/email-layout.ts";
const DENO_COPY = "supabase/functions/_shared/notification-email-layout-v2.ts";

const brand: EmailBrand = {
  companyName: "Drive 247",
  logoUrl: null,
  primaryColor: "#1a1a1a",
  accentColor: "#C5A572",
  contactEmail: "support@drive-247.com",
  contactPhone: "+1 (415) 555-0100",
};

/** Parses with the browser's own parser, to check what a mail client would see. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("the three copies of the layout", () => {
  it("are byte-identical (edit one, copy it over the other two)", () => {
    const admin = readFileSync(join(repo, ADMIN_COPY));
    const portal = readFileSync(join(repo, PORTAL_COPY));
    const deno = readFileSync(join(repo, DENO_COPY));
    expect(admin.equals(portal)).toBe(true);
    expect(admin.equals(deno)).toBe(true);
  });

  it("import nothing, so the same file runs in Deno", () => {
    const src = readFileSync(join(repo, ADMIN_COPY), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
  });

  it("accepts this app's EmailBrand type as its brand", () => {
    const asLayoutBrand: EmailLayoutBrand = brand;
    expect(asLayoutBrand.companyName).toBe("Drive 247");
  });
});

describe("renderNotificationEmailHtml", () => {
  const html = renderNotificationEmailHtml({
    bodyHtml:
      '<h2>Your account is live</h2><p>Hi {{operator_name}}</p><p><a data-email-button href="https://portal.drive-247.com">Open the portal</a></p>',
    brand,
    preheader: "Drive247 has switched your account on",
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

  it("uses a 600px table layout with the brand colour set as bgcolor as well as CSS", () => {
    const doc = parse(html);
    const inner = doc.querySelector('table[width="600"]');
    expect(inner).not.toBeNull();
    expect(inner?.getAttribute("style")).toContain("max-width:600px");
    const header = doc.querySelector('td[bgcolor="#1a1a1a"]');
    expect(header?.textContent).toContain("Drive 247");
    expect(header?.innerHTML).toContain("color:#ffffff");
  });

  it("carries the hidden preheader and the contact line", () => {
    const doc = parse(html);
    const hidden = doc.querySelector("body > div");
    expect(hidden?.getAttribute("style")).toContain("display:none");
    expect(hidden?.textContent).toContain("Drive247 has switched your account on");
    expect(doc.querySelector('a[href="mailto:support@drive-247.com"]')?.textContent).toBe("support@drive-247.com");
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

  it("falls back to Drive247's colours when a brand colour is not #rgb / #rrggbb", () => {
    const out = renderNotificationEmailHtml({
      bodyHtml: "<p>x</p>",
      brand: { companyName: "X", primaryColor: "red", accentColor: "hsl(0 0% 0%)" },
    });
    expect(out).toContain(`bgcolor="${EMAIL_LAYOUT_DEFAULTS.primaryColor}"`);
  });
});

describe("sanitizeEmailBodyHtml", () => {
  it("keeps what the editor produces", () => {
    const html =
      "<h2>Title</h2><p>Hi <strong>{{operator_name}}</strong>.</p><ul><li><p>one</p></li></ul>" +
      '<p><a href="https://x.com/a?b=1&amp;c=2">link</a></p>';
    expect(sanitizeEmailBodyHtml(html)).toBe(html);
  });

  it("drops scripts, handlers and links that are not http(s), mailto or a variable", () => {
    expect(sanitizeEmailBodyHtml("<img src=x onerror=alert(1)>hi")).toBe("hi");
    expect(sanitizeEmailBodyHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailBodyHtml('<a href="/relative">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailBodyHtml('<a href="{{portal_url}}">go</a>')).toBe('<a href="{{portal_url}}">go</a>');
  });

  it("returns the same string when run twice", () => {
    const once = sanitizeEmailBodyHtml('<p>Hi &amp; bye <a href="https://x.com/?a=1&b=2" data-email-button>Go</a></p>');
    expect(sanitizeEmailBodyHtml(once)).toBe(once);
  });

  it("handles empty and missing input", () => {
    expect(sanitizeEmailBodyHtml("")).toBe("");
    expect(sanitizeEmailBodyHtml(null)).toBe("");
    expect(sanitizeEmailBodyHtml(undefined)).toBe("");
  });
});

describe("inlineEmailStyles", () => {
  it("turns a button on its own line into a table cell with bgcolor around a padded link", () => {
    const doc = parse(inlineEmailStyles('<p><a href="https://x.com/go" data-email-button="">Open</a></p>', brand));
    expect(doc.querySelector("p")).toBeNull();
    const td = doc.querySelector("table td");
    expect(td?.getAttribute("bgcolor")).toBe("#c5a572");
    const a = td?.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.com/go");
    expect(a?.getAttribute("style")).toContain("padding:12px 24px");
  });

  it("picks readable text for the platform's pale accent", () => {
    const doc = parse(inlineEmailStyles('<p><a data-email-button href="https://x.com">Go</a></p>', brand));
    expect(doc.querySelector("a")?.getAttribute("style")).toContain("color:#111111");
    expect(readableTextColor("#c5a572")).toBe("#111111");
    expect(readableTextColor("#1a1a1a")).toBe("#ffffff");
  });

  it("is safe to run twice", () => {
    const once = inlineEmailStyles('<p><a data-email-button href="https://x.com">Go</a></p><p>x</p>', brand);
    expect(inlineEmailStyles(once, brand)).toBe(once);
  });
});

describe("colours and plain text", () => {
  it("accepts #rgb and #rrggbb only", () => {
    expect(normaliseHexColor("#ABC")).toBe("#aabbcc");
    for (const bad of ["abc", "#abcd", "red", "", null, undefined]) {
      expect(normaliseHexColor(bad as string)).toBeNull();
    }
  });

  it("gives readable text with links spelled out", () => {
    expect(
      emailBodyToPlainText('<h2>Hi</h2><p>Hello <strong>you</strong> &amp; co</p><p><a href="https://x.com">Go</a></p>'),
    ).toBe("Hi\n\nHello you & co\n\nGo (https://x.com)");
  });
});
