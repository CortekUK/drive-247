# Agreements v2: build spec

Branch `haseeb/agreements-v2` (from `haseeb/extras-promos-and-nav-v2` @ 5a664cbb). v2 only: a new
`useV2('agreements')` area (northwind, plus any `portal_experience='v2'` tenant, as with every area).
Other tenants see nothing change.

Repo rules that apply (from `V2_PLAN.md`):
- Never change an existing edge function or `_shared` helper. Add new code beside it.
- Database changes are additive only, and go in `ops/agreements_v2.sql` marked NOT APPLIED.
- v1 files stay byte-identical, except for one-line hand-offs and the two additive `/api/esign`
  changes in D14.
- Every query filters by `tenant_id` (RLS is off on core tables).
- Nothing is applied to the database, deployed, or sent to BoldSign live while building. Northwind is
  forced to LIVE BoldSign, so a real send is a legally binding document and spends live credits.

## Decisions (each is an interpretation to confirm with the lead)

| # | Decision | Why (transcript) |
|---|---|---|
| D1 | Agreements lives on the existing **Agreements tab** (`/agreements`), with templates on the same page. The v2 Settings index loses its "Agreement templates" entry. The v2 branch of `/settings/agreement-templates` redirects to `/agreements?view=templates`. The v1 pages stay byte-identical. | 00:21, 00:49 |
| D2 | In the v2 rail, Agreements shows **by default** (the row loses `optional: true`, but can still be customised). v2 global search can find `/agreements`. | 00:49 "the tab we had, let's use it" |
| D3 | **Signing authority stays BoldSign.** "Not just BoldSign" means the product talks about *agreements*, not a vendor. The UI never says BoldSign. | 02:23, 22:35–22:50 |
| D4 | **Two kinds.** *Rental* agreements = the existing `rental_agreements` rows, sent from the rental flow through the existing `POST /api/esign` (all of today's machinery: webhook, timeline, drift, resend). *Individual* agreements = a NEW table `individual_agreements_v2`, sent from the Agreements tab through a NEW authenticated route. Individual rows never touch `rental_agreements`, the shared webhook or the retry cron. | 02:52, 05:06, 22:12 |
| D5 | **Templates** reuse `agreement_templates` with no schema change. Arbitrary named templates are allowed (unique per tenant+name+category). **Default = `is_active`** (one per tenant+category, partial unique index). That is exactly what `/api/esign` sends from a rental, so "the default template is what goes out from a rental" is true by construction. "Create your template" makes a `standard` row. "Set as default" = deactivate the others in that category, then activate this one (the existing two-step). No delete (not asked). | 04:00, 06:46, 19:43–20:17 |
| D6 | **Editor** = a full-screen overlay (100vw). Left 50%: editing, with its own Tiptap setup (the shared `TipTapEditor` also drives v1 email templates and must not change). Right 50%: a proper page preview. | 03:50, 04:22 ("100vw… 50vw editing, rest preview") |
| D7 | **Side panel** slides out OVER the preview (absolutely positioned inside the preview column, no overlay, and the preview never reflows). It has three tabs: Variables, Signature fields, Your signature. | 09:56–10:08 |
| D8 | **Signature fields**: Signature `{{@sig1}}`, Initials `{{@init1}}`, Date signed `{{@date1}}`. These are the only three, because the send path defines exactly these text tags for signer 1. Drag a chip onto the document (it drops at the drop point) or click to insert at the cursor. Each can be placed once, and a placed chip reads "Placed". The tags are NEVER stripped or rewritten. The preview draws them as labelled boxes. | 10:18, 10:55, 12:18 |
| D9 | **Operator's signature**: draw or upload a PNG/JPEG, then **Save and use**. That saves it as the operator's own signature (new table `agreement_operator_signatures_v2`, one row per staff member) AND inserts it into the document as `<img data-operator-signature="true" src="data:image/...">`. The PDF renderers draw exactly that element and still ignore every other `<img>`. Until the SQL is applied, saving degrades gracefully: the insert works, and nothing is kept for next time. | 10:35–12:08 |
| D10 | **Variables**: every variable in the picker has a tooltip with its description and "Example: …" from `TEMPLATE_VARIABLES` (label/description/sample already exist for all 112). | 12:29–12:58 |
| D11 | **Branding** = the tenant's existing BoldSign brand (`tenants.boldsign_{test,live}_brand_id`, already created per tenant). It brands the signing email and page. The preview shows the tenant's REAL company details instead of the "Acme Car Rentals" sample. No logo is drawn into the PDF, because the renderer cannot, and the preview must not promise what the PDF lacks. | 08:24 ("each tenant's branding is already configured") |
| D12 | **Send dialog** (individual only): recipient name + email (one recipient), CC (several emails), document title (defaults to the template's name, editable), optional message. Then pick a template (the default first, searchable) or **Create new**. Then a preview with **Edit** and **Send**. Edit and Create new open the editor on a COPY. What is sent is that copy, and the template is never touched or created. There is no email/SMS channel choice. | 07:27–08:12, 15:22–16:55 |
| D13 | **Message** ("what if it isn't going by email"): individual agreements are delivered by BoldSign's own email (`DisableEmails: false`), which carries the title, the message and the CC natively, branded by the tenant brand. The message also shows on BoldSign's signing page, and it is stored on the row and shown in the agreement's details, so it is never lost when the agreement is signed some other way. | 08:12 |
| D14 | **Rental flow** (v2 rental detail, Agreement stage): a "Selected template" row. It pre-selects the template the rental would send today (the active one for the rental's category, else standard). **Change** opens the template picker. **Preview** opens a dialog with REAL rental data. **Edit** opens the same editor, and **Save to template** updates that template for this tenant (Ghulam's reading, 21:44). Sending passes the chosen template to `/api/esign` through ONE new OPTIONAL field, `templateId`. Without it, behaviour is byte-for-byte today's. `/api/esign` also learns to draw the `data-operator-signature` image, and no v1 template can contain one. | 20:37–21:54 |
| D15 | **Overview**: the hero row. The graph (~75%) is agreements sent per week over the last 8 weeks, as stacked bars for Signed / Pending signature / Failed, with headline counts Total · Signed · Failed and short "Recently signed" and "Failed" lists. The card (~25%) is **Create your template**. | 13:12–15:18 |
| D16 | **List columns**: Customer (recipient name for individual rows; a rental rows shows its reference underneath), Email, Sent (date + time with AM/PM), Status. **Status**: Signed = signed/completed. Failed = send_failed/credit_failed/declined/expired/failed. Voided rows are superseded by a resend and are hidden. Everything else is Pending signature. There is no separate Signed column. | 17:08–17:49 |
| D17 | **Row actions**: View (the agreement that was sent, never "No document"), Download (the signed PDF, once signed), Resend. A rental resend re-POSTs `/api/esign`, which voids the old one: today's rule, unchanged. An individual resend creates a NEW row and leaves the old one alone ("another row is made"). | 17:51–18:26 |
| D18 | **Filters** (the Rentals pattern: OverviewFlip + FilterShell): customer (search), sent date range, status, kind (Rental / Individual). Top-bar search matches customer, email and title. | 18:26–19:27 |
| D19 | **Permissions**: whoever can send a rental agreement today (see stage-agreement.tsx's gate) can send and edit here. Managers stay view-only on this tab (the `agreements` tab key is `viewOnly`). Template editing keeps its existing grant, `canEditSettings('templates')`. permissions.ts does not change. | V2_PLAN |
| D20 | **Security**: every new route authenticates the caller (a Supabase access token as Bearer, then `app_users` by auth id), takes the tenant from that record, never from the body, and rejects non-v2 tenants. The row is inserted BEFORE credits are deducted, so a paid document is never orphaned. Credits are refunded when BoldSign rejects. Emails are validated. Title and message are length-capped and escaped wherever HTML is built. | map risks |

## Shared contracts (every lane codes against these exact names)

`apps/portal/src/lib/agreements-v2/types.ts`
```ts
export type AgreementKindV2 = 'rental' | 'individual';
export type AgreementStatusV2 = 'signed' | 'pending' | 'failed';
export interface AgreementTemplateV2 { id: string; name: string; content: string; category: 'standard'|'payg'|'extension'|'installment'; isDefault: boolean; updatedAt: string | null; }
export interface AgreementRowV2 {
  id: string; kind: AgreementKindV2; customerName: string; customerEmail: string;
  sentAt: string | null; status: AgreementStatusV2; rawStatus: string;
  rentalId: string | null; rentalRef: string | null; documentId: string | null;
  templateId: string | null; title: string | null; message: string | null; cc: string[];
  signedAt: string | null; signedDocumentId: string | null; resentFromId: string | null;
}
export const SIGNATURE_FIELDS: ReadonlyArray<{ key: 'signature'|'initials'|'date'; tag: '{{@sig1}}'|'{{@init1}}'|'{{@date1}}'; label: string; hint: string }>;
export const OPERATOR_SIGNATURE_ATTR = 'data-operator-signature';
```

`apps/portal/src/lib/agreements-v2/status.ts`: `toStatusV2(raw: string | null): AgreementStatusV2 | 'hidden'` (D16).

`apps/portal/src/lib/agreements-v2/render.ts`, the ONE substitution pipeline the v2 preview and the v2 individual send share:
- `renderAgreementHtml(content: string, data: Record<string,string>, opts: { mode: 'preview'|'send' }): string`. It substitutes with `replaceVariables` (2–3 braces), decodes entities (`&amp;` last), and in `'send'` mode strips unresolved names with `lib/unresolved-placeholders`. In `'preview'` mode, unresolved names are marked visibly. It never touches `{{@…}}` tags.
- `buildIndividualData(input: { companyName: string; companyEmail?: string; companyPhone?: string; companyAddress?: string; recipientName: string; recipientEmail: string; date?: Date }): Record<string,string>`
- `ensureSignatureTag(html: string): string` appends `{{@sig1}}` when absent (same rule as `/api/esign`).

`apps/portal/src/hooks/use-agreement-templates-v2.ts`
- `useAgreementTemplatesV2(): { templates: AgreementTemplateV2[]; isLoading; error; refetch }` (all categories; the default first, then by name)
- `useAgreementTemplateMutationsV2(): { create({name, content}): Promise<AgreementTemplateV2>; update(id, {name?, content?}): Promise<void>; setDefault(id): Promise<void> }`
- `defaultTemplateFor(templates, category): AgreementTemplateV2 | null` (the category's active row, else standard's).

`apps/portal/src/hooks/use-operator-signature-v2.ts`: `{ signature: string | null; isLoading; save(dataUrl): Promise<{ persisted: boolean }> }`

`apps/portal/src/hooks/use-agreements-list-v2.ts`: `{ rows: AgreementRowV2[]; isLoading; error; refetch }`. It reads `rental_agreements` (joined to rental + customer) plus `individual_agreements_v2`. If that table is missing it contributes nothing, without an error.

Editor, `components/agreements-v2/editor/agreement-editor-v2.tsx`:
```tsx
<AgreementEditorV2 open onClose={() => …}
  mode="template" | "one-off" | "rental-template"
  initialName={string} initialContent={string}
  previewData={Record<string,string>}   // values the preview substitutes
  onSave={(content: string, name: string) => Promise<void> | void}
  saveLabel?: string                     // "Save template" | "Use for this agreement" | "Save to template"
  nameEditable?: boolean />
```
Preview, `components/agreements-v2/agreement-preview-v2.tsx`: `<AgreementPreviewV2 html={string} className? />`. It draws the page, with the signature tags as boxes and the operator signature image.

Template picker, `components/agreements-v2/template-picker-v2.tsx`: `<TemplatePickerV2 templates selectedId onSelect(id) onCreateNew? />`, a searchable list with the default first and a Default badge.

## New database objects (ops/agreements_v2.sql, NOT APPLIED)
- `individual_agreements_v2`: id, tenant_id NOT NULL, customer_id NULL, recipient_name, recipient_email, cc_emails text[], title, message, template_id NULL, content_html (a snapshot of exactly what was sent), document_id, boldsign_mode, document_status default 'pending', error, sent_at, completed_at, resent_from_id, created_by, created_at, updated_at. RLS ON: tenant staff select/insert/update through `get_user_tenant_id()`, super admin, service_role; anon revoked.
- `agreement_operator_signatures_v2`: app_user_id PK, tenant_id, image_data (a PNG/JPEG data URL, ≤ 500 kB), updated_at. RLS ON: the owner reads and writes their own row only.

## More cross-lane contracts

`components/agreements-v2/create-template-card-v2.tsx`: `<CreateTemplateCardV2 onCreate={() => void} disabled? />`. It is the "Create your template" card, used in the hero card slot and at the head of the templates section.

`apps/portal/src/lib/agreements-v2/api-client.ts`. The browser attaches `Authorization: Bearer <supabase access token>`.
- `sendAgreementV2(body: { templateId: string | null; contentHtml: string; title: string; message?: string; recipientName: string; recipientEmail: string; cc: string[] }): Promise<{ id: string; status: string }>`
- `resendAgreementV2(id: string): Promise<{ id: string; status: string }>` (a new row copying the old one's content, recipient, cc, title and message; the old row is left alone)
- `syncAgreementsV2(): Promise<{ updated: number }>` (refreshes the status of non-terminal individual rows from the signing provider)
- `fetchAgreementDocumentV2(id: string): Promise<{ kind: 'pdf'; base64: string; signed: boolean } | { kind: 'html'; html: string }>` (individual rows; `html` when no provider document exists, e.g. a failed send)

Routes, all POST/GET under `app/api/agreements-v2/`: `send/route.ts` (the body above, or `{ resendOf: id }`), `sync/route.ts`, `document/route.ts?id=`.

Rental rows keep using the existing `POST /api/esign/view { agreementId }` to view and download, and `POST /api/esign` to resend. New calls live in `components/agreements-v2/*`, never in `agreements/page.tsx` (the spine tests count its fetches).

`AgreementRowV2` also carries `hasContentSnapshot: boolean` (individual rows only).

## Details from the video frames (Haseeb's screenshots, Sep 21 — later lanes, integration and verify MUST apply these)

- **What the lead is replacing** (the v1 page at 13:00–15:27): four stat cards (Total / Original / Extensions / Signed), a search box, and columns Agreement | Customer | Status | Sent | Signed | "No document". At 14:38–14:58 he points at the **Extensions** card: "this is nothing, we will not put this here". So v2 has NO Original/Extensions/Signed cards. The hero row replaces them (D15). The Signed column and the "No document" cell go (D16, D17).
- **Overview inspiration** (13:00, BoldSign dashboard: "Waiting for me / Waiting for others / Needs attention / Recently completed"). "The show we have in BoldSign is also showing here." Our equivalents are Total · Signed · Pending signature · Failed, plus "Recently signed" and "Failed" lists (D15).
- **Template chooser** (BoldSign "Choose Template(s)", 06:46): the search field on top, then the list, with an illustrated empty state ("No templates yet"). We DROP its "All / Shared with me / Created by me" tabs. TemplatePickerV2 and the templates section follow this.
- **Recipient + CC** (BoldSign "Prepare document", 07:21): "Recipient name*", "Recipient email*", then "Add CC: enter one or more email addresses separated by a comma". The CC input MUST accept a comma- or space-separated paste of several addresses, as well as Enter.
- **Signature fields palette** (BoldSign "Configure fields", 10:18): a vertical palette of field tiles (icon + label). We keep only **Signature**, **Initials** and **Date signed** (10:55), shown as tiles in the same style, which are dragged onto the document.
- **Operator signature dialog** (BoldSign "Signature", 11:54): tabs **Draw** and **Upload** (BoldSign also has "Type", which the lead did not ask for), the line **"I understand that this is a legal representation of my signature."**, and buttons **Cancel** and **Save & use**. Save & use stays disabled until there is a drawing or upload.
- **Signature block in the document** (12:19): two columns, "FOR THE COMPANY" (the operator's saved signature image, name, title, date) and "FOR THE CUSTOMER" (the signer's Signature field and Date signed). The starter content for "Create your template" / "Create new" should end with this two-column signatures section: the operator-signature slot on the company side, `{{@sig1}}` and `{{@date1}}` on the customer side. The PDF renderer has no columns, so it must still read correctly as a single column: the company block first, then the customer block.
- **Tooltip shape** (12:45, whiteboard): "description" on the first line, "e.g.: …" on the second.
- **Agreements = individual | rental** (whiteboard): the two kinds, as D4.
