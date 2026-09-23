/**
 * Agreements v2: the list table (`AgreementsListTableV2` in
 * components/agreements-v2/agreements-table-v2.tsx).
 *
 * D16: Customer (a rental row names its rental underneath, an individual one
 * says "Individual"), Email, Sent (date and time with AM/PM) and Status, with no
 * separate Signed column. D17: View always, Download once signed, Resend while
 * waiting or after a failure, for someone allowed to send.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  AgreementsListTableV2,
  agreementRowActionsV2,
  formatAgreementSentAtV2,
} from "@/components/agreements-v2/agreements-table-v2";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";
import { codeOnly, readPortalSource } from "../helpers/edge-source";

// Radix's popper (the row menu) constructs a ResizeObserver; the shared setup's
// vi.fn() arrow mock cannot be constructed, so this file brings a class.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const row = (over: Partial<AgreementRowV2> & { id: string }): AgreementRowV2 => ({
  kind: "rental",
  customerName: "Someone",
  customerEmail: "someone@example.com",
  sentAt: new Date(2026, 8, 21, 15, 4).toISOString(),
  status: "pending",
  rawStatus: "sent",
  rentalId: "r-1",
  rentalRef: "R-1001",
  documentId: "doc-1",
  templateId: null,
  title: null,
  message: null,
  cc: [],
  signedAt: null,
  signedDocumentId: null,
  resentFromId: null,
  hasContentSnapshot: false,
  ...over,
});

const SIGNED = row({ id: "s", customerName: "Ann Lee", customerEmail: "ann@lee.io", status: "signed", rentalRef: "R-2040" });
const PENDING = row({ id: "p", customerName: "Bob Stone", customerEmail: "bob@stone.dev", kind: "individual", rentalId: null, rentalRef: null, title: "NDA" });
const FAILED = row({ id: "f", customerName: "Cat Diaz", customerEmail: "cat@diaz.co", status: "failed", rawStatus: "credit_failed", documentId: null });

const noop = () => {};
const renderTable = (rows: AgreementRowV2[], over: Partial<React.ComponentProps<typeof AgreementsListTableV2>> = {}) =>
  render(
    <AgreementsListTableV2
      rows={rows}
      resetKey="k"
      canResend
      viewingId={null}
      downloadingId={null}
      resendingId={null}
      onView={noop}
      onDownload={noop}
      onResend={noop}
      {...over}
    />,
  );

/** Radix opens its menu from the keyboard as well as the pointer; jsdom has no PointerEvent. */
const openMenu = (name: string) => {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  act(() => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  return screen.getByRole("menu");
};

describe("columns", () => {
  it("are Customer, Email, Sent and Status, with no Signed or Agreement column", () => {
    renderTable([SIGNED]);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(heads).toEqual(["Customer", "Email", "Sent", "Status", "Actions"]);
    expect(heads).not.toContain("Signed");
    expect(heads).not.toContain("Agreement");
  });

  it("left-aligns Customer, header and cell together, like every other v2 column", () => {
    // Centred in its wide column, every name sat far in from the card's left
    // edge (reported on the live page). Since Sep 23 2026 the whole table reads
    // left from the kit, so Customer carries no override of its own — and Email
    // beside it reads the same way.
    renderTable([SIGNED]);
    const [customerHead, emailHead] = screen.getAllByRole("columnheader");
    expect(customerHead.className.split(/\s+/)).toContain("text-left");
    expect(customerHead.className.split(/\s+/)).not.toContain("text-center");
    expect(emailHead.className.split(/\s+/)).toContain("text-left");
    const [, row] = screen.getAllByRole("row");
    const [customerCell] = within(row).getAllByRole("cell");
    expect(customerCell.className.split(/\s+/)).toContain("text-left");
    expect(customerCell.className.split(/\s+/)).not.toContain("text-center");
  });

  it("a rental row shows its rental reference under the name; an individual row says Individual", () => {
    renderTable([SIGNED, PENDING]);
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first).getByText("Ann Lee")).toBeInTheDocument();
    expect(within(first).getByText("R-2040")).toBeInTheDocument();
    expect(within(first).getByText("ann@lee.io")).toBeInTheDocument();
    expect(within(second).getByText("Bob Stone")).toBeInTheDocument();
    expect(within(second).getByText("Individual")).toBeInTheDocument();
  });

  it("status is coloured text: Signed success, Pending signature warning, Failed danger", () => {
    renderTable([SIGNED, PENDING, FAILED]);
    expect(screen.getByText("Signed").className).toContain("text-emerald-600");
    expect(screen.getByText("Pending signature").className).toContain("text-amber-600");
    expect(screen.getByText("Failed").className).toContain("text-red-500");
  });
});

describe("the Sent time", () => {
  const now = new Date(2026, 8, 21, 18, 0);

  it("is date and time on a 12-hour clock with AM/PM, the year only when it is not this one", () => {
    // \s: newer ICU puts a narrow no-break space before the AM/PM marker.
    expect(formatAgreementSentAtV2(new Date(2026, 8, 21, 15, 4).toISOString(), now)).toMatch(/^Sep 21, 3:04\sPM$/);
    expect(formatAgreementSentAtV2(new Date(2026, 0, 2, 9, 5).toISOString(), now)).toMatch(/^Jan 2, 9:05\sAM$/);
    expect(formatAgreementSentAtV2(new Date(2025, 11, 31, 0, 30).toISOString(), now)).toMatch(/^Dec 31, 2025, 12:30\sAM$/);
  });

  it("is a dash when there is none, or it cannot be read", () => {
    expect(formatAgreementSentAtV2(null, now)).toBe("—");
    expect(formatAgreementSentAtV2("not a date", now)).toBe("—");
  });

  it("is printed in the row", () => {
    renderTable([SIGNED]);
    expect(screen.getByText(/Sep 21, (2026, )?3:04\sPM/)).toBeInTheDocument();
  });
});

describe("actions per status", () => {
  it("View always; Download only once signed; Resend only while pending or failed", () => {
    expect(agreementRowActionsV2(SIGNED, true)).toEqual({ view: true, download: true, resend: false });
    expect(agreementRowActionsV2(PENDING, true)).toEqual({ view: true, download: false, resend: true });
    expect(agreementRowActionsV2(FAILED, true)).toEqual({ view: true, download: false, resend: true });
  });

  it("no Resend for a viewer who may not send, or for a row with no name or email to send to", () => {
    expect(agreementRowActionsV2(PENDING, false).resend).toBe(false);
    expect(agreementRowActionsV2({ ...PENDING, customerEmail: "" }, true).resend).toBe(false);
    expect(agreementRowActionsV2({ ...FAILED, customerName: "" }, true).resend).toBe(false);
  });

  it("the signed row's menu offers View and Download, and nothing else", () => {
    const onDownload = vi.fn();
    renderTable([SIGNED], { onDownload });
    const menu = openMenu("Ann Lee");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["View", "Download signed PDF"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Download signed PDF" }));
    expect(onDownload).toHaveBeenCalledWith(SIGNED);
  });

  it("the failed row's menu offers View and Resend, and hands the row over", () => {
    const onResend = vi.fn();
    const onView = vi.fn();
    renderTable([FAILED], { onResend, onView });
    let menu = openMenu("Cat Diaz");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["View", "Resend"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Resend" }));
    expect(onResend).toHaveBeenCalledWith(FAILED);
    menu = openMenu("Cat Diaz");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "View" }));
    expect(onView).toHaveBeenCalledWith(FAILED);
  });

  it("a view-only viewer's menu is View alone", () => {
    renderTable([PENDING], { canResend: false });
    const menu = openMenu("Bob Stone");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["View"]);
  });

  it("never prints 'No document'", () => {
    renderTable([SIGNED, PENDING, FAILED]);
    expect(screen.queryByText(/No document/)).toBeNull();
  });

  it("the trigger spins while that row's action is in flight", () => {
    renderTable([PENDING], { resendingId: "p" });
    expect(screen.getByRole("button", { name: "Actions for Bob Stone" })).toHaveAttribute("aria-busy", "true");
  });
});

describe("v2 style tripwires on the Agreements v2 files", () => {
  const FILES = [
    "components/agreements-v2/agreements-table-v2.tsx",
    "components/agreements-v2/agreements-page-v2.tsx",
    "components/agreements-v2/agreements-overview-v2.tsx",
    "components/agreements-v2/agreements-filter-panel-v2.tsx",
    "components/agreements-v2/agreement-view-dialog-v2.tsx",
  ];

  it.each(FILES)("%s: no grey hover, no primary wash in dark, no slash on border-border", (file) => {
    // Code only: a comment may name a class in order to warn against it.
    const src = codeOnly(readPortalSource(file));
    expect(src).not.toMatch(/hover:bg-muted\b/);
    expect(src).not.toMatch(/dark:bg-primary\/(10|15)\b/);
    expect(src).not.toMatch(/border-border\//);
  });

  it("every row menu is the ui-v2 menu, end-aligned and sized to its labels", () => {
    const src = readPortalSource("components/agreements-v2/agreements-table-v2.tsx");
    expect(src).toContain('} from "@/components/ui-v2/dropdown-menu";');
    const contents = src.match(/<DropdownMenuContent[^>]*>/g) ?? [];
    expect(contents.length).toBeGreaterThanOrEqual(3);
    for (const tag of contents) expect(tag).toBe('<DropdownMenuContent align="end" className="w-auto">');
  });

  it("the chart never draws with a literal colour", () => {
    expect(readPortalSource("components/agreements-v2/agreements-overview-v2.tsx")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
