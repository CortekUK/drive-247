/**
 * Notifications v2: the email preview is the email that is sent.
 *
 * The panel's caption says "How it looks in Gmail", so a difference between the
 * two paths is a lie on screen rather than a cosmetic bug. The two paths are:
 *
 *   preview   buildEmailPreviewHtml(body, examples, brand)
 *             — notification-item-panel.tsx, through the PORTAL copy of the
 *               layout (lib/notifications-v2/email-layout.ts).
 *   send      SendTestBox posts `bodyHtml: fillVariables(body, examples,
 *             { html: true })`, and notification-test-v2 renders it with
 *             renderNotificationEmailHtml through the EDGE copy of the layout
 *             (supabase/functions/_shared/notification-email-layout-v2.ts),
 *             passing the body RAW ("bodyHtml is passed as received").
 *
 * So this compares the real preview function against the edge module, with the
 * inputs each side actually gets. It caught a real defect: the preview used to
 * sanitise and inline the body itself before handing it to the layout, which
 * sanitises and inlines again — the second sanitise unwrapped the button table
 * the first pass had built and stripped its styles, so every preview showed a
 * plain underlined link where the delivered email has a solid button. 31 of the
 * 40 catalog defaults contain a button.
 */

import { describe, it, expect, vi } from "vitest";

// notification-item-panel loads the Tiptap editor through next/dynamic at
// module scope. Nothing is rendered here, so it is stubbed away.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { buildEmailPreviewHtml } from "@/components/settings-v2/notifications-v2/notification-item-panel";
import { NOTIFICATION_CATALOG } from "@/lib/notifications-v2/catalog";
import { exampleValues, fillVariables } from "@/lib/notifications-v2/variables";
import type { EmailBrand, EmailTemplate } from "@/lib/notifications-v2/types";
// The edge function's own copy of the layout: the module that builds what lands
// in the inbox. Importing it (not the portal's) is what makes this a parity test.
import { renderNotificationEmailHtml as renderOnTheServer } from "../../../../../supabase/functions/_shared/notification-email-layout-v2";

const BRAND: EmailBrand = {
  companyName: "Northwind Rentals",
  logoUrl: null,
  primaryColor: "#112233",
  accentColor: "#c5a572",
};

const EXAMPLES = exampleValues(BRAND, { currencyCode: "USD", slug: "northwind" });

/** Exactly what notification-test-v2 receives and renders for a given body. */
const whatIsSent = (body: string, brand: EmailBrand = BRAND) =>
  renderOnTheServer({ bodyHtml: fillVariables(body, EXAMPLES, { html: true }), brand });

const emailBody = (key: string): string => {
  const item = NOTIFICATION_CATALOG.find((i) => i.key === key);
  if (!item?.channels.email) throw new Error(`${key} has no email channel`);
  return (item.channels.email.defaultTemplate as EmailTemplate).body;
};

/** Every catalog email default whose body has a call-to-action button. */
const bodiesWithAButton = NOTIFICATION_CATALOG.filter((i) => i.channels.email)
  .map((i) => ({ key: i.key, body: (i.channels.email!.defaultTemplate as EmailTemplate).body }))
  .filter((x) => x.body.includes("data-email-button"));

describe("the email preview renders the document that is actually sent", () => {
  it("a body with a button previews byte-for-byte as the send path renders it", () => {
    const body = '<p>Hi {{customer_name}},</p><p><a data-email-button href="{{customer_portal_url}}">View your booking</a></p>';
    expect(buildEmailPreviewHtml(body, EXAMPLES, BRAND)).toBe(whatIsSent(body));
  });

  it("the button survives into the preview as a button, not as a plain link", () => {
    const body = '<p><a data-email-button href="{{customer_portal_url}}">View your booking</a></p>';
    const html = buildEmailPreviewHtml(body, EXAMPLES, BRAND);

    // The layout builds a bulletproof button: a table cell filled with the
    // brand colour, holding a padded block-level link.
    const button = html.slice(html.indexOf("View your booking") - 800, html.indexOf("View your booking"));
    expect(button).toContain("bgcolor=");
    expect(button).toContain("display:inline-block");
    expect(button).toMatch(/padding:\s*\d+px/);

    // The old double-sanitise left this instead: an underlined text link.
    expect(html).not.toContain('style="color:#6366f1;text-decoration:underline;">View your booking');
  });

  it("holds for EVERY catalog email default, with and without a button", () => {
    expect(bodiesWithAButton.length).toBeGreaterThan(20);
    for (const { key, body } of bodiesWithAButton) {
      expect(buildEmailPreviewHtml(body, EXAMPLES, BRAND), `preview ≠ send for ${key}`).toBe(whatIsSent(body));
    }
    for (const item of NOTIFICATION_CATALOG.filter((i) => i.channels.email)) {
      const body = emailBody(item.key);
      expect(buildEmailPreviewHtml(body, EXAMPLES, BRAND), `preview ≠ send for ${item.key}`).toBe(whatIsSent(body));
    }
  });

  it("holds for an operator's own wording: links, lists, formatting and a missing body", () => {
    const bodies = [
      "",
      "<p>Plain words only.</p>",
      '<p>See <a href="https://example.com/x">our terms</a>.</p>',
      "<ul><li>One</li><li>Two</li></ul><blockquote><p>Note</p></blockquote><hr>",
      "<p><strong>Bold</strong> and <em>italic</em> and <u>underlined</u>.</p>",
      '<p><a data-email-button href="{{portal_url}}">Open booking</a></p><p>Thanks.</p>',
      "<p>{{customer_name}} owes {{amount_due}} for {{vehicle_name}}.</p>",
    ];
    for (const body of bodies) {
      expect(buildEmailPreviewHtml(body, EXAMPLES, BRAND), `preview ≠ send for: ${body}`).toBe(whatIsSent(body));
    }
  });

  it("holds for a tenant with no branding of its own", () => {
    const bare: EmailBrand = { companyName: "Acme", logoUrl: null, primaryColor: null, accentColor: null };
    const body = '<p><a data-email-button href="{{customer_portal_url}}">View your booking</a></p>';
    expect(buildEmailPreviewHtml(body, exampleValues(bare, { currencyCode: "USD", slug: "acme" }), bare)).toBe(
      renderOnTheServer({ bodyHtml: fillVariables(body, exampleValues(bare, { currencyCode: "USD", slug: "acme" }), { html: true }), brand: bare }),
    );
  });

  it("still strips anything dangerous an operator could paste", () => {
    const nasty = '<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">tap</a>';
    const html = buildEmailPreviewHtml(nasty, EXAMPLES, BRAND);
    expect(html).toBe(whatIsSent(nasty));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });
});
