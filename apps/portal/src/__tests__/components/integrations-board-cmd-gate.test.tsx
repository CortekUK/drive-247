/**
 * The CheckMyDriver card on the Integrations board — THREE cases, not two.
 *
 * Two cases cannot tell "the gate refused" apart from "the tenant lookup came
 * back empty": both render nothing and both look like a pass. So every
 * assertion below runs three ways —
 *
 *   1. `northwind`          → the card is HIDDEN
 *   2. a real live tenant   → the card is PRESENT. This is the outage case,
 *                             and it matters more than the first: the delete
 *                             this gate replaces took CMD from 56 tenants to
 *                             hide it from one.
 *   3. an unresolved slug   → FAILS OPEN, everything visible
 *
 * This RENDERS the component rather than grepping it. Status codes and SSR
 * output prove nothing here: `notFound()` under the portal's `(dashboard)`
 * route group returns HTTP 200 because the layout streams before the page
 * resolves, and TenantContext resolves the slug client-side from
 * `window.location.hostname` in a `useEffect`, so server-rendered HTML is
 * byte-identical for every tenant. Only executing the client component with a
 * known slug can distinguish the three cases.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `connect-stripe-required-dialog.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { IntegrationsBoard } from "@/app/(dashboard)/integrations/integrations-board";

let tenantSlug: string | null = "northwind";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-1" }, tenantSlug }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderFor(slug: string | null): string {
  tenantSlug = slug;
  act(() => {
    root.render(<IntegrationsBoard />);
  });
  return container.textContent ?? "";
}

describe("IntegrationsBoard — CMD gate, three cases", () => {
  it("CASE 1 — hides CheckMyDriver from the northwind canary", () => {
    const text = renderFor("northwind");
    expect(text).not.toContain("CheckMyDriver");
    // The board itself must still render — proving the card was filtered, not
    // that the whole component failed to mount and trivially "hid" everything.
    expect(text).toContain("Integrations");
    expect(text).toContain("Stripe Connect");
  });

  it("CASE 2 — keeps CheckMyDriver for real non-canary tenants (the outage case)", () => {
    for (const slug of ["revtek", "jangram", "test", "goniko", "globalmotiontransport"]) {
      const text = renderFor(slug);
      expect(text, `CMD must stay visible for ${slug}`).toContain("CheckMyDriver");
      expect(text).toContain("Stripe Connect");
    }
  });

  it("CASE 3 — fails OPEN on an unresolved or unknown slug", () => {
    // null is what TenantContext reports for a tick on first paint and forever
    // on an unrecognised host. Neither may blank the card.
    for (const slug of [null, "", "not-a-real-tenant"]) {
      const text = renderFor(slug);
      expect(text, `CMD must stay visible for slug ${JSON.stringify(slug)}`).toContain(
        "CheckMyDriver",
      );
    }
  });

  it("never keys on a tenant ID", () => {
    // northwind is 6e5c544f-… in production but 8e6bc88f-… on staging. An
    // id-keyed gate resolves to the ungated path with no error and no failed
    // build, so both ids must behave like any other unknown string.
    for (const id of [
      "6e5c544f-b374-451f-a662-360a634bff15",
      "8e6bc88f-86d6-4468-8610-73f7c8a88f6e",
    ]) {
      expect(renderFor(id)).toContain("CheckMyDriver");
    }
  });

  it("hides only CMD — every other integration survives the canary gate", () => {
    // A gate that filtered too broadly would also read as "CMD hidden".
    //
    // Asserted on each card's DESCRIPTION rather than its name: Bonzah renders
    // its name as an <img alt> (localLogo) and contributes no text node, so a
    // name-based sweep would fail on a card that is in fact present. The
    // descriptions are unique per card and always text.
    const text = renderFor("northwind");
    for (const [name, description] of [
      ["Stripe Connect", "Accept booking payments, deposits & payouts."],
      ["Bonzah", "Per-rental insurance coverage at checkout."],
      ["BoldSign", "E-signature for rental agreements."],
      ["Twilio Messages", "SMS notifications, reminders & 2-way chat."],
      ["Twilio Calling", "Call forwarding, voicemail & recordings."],
      ["Tesla", "Supercharging & vehicle data via the Fleet API."],
      ["Branded Domain", "Use your own domain for booking & portal."],
      ["Xero", "Sync invoices & payments to Xero."],
      ["Zoho", "Sync books & CRM with Zoho."],
    ]) {
      expect(text, `${name} must survive the CMD gate`).toContain(description);
    }
    // …and exactly one card is gone: CMD's own description.
    expect(text).not.toContain("Verify driver's licenses & identity.");
  });
});
