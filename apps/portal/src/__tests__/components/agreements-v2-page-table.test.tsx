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

/**
 * The row's actions are icon buttons IN the row now, not items behind a ⋯
 * trigger (2026-09-24: "can we bring these icons out of the dropdown since we
 * have space"), so there is no menu to open. Each button is found by the
 * sentence it carries in `aria-label`, which is also its tooltip — see
 * `RowIconAction` in agreements-table-v2.tsx.
 */
const ACTION_LABEL = {
  View: (who: string) => `View the agreement for ${who}`,
  Download: (who: string) => `Download the signed PDF for ${who}`,
  Resend: (who: string) => `Resend the agreement to ${who}`,
} as const;

const rowAction = (name: string, action: keyof typeof ACTION_LABEL) =>
  screen.getByRole("button", { name: ACTION_LABEL[action](name) });

/** Every action offered on that row, in the order they are rendered. */
const rowActions = (name: string) => {
  const row = screen.getByText(name).closest("tr")!;
  return within(row)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
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

  it("the signed row shows View and Download, and nothing else", () => {
    const onDownload = vi.fn();
    renderTable([SIGNED], { onDownload });
    expect(rowActions("Ann Lee")).toEqual([
      ACTION_LABEL.View("Ann Lee"),
      ACTION_LABEL.Download("Ann Lee"),
    ]);
    fireEvent.click(rowAction("Ann Lee", "Download"));
    expect(onDownload).toHaveBeenCalledWith(SIGNED);
  });

  it("the failed row shows View and Resend, and hands the row over", () => {
    const onResend = vi.fn();
    const onView = vi.fn();
    renderTable([FAILED], { onResend, onView });
    expect(rowActions("Cat Diaz")).toEqual([
      ACTION_LABEL.View("Cat Diaz"),
      ACTION_LABEL.Resend("Cat Diaz"),
    ]);
    fireEvent.click(rowAction("Cat Diaz", "Resend"));
    expect(onResend).toHaveBeenCalledWith(FAILED);
    // No menu to reopen: the second action is already on screen.
    fireEvent.click(rowAction("Cat Diaz", "View"));
    expect(onView).toHaveBeenCalledWith(FAILED);
  });

  it("a view-only viewer gets View alone", () => {
    renderTable([PENDING], { canResend: false });
    expect(rowActions("Bob Stone")).toEqual([ACTION_LABEL.View("Bob Stone")]);
  });

  it("never prints 'No document'", () => {
    renderTable([SIGNED, PENDING, FAILED]);
    expect(screen.queryByText(/No document/)).toBeNull();
  });

  it("the action that is running spins, and the others do not", () => {
    renderTable([PENDING], { resendingId: "p" });
    // The spinner is on Resend itself now, not on a shared ⋯ trigger, so two
    // rows resending at once are told apart.
    const resend = rowAction("Bob Stone", "Resend");
    expect(resend).toHaveAttribute("aria-busy", "true");
    expect(resend).toBeDisabled();
    expect(rowAction("Bob Stone", "View")).not.toHaveAttribute("aria-busy");
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

  it("every row menu that remains is the ui-v2 menu, end-aligned and sized to its labels", () => {
    const src = readPortalSource("components/agreements-v2/agreements-table-v2.tsx");
    expect(src).toContain('} from "@/components/ui-v2/dropdown-menu";');
    const contents = src.match(/<DropdownMenuContent[^>]*>/g) ?? [];
    /*
     * The COUNT is no longer the assertion. It was `>= 3` as a proxy for "all
     * of them", and the sent-agreements table lost its row menu on 2026-09-24
     * — its actions are icon buttons in the row now, which the behaviour tests
     * above cover. What has to hold is the shape of the menus that are left, so
     * a new one cannot arrive centred or sized to a fixed width.
     */
    expect(contents.length).toBeGreaterThan(0);
    for (const tag of contents) expect(tag).toBe('<DropdownMenuContent align="end" className="w-auto">');
  });

  it("the chart never draws with a literal colour", () => {
    expect(readPortalSource("components/agreements-v2/agreements-overview-v2.tsx")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
