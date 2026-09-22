/**
 * Agreements v2: View and Download (components/agreements-v2/agreement-view-dialog-v2.tsx).
 *
 * D17: View shows the agreement that was sent, never "No document". A rental
 * row reads the existing POST /api/esign/view; an individual row reads
 * `fetchAgreementDocumentV2` (a PDF, or the exact HTML that was sent); a rental
 * row that never reached the signing service says why. Download hands over the
 * SIGNED PDF only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const api = vi.hoisted(() => ({ fetchAgreementDocumentV2: vi.fn() }));
vi.mock("@/lib/agreements-v2/api-client", () => ({
  fetchAgreementDocumentV2: api.fetchAgreementDocumentV2,
  resendAgreementV2: vi.fn(),
  syncAgreementsV2: vi.fn(),
  sendAgreementV2: vi.fn(),
}));
// The preview is the editor lane's and has its own tests; here it records the HTML it is given.
vi.mock("@/components/agreements-v2/agreement-preview-v2", () => ({
  AgreementPreviewV2: ({ html }: { html: string }) => <div data-testid="preview">{html}</div>,
}));

import {
  AgreementViewDialogV2,
  downloadSignedAgreementV2,
  loadAgreementDocumentV2,
  unavailableReasonV2,
} from "@/components/agreements-v2/agreement-view-dialog-v2";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

const row = (over: Partial<AgreementRowV2> & { id: string }): AgreementRowV2 => ({
  kind: "rental",
  customerName: "Ann Lee",
  customerEmail: "ann@lee.io",
  sentAt: new Date(2026, 8, 21, 15, 4).toISOString(),
  status: "pending",
  rawStatus: "sent",
  rentalId: "rental-1",
  rentalRef: "R-2040",
  documentId: "doc-1",
  templateId: null,
  title: "Rental agreement",
  message: null,
  cc: [],
  signedAt: null,
  signedDocumentId: null,
  resentFromId: null,
  hasContentSnapshot: false,
  ...over,
});

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => "blob:made");
const revokeObjectURL = vi.fn();
const PDF_B64 = btoa("%PDF-1.4 test");

beforeEach(() => {
  fetchMock.mockReset();
  api.fetchAgreementDocumentV2.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("loading the document", () => {
  it("a rental row asks /api/esign/view for its agreement, with the rental for the signing mode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, documentUrl: "https://files.example/signed.pdf", status: "completed" }));
    const doc = await loadAgreementDocumentV2(row({ id: "a1", status: "signed" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/esign/view");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ rentalId: "rental-1", agreementId: "a1" });
    expect(doc).toEqual({ kind: "pdf", url: "https://files.example/signed.pdf", revoke: false, signed: true });
  });

  it("a base64 PDF becomes a blob URL the dialog must free", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, documentBase64: PDF_B64, status: "sent" }));
    const doc = await loadAgreementDocumentV2(row({ id: "a2" }));
    expect(doc).toEqual({ kind: "pdf", url: "blob:made", revoke: true, signed: false });
  });

  it("a rental row with no document never calls the route, and says why", async () => {
    const doc = await loadAgreementDocumentV2(row({ id: "a3", status: "failed", rawStatus: "credit_failed", documentId: null }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(doc).toEqual({ kind: "unavailable", reason: unavailableReasonV2("credit_failed") });
    expect(unavailableReasonV2("credit_failed")).toMatch(/no e-sign credits/);
    expect(unavailableReasonV2("send_failed")).toMatch(/turned it down/);
  });

  it("an individual row reads its own document: a PDF, or the HTML that was sent", async () => {
    api.fetchAgreementDocumentV2.mockResolvedValueOnce({ kind: "pdf", base64: PDF_B64, signed: true });
    expect(await loadAgreementDocumentV2(row({ id: "i1", kind: "individual", rentalId: null }))).toEqual({
      kind: "pdf",
      url: "blob:made",
      revoke: true,
      signed: true,
    });
    api.fetchAgreementDocumentV2.mockResolvedValueOnce({ kind: "html", html: "<p>Hello {{@sig1}}</p>" });
    expect(await loadAgreementDocumentV2(row({ id: "i2", kind: "individual", rentalId: null }))).toEqual({
      kind: "html",
      html: "<p>Hello {{@sig1}}</p>",
    });
    expect(api.fetchAgreementDocumentV2.mock.calls.map((c) => c[0])).toEqual(["i1", "i2"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a route failure is an error with the route's reason", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "Failed to get document from BoldSign" }, false));
    await expect(loadAgreementDocumentV2(row({ id: "a4" }))).rejects.toThrow("Failed to get document from BoldSign");
  });
});

describe("the dialog", () => {
  it("frames the PDF, and shows who it went to, when, its status, the CC and the message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, documentBase64: PDF_B64, status: "sent" }));
    render(
      <AgreementViewDialogV2
        row={row({ id: "a5", cc: ["ops@acme.io", "boss@acme.io"], message: "Please sign by Friday." })}
        open
        onOpenChange={() => {}}
      />,
    );
    const frame = await screen.findByTitle("Rental agreement");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toMatch(/^blob:made#/);
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("Pending signature")).toBeInTheDocument();
    expect(screen.getByText("ops@acme.io, boss@acme.io")).toBeInTheDocument();
    expect(screen.getByText("Please sign by Friday.")).toBeInTheDocument();
    expect(screen.queryByText(/No document/)).toBeNull();
    // Not signed: no Download.
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("draws the sent HTML through the agreement preview for an individual row", async () => {
    api.fetchAgreementDocumentV2.mockResolvedValueOnce({ kind: "html", html: "<p>Terms</p>" });
    render(
      <AgreementViewDialogV2 row={row({ id: "i3", kind: "individual", rentalId: null, title: "NDA" })} open onOpenChange={() => {}} />,
    );
    expect((await screen.findByTestId("preview")).textContent).toBe("<p>Terms</p>");
  });

  it("explains a rental agreement that never went out, and offers Resend when allowed", async () => {
    const onResend = vi.fn();
    const failed = row({ id: "a6", status: "failed", rawStatus: "send_failed", documentId: null });
    render(<AgreementViewDialogV2 row={failed} open onOpenChange={() => {}} onResend={onResend} />);
    expect(await screen.findByText("This agreement never went out")).toBeInTheDocument();
    expect(screen.getByText(unavailableReasonV2("send_failed"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(onResend).toHaveBeenCalledWith(failed);
  });

  it("a failed load says so and tries again on request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "BoldSign not configured" }, false))
      .mockResolvedValueOnce(jsonResponse({ ok: true, documentUrl: "https://files.example/a.pdf" }));
    render(<AgreementViewDialogV2 row={row({ id: "a7" })} open onOpenChange={() => {}} />);
    expect(await screen.findByText("BoldSign not configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTitle("Rental agreement")).toHaveAttribute("src", "https://files.example/a.pdf#toolbar=1&navpanes=0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offers Download on a signed row and hands the row over", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, documentUrl: "https://files.example/s.pdf", status: "completed" }));
    const onDownload = vi.fn();
    const signed = row({ id: "a8", status: "signed" });
    render(<AgreementViewDialogV2 row={signed} open onOpenChange={() => {}} onDownload={onDownload} />);
    await screen.findByTitle("Rental agreement");
    fireEvent.click(screen.getByRole("button", { name: "Download signed PDF" }));
    expect(onDownload).toHaveBeenCalledWith(signed);
  });

  it("frees the blob it made when it closes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, documentBase64: PDF_B64 }));
    const { rerender } = render(<AgreementViewDialogV2 row={row({ id: "a9" })} open onOpenChange={() => {}} />);
    await screen.findByTitle("Rental agreement");
    rerender(<AgreementViewDialogV2 row={row({ id: "a9" })} open={false} onOpenChange={() => {}} />);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:made"));
  });
});

describe("downloading the signed PDF", () => {
  it("refuses an individual PDF the provider has not finished signing, and frees the blob", async () => {
    api.fetchAgreementDocumentV2.mockResolvedValueOnce({ kind: "pdf", base64: PDF_B64, signed: false });
    await expect(downloadSignedAgreementV2(row({ id: "i4", kind: "individual", rentalId: null, status: "signed" }))).rejects.toThrow(
      /not ready yet/,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:made");
  });

  it("saves a stored signed PDF under the agreement's own name", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, documentUrl: "https://files.example/s.pdf", status: "completed" }))
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["%PDF"]) } as Response);
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    await act(async () => {
      await downloadSignedAgreementV2(row({ id: "a10", status: "signed", title: "Rental agreement" }));
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://files.example/s.pdf");
    expect(clicks).toEqual(["Rental agreement - Ann Lee.pdf"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:made");
    click.mockRestore();
  });
});
