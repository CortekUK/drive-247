/**
 * Agreements v2 — the shared shapes every lane codes against.
 *
 * See docs/agreements-v2/build-spec.md ("Shared contracts"). Two kinds of
 * agreement reach one list:
 *
 *  - `rental`: an existing `rental_agreements` row, sent from the rental flow
 *    through the existing `POST /api/esign`. Nothing about how those are sent
 *    changes.
 *  - `individual`: a row in the NEW `individual_agreements_v2` table
 *    (ops/agreements_v2.sql), sent from the Agreements tab. These never touch
 *    `rental_agreements`, the shared BoldSign webhook or the retry cron.
 *
 * Templates are `agreement_templates` rows with no schema change. "Default"
 * is `is_active`: one per (tenant, category), which is exactly the row
 * `/api/esign` picks when it sends from a rental.
 */

export type AgreementKindV2 = 'rental' | 'individual';

/** What the list shows. `toStatusV2` (./status.ts) maps the raw column to it. */
export type AgreementStatusV2 = 'signed' | 'pending' | 'failed';

export type AgreementTemplateCategoryV2 = 'standard' | 'payg' | 'extension' | 'installment';

export interface AgreementTemplateV2 {
  id: string;
  name: string;
  content: string;
  category: AgreementTemplateCategoryV2;
  /** `agreement_templates.is_active === true`: the template a rental sends. */
  isDefault: boolean;
  updatedAt: string | null;
}

export interface AgreementRowV2 {
  id: string;
  kind: AgreementKindV2;
  /** The rental's customer, or the individual agreement's recipient. */
  customerName: string;
  customerEmail: string;
  sentAt: string | null;
  status: AgreementStatusV2;
  /** The stored `document_status`, untouched, for details and debugging. */
  rawStatus: string;
  rentalId: string | null;
  /** `rentals.rental_number`, else the first 8 characters of the rental id. */
  rentalRef: string | null;
  /** The signing provider's document id. */
  documentId: string | null;
  templateId: string | null;
  title: string | null;
  message: string | null;
  cc: string[];
  signedAt: string | null;
  /** `customer_documents` id of the stored signed PDF (rental rows only). */
  signedDocumentId: string | null;
  resentFromId: string | null;
  /**
   * Individual rows only: the row carries a snapshot of exactly what was sent
   * (`content_html`), so "View" can always show the agreement, even when the
   * send failed and no provider document exists. Always false for rental rows.
   */
  hasContentSnapshot: boolean;
}

export type SignatureFieldKeyV2 = 'signature' | 'initials' | 'date';
export type SignatureFieldTagV2 = '{{@sig1}}' | '{{@init1}}' | '{{@date1}}';

/**
 * The three signer fields, and the ONLY three.
 *
 * These are BoldSign text tags for signer 1: `/api/esign` always defines
 * `sig1`, and defines `init1` and `date1` when the document carries them. They
 * are consumed by the signing provider AFTER the PDF is handed over, so they
 * must reach it byte for byte. Nothing in v2 may strip, rewrite or
 * regex-match them away; the unresolved-placeholder stripper cannot match
 * them because they begin with `@`.
 */
export const SIGNATURE_FIELDS: ReadonlyArray<{
  key: SignatureFieldKeyV2;
  tag: SignatureFieldTagV2;
  label: string;
  hint: string;
}> = [
  {
    key: 'signature',
    tag: '{{@sig1}}',
    label: 'Signature',
    hint: 'Where the customer signs.',
  },
  {
    key: 'initials',
    tag: '{{@init1}}',
    label: 'Initials',
    hint: 'Where the customer initials.',
  },
  {
    key: 'date',
    tag: '{{@date1}}',
    label: 'Date signed',
    hint: 'Filled in with the date the customer signs.',
  },
];

/**
 * Marks the one `<img>` the PDF renderers draw: the operator's own signature,
 * inserted as `<img data-operator-signature="true" src="data:image/...">`.
 * Every other `<img>` in a template is still ignored by the renderers.
 */
export const OPERATOR_SIGNATURE_ATTR = 'data-operator-signature';
