/**
 * Where an agreement's document comes from, shared by both portals' drawers
 * (D4, D17). The operator's agreement-view-dialog-v2.tsx binds it to its own
 * calls and re-exports it; the customer portal binds it to theirs.
 *
 *   - a RENTAL row goes through the app's `POST /api/esign/view`: the signed
 *     PDF on file once it is signed, otherwise the current PDF from the signing
 *     service (base64). `rentalId` rides along with `agreementId` so the route
 *     can resolve the right signing mode for a row that predates
 *     `rental_agreements.boldsign_mode`.
 *   - an INDIVIDUAL row goes through the `agreements-v2` function's `document`
 *     action: the provider's PDF when there is one, else the exact HTML that
 *     was sent.
 *   - a rental row that never reached the signing service has no document at
 *     all, and says why, in words, instead of an empty frame.
 */

import type { AgreementListRow } from "./list";

export type AgreementDocument =
  /** `revoke`: the URL is a blob this module made, and must be freed. */
  | { kind: "pdf"; url: string; revoke: boolean; signed: boolean }
  | { kind: "html"; html: string }
  | { kind: "unavailable"; reason: string };

export type IndividualDocument = { kind: "pdf"; base64: string; signed: boolean } | { kind: "html"; html: string };

export interface AgreementDocumentSource {
  /** The `agreements-v2` `document` action, with the caller's session. */
  fetchIndividualDocument: (id: string) => Promise<IndividualDocument>;
  /** Why a rental row has nothing to show, in the reader's words. */
  unavailableReason: (rawStatus: string | null | undefined) => string;
  /** The app's view route. */
  viewUrl?: string;
}

export const pdfBlobUrl = (base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

/** The document for a row, as the drawer and Download both need it. */
export async function loadAgreementDocument(row: AgreementListRow, source: AgreementDocumentSource): Promise<AgreementDocument> {
  if (row.kind === "individual") {
    const doc = await source.fetchIndividualDocument(row.id);
    if (doc.kind === "pdf") return { kind: "pdf", url: pdfBlobUrl(doc.base64), revoke: true, signed: doc.signed };
    return { kind: "html", html: doc.html };
  }

  if (!row.documentId) return { kind: "unavailable", reason: source.unavailableReason(row.rawStatus) };

  const response = await fetch(source.viewUrl ?? "/api/esign/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rentalId: row.rentalId, agreementId: row.id }),
  });
  const data = await response.json().catch(() => ({}) as Record<string, any>);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "The signing service did not return the document.");
  }
  const signed = row.status === "signed" || data.status === "completed" || data.status === "signed";
  if (data.documentUrl) return { kind: "pdf", url: data.documentUrl, revoke: false, signed };
  if (data.documentBase64) return { kind: "pdf", url: pdfBlobUrl(data.documentBase64), revoke: true, signed };
  throw new Error("No document data came back.");
}

export const agreementFileName = (row: Pick<AgreementListRow, "title" | "kind" | "customerName">) =>
  `${[row.title || (row.kind === "rental" ? "Rental agreement" : "Agreement"), row.customerName]
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 120)}.pdf`;

/** Save a PDF under the agreement's name. A storage URL is fetched into a blob first: a cross-origin `download` is ignored. */
export async function saveAgreementPdf(url: string, fromBlob: boolean, row: AgreementListRow): Promise<void> {
  let href = url;
  let made = false;
  try {
    if (!fromBlob) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The PDF could not be fetched.");
      href = URL.createObjectURL(await response.blob());
      made = true;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = agreementFileName(row);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (made) URL.revokeObjectURL(href);
  }
}

/**
 * Download the SIGNED PDF. A provider that has not finished stamping the
 * signature yet is said so, rather than handing over an unsigned copy under a
 * signed name.
 */
export async function downloadSignedAgreement(row: AgreementListRow, source: AgreementDocumentSource): Promise<void> {
  const doc = await loadAgreementDocument(row, source);
  if (doc.kind !== "pdf") throw new Error("There is no signed PDF for this agreement yet.");
  try {
    if (!doc.signed) throw new Error("The signed copy is not ready yet. Try again in a minute.");
    await saveAgreementPdf(doc.url, doc.revoke, row);
  } finally {
    if (doc.revoke) URL.revokeObjectURL(doc.url);
  }
}
