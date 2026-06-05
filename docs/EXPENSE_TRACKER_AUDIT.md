# Expense Tracker — Comprehensive Audit

_Audited: 2026-06-05 · Portal app (`apps/portal`) · Feature built 2026-06-02_

> **Resolution status (2026-06-05):** All non-"cool-feature" items below are **DONE**.
> Phase 0 (H1, H2), Phase 1 (M1, M2, M3, M4), and Phase 2 (L1–L8) are implemented and
> verified (tsc clean, 10 unit tests passing). Two migrations were applied to the DB:
> `20260605120000_scope_expense_receipts_storage_rls` and `20260605120100_reclassify_expense_pnl`.
> M5 (RLS role-gate) was intentionally left as-is — it matches the codebase-wide pattern
> (RLS = tenant-scoped, app enforces role) and is tracked as an optional cross-cutting follow-up.
> Tier 1–3 "cool features" in §7 remain open by request.

This document is a full review of the Expense Tracker feature: correctness, security,
performance, data integrity, code quality, UX, and a roadmap of higher-value
("cool") features. Findings are ranked by severity with exact file locations and
concrete fixes so they can be worked through one by one.

---

## 1. Executive Summary

The Expense Tracker is a **well-engineered, thoughtfully-built feature**. It cleanly
extends the existing `vehicle_expenses` table into a full business-expense model,
keeps the P&L in sync via a database trigger, and follows the portal's React Query +
Supabase conventions. The latent `chk_pnl_category_valid` constraint bug was correctly
caught and fixed during the build.

However, the audit surfaced **2 issues that need fixing before this is production-solid**
(a storage leak and a cross-tenant storage-isolation gap), several **correctness/data-integrity
gaps**, and a number of **consistency, scale, and UX** improvements. There is also a clear,
high-value roadmap to make the feature genuinely best-in-class.

**Verdict:** Strong foundation. Fix the 🔴 items, tidy the 🟠 items, then layer on the
roadmap features. Nothing here requires a rewrite — it's all additive hardening + enhancement.

---

## 2. Scope Reviewed

| Layer | Files |
|-------|-------|
| Page | `src/app/(dashboard)/expenses/page.tsx` |
| Hooks | `src/hooks/use-expenses.ts`, `src/hooks/use-expense-categories.ts` |
| Components | `src/components/expenses/expense-dialog.tsx`, `src/components/expenses/expense-categories-dialog.tsx` |
| Schema | `src/client-schemas/expenses/expense.ts` |
| Permissions | `src/lib/permissions.ts` (tab key `expenses`, Finance group, route map) |
| DB | `supabase/migrations/20260602120000_add_expense_tracker.sql`, `…120100_harden_vehicle_expenses_rls.sql`, `…120200_allow_expenses_pnl_category.sql` |
| Related (overlap) | `src/hooks/use-vehicle-expenses.ts`, `src/components/vehicles/vehicle-expense-dialog.tsx` (legacy per-vehicle flow) |
| Downstream | `pnl_entries` → P&L dashboard (`app/(dashboard)/pl-dashboard/*`), vehicle detail/analytics, reports |

---

## 3. Current Architecture (as-built)

```
expenses/page.tsx
  ├─ useExpenses({search, category, scope, from, to})
  │    ├─ list query → vehicle_expenses (+ vehicle join), tenant-scoped, date/category/scope filters (server)
  │    ├─ search → CLIENT-side filter over loaded rows
  │    ├─ stats → CLIENT-side reduce (total / vehicle / business / topCategories)
  │    ├─ add / update / delete mutations
  │    └─ uploadReceipt / getReceiptUrl  (private bucket, signed URLs)
  ├─ useExpenseCategories()  → expense_categories (per-tenant, active/all)
  ├─ ExpenseDialog           → add/edit form (RHF + zod), receipt drag-drop, recurring toggle
  └─ ExpenseCategoriesDialog → manage categories (add / bucket / show-hide / delete)

DB trigger handle_vehicle_expense_pnl()  (INSERT/UPDATE/DELETE on vehicle_expenses)
  → writes "Cost" rows into pnl_entries, bucket resolved from expense_categories
  → writes vehicle_events only when vehicle_id is set
```

**Data model:** `vehicle_expenses.vehicle_id` is nullable (NULL = business/overhead);
`category` is free **text** (enum retired); extra cols `vendor`, `payment_method`,
`receipt_url`, `is_recurring`, `recurrence_interval`. New table `expense_categories`
(`name`, `pnl_bucket ∈ {Service, Expenses}`, `is_default`, `is_active`, `sort_order`,
unique on `(tenant_id, name)`). Private bucket `expense-receipts` (10MB, img+pdf).

---

## 4. Findings by Severity

### 🔴 CRITICAL / HIGH — fix first

---

#### H1. Orphaned receipt files on Replace / Remove (storage leak)
**Where:** `expense-dialog.tsx:168–195` (`handleSubmit`), `use-expenses.ts:251–266` (`uploadReceipt`)
**Problem:** When editing an expense and **replacing** or **removing** the receipt, a new
storage path is saved to `receipt_url` but the *previous* file is never deleted from the
`expense-receipts` bucket. Only full **expense deletion** (`use-expenses.ts:229–248`) removes
the file. Additionally, if `uploadReceipt` succeeds but the subsequent `onSubmit` insert/update
throws, the just-uploaded file is orphaned too.
**Impact:** Unbounded growth of dead files in a paid private bucket; storage cost + clutter;
no way to reconcile.
**Fix:**
- On replace/remove, capture the old path and `storage.remove([oldPath])` after a successful save (best-effort, like delete already does).
- If `onSubmit` throws after a fresh upload, remove the new path in the `catch`.
- Consider a periodic reconciliation job (list bucket objects with no matching `receipt_url`).

---

#### H2. Storage RLS is not tenant-scoped (cross-tenant exposure)
**Where:** `20260602120000_add_expense_tracker.sql:201–217`
**Problem:** The bucket policies authorize purely on `bucket_id = 'expense-receipts'` with
**no tenant check**:
```sql
CREATE POLICY "Authenticated read expense-receipts" ... USING (bucket_id = 'expense-receipts');
CREATE POLICY "Authenticated delete expense-receipts" ... USING (bucket_id = 'expense-receipts');
```
Any authenticated user from **any tenant** can read or delete **any** receipt in the bucket
(e.g. via `createSignedUrl`/`remove` with a guessed path). Paths are
`{tenant_id}/{timestamp}-{hash}.ext` so they're hard to guess, but the policy provides no
isolation — this is the only data store in the feature that isn't tenant-scoped, and it's at
odds with the rest of the schema.
**Impact:** Cross-tenant read/delete of receipt documents (which can contain sensitive vendor
/ financial info). Real multi-tenancy isolation gap.
**Fix:** Scope every policy to the tenant folder:
```sql
USING (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
)
```
Apply the same `WITH CHECK` on INSERT so a user can only upload into their own tenant folder.
Keep the `service_role` policy as-is.

---

### 🟠 MEDIUM — correctness & data integrity

---

#### M1. Changing a category's P&L bucket does not reflow historical P&L
**Where:** `expense-categories-dialog.tsx:120–133` (bucket change), trigger `…120000…sql:109–177`
**Problem:** The trigger only fires on expense INSERT/UPDATE. If an operator switches a
category (e.g. "Fuel") from *Expenses* → *Service*, all **existing** Fuel expenses keep their
old bucket in `pnl_entries`. The categories config and the P&L report silently disagree.
**Impact:** Inaccurate Profit & Loss after any bucket reclassification — a correctness issue in
the financial reporting this feature feeds.
**Fix (pick one):**
- On bucket change, run an `UPDATE pnl_entries SET category = :newBucket WHERE reference LIKE 'vexp:%'`
  for matching expenses (via an RPC, since RLS blocks direct `pnl_entries` writes), **or**
- Warn the operator ("This won't change past entries") and offer a "reclassify history" action, **or**
- Add a DB function `reclassify_expense_category(tenant, name, bucket)` invoked by the dialog.

---

#### M2. Deleting a category orphans its expenses; no rename
**Where:** `expense-categories-dialog.tsx:144–153` (delete), `use-expense-categories.ts:107–122`
**Problem:** `category` is stored as free text on the expense, decoupled from the category row.
- **Delete:** removing a category leaves historical expenses showing a name that's no longer in
  the picker. You can't filter by it (`page.tsx:255–267` lists only live categories), and editing
  such an expense opens the dialog with a blank category (`expense-dialog.tsx:262` value won't
  match any `SelectItem`) → fails `min(1)` validation on save.
- **Rename:** there is **no rename** capability at all — only bucket change, show/hide, delete.
**Impact:** Data drift between expenses and categories; broken edit flow for affected rows;
operators resort to hide instead of rename.
**Fix:**
- Block or confirm deletion when the category is in use (count expenses; offer "hide instead").
- Add **rename**, and on rename run a bulk `UPDATE vehicle_expenses SET category = :new WHERE category = :old AND tenant_id = …` (text match) so history stays consistent. Update `pnl_entries` likewise if needed.
- In the edit dialog, if an expense's category isn't in the active list, inject it as a one-off option so the form is still valid.

---

#### M3. Recurring expense can save with a null interval
**Where:** `expense-dialog.tsx:494–518` (interval select), `:185–186` (submit mapping)
**Problem:** Toggling `is_recurring` on but never touching the interval dropdown saves
`is_recurring: true` with `recurrence_interval: null`. The dropdown only *displays*
`value={field.value ?? "monthly"}` — it doesn't write that default back to the field.
**Impact:** Inconsistent data; any future recurring automation would skip these rows.
**Fix:** Default the field to `"monthly"` when recurring is enabled (set on toggle, or coerce
in submit), and/or make the schema require an interval when `is_recurring` is true
(`z.refine`).

---

#### M4. Legacy per-vehicle expense dialog is out of sync with custom categories
**Where:** `components/vehicles/vehicle-expense-dialog.tsx:96–101` (hardcoded enum), `use-vehicle-expenses.ts:6` (enum type)
**Problem:** The vehicle-detail page still uses the **old** expense dialog with a **hardcoded
category enum** (`Repair/Service/Tyres/Valet/Accessory/Other`). A tenant who adds custom
categories on the Expenses page will **not** see them when adding an expense from a vehicle —
and the old dialog has no vendor / payment method / receipt / recurring fields. Two divergent
write paths into the same table.
**Impact:** Inconsistent UX, missing fields on one path, categories that don't match the
configured set, operator confusion.
**Fix:** Migrate the vehicle-detail expense action to reuse the new `ExpenseDialog`
(pre-filled with `vehicle_id`), and retire `vehicle-expense-dialog.tsx` /
`use-vehicle-expenses.ts`. Single source of truth for expense entry.

---

#### M5. Manager `viewer` can mutate via API (defense-in-depth)
**Where:** RLS `tenant manage vehicle_expenses` (`…120100…sql:15–20`), UI gate `page.tsx:85` (`canEdit("expenses")`)
**Problem:** The UI correctly hides add/edit/delete for non-editors, but the RLS `FOR ALL`
policy authorizes **any** authenticated user in the tenant — it does not consult
`manager_permissions`. A viewer-role manager could still write via the API.
**Impact:** Low real-world risk (UI-gated, internal users) but a defense-in-depth gap.
_Note:_ this matches the broader codebase pattern (RLS = tenant-scoped, app enforces role), so
fix only if you want stricter server-side enforcement — possibly a follow-up across features.

---

### 🟡 LOW — performance, quality, polish

---

#### L1. No pagination; search & stats are client-side
**Where:** `use-expenses.ts:88–160`
**Problem:** The list query has no `.limit()`. "All time" loads **every** expense for the
tenant, then search filters in memory and stats reduce over the full set on each keystroke.
**Impact:** Fine at current volume; degrades for high-volume operators (slow query, large
payload, laggy search).
**Fix:** Add server-side pagination (range) + push search to the server (`ilike` across
vendor/notes/reference, or a `tsvector`), and compute headline stats via an aggregate query/RPC
so they reflect the whole dataset rather than the current page.

#### L2. Dead stat: `recurringCount`
**Where:** `use-expenses.ts:157` — computed but never rendered. Either surface it (a KPI or a
"Recurring" filter chip) or remove it.

#### L3. Receipt opens in a new tab (no inline preview)
**Where:** `page.tsx:130–133`, `expense-dialog.tsx:163–166` — `window.open`. A lightbox/preview
(image inline, PDF embed) is a nicer, faster review experience and keeps the operator in-app.

#### L4. Receipt filename randomness is a hand-rolled hash
**Where:** `use-expenses.ts:254–259` — a bespoke string hash for uniqueness. `crypto.randomUUID()`
is simpler, collision-safe, and avoids the `Date.now()` + name dependence. (Minor.)

#### L5. `getReceiptUrl` swallows errors silently
**Where:** `use-expenses.ts:269–275` — returns `null` on error with no toast/log. A failed
receipt view just does nothing from the user's POV. Add a toast on failure.

#### L6. Stat-card styling inconsistency
**Where:** `page.tsx:219` — "Vehicle Costs" sets `valueClassName="text-foreground"` while the
other three don't. Harmless, but inconsistent; align them.

#### L7. No test coverage
**Where:** no files under `src/__tests__/**` for expenses. Portal is the app that *has* a test
setup. Given this feeds financial reporting, hook-level tests (stats math, scope filters,
category-bucket resolution, recurring coercion) would be high-value and cheap.

#### L8. CSV export is current-view only (intended, but worth a note)
**Where:** `page.tsx:135–176` — exports the filtered/searched in-memory set. Correct for "export
what I see," but if pagination lands (L1), add an "export all (server)" variant so a paged view
doesn't silently export a partial dataset.

---

## 5. Security Summary

| ID | Finding | Severity |
|----|---------|----------|
| H2 | Storage bucket policies not tenant-scoped (cross-tenant read/delete) | **High** |
| M5 | RLS doesn't enforce manager `viewer` vs `editor` (UI-only gate) | Medium (matches codebase norm) |
| — | Table RLS on `vehicle_expenses` / `expense_categories` correctly tenant-scoped | ✅ OK |
| — | Receipts in a **private** bucket, served via short-lived (10-min) signed URLs | ✅ OK |
| — | Inputs validated via zod; amounts bounded `≥ 0.01`; text length caps | ✅ OK |

---

## 6. Data Integrity Summary

- ✅ `pnl_entries` reference key `vexp:{id}` keeps insert/update/delete in lockstep.
- ✅ `tenant_id` stamped on P&L rows + historical backfill — overhead rolls into tenant totals.
- ✅ Unique `(tenant_id, name)` on categories makes the trigger's `LIMIT 1` lookup deterministic.
- ⚠️ **M1** bucket change doesn't reflow history.
- ⚠️ **M2** category delete/rename drifts from stored text categories.
- ⚠️ **M3** recurring rows can persist a null interval.
- ⚠️ Hard delete only — no soft-delete/audit trail for a financial record (consider `deleted_at` + `updated_by`).

---

## 7. Cool Features Roadmap

Ranked by value. These turn the page from a solid ledger into a genuinely powerful
finance tool.

### Tier 1 — high impact, natural next steps
1. **Recurring automation (cron).** Make the recurring toggle real: a scheduled job
   auto-creates the next occurrence (monthly/yearly) from a template, plus a
   **"Upcoming / Due soon"** section. Reuses the existing cron pattern (PAYG / auto-extension).
2. **Spend analytics.** Monthly trend line + category-mix donut + vehicle-vs-business split
   over time. Turns the KPI row into an insights dashboard. (recharts is already transpiled in portal.)
3. **Tax / VAT support.** `tax_rate`, `tax_amount`, net vs. gross. Makes the CSV
   accountant-ready and supports VAT-registered operators. Surface a "VAT reclaimable" stat.

### Tier 2 — power-user & workflow
4. **CSV import** (you already export) — bulk onboarding/migration with a column mapper + preview.
5. **Per-category budgets + alerts** — set a monthly cap per category; warn when exceeded
   (ties into the existing `reminder_config` / low-balance alerting pattern).
6. **Bulk actions** — multi-select rows for delete / re-categorize / export.
7. **Custom date range + column sorting** — DateRangePicker beyond the 4 presets; click-to-sort columns.
8. **Attach expense to a rental** (`rental_id`) — cost attribution per booking, not just per vehicle.

### Tier 3 — delight & depth
9. **Receipt OCR autofill** — you already have `ai-document-ocr`; parse vendor/amount/date from
   an uploaded receipt and pre-fill the form. Genuinely "cool" and on-brand with your AI features.
10. **Approval workflow** — expenses over a threshold require head-admin approval before hitting P&L.
11. **Inline receipt lightbox / gallery** (supersedes L3) — quick visual review without leaving the page.
12. **Mileage / per-km expenses** and **multi-currency** for cross-border operators.
13. **"Cost per vehicle" leaderboard** and **expense forecasting** (projected monthly burn from recurring + trend).

---

## 8. Suggested Execution Order

1. **Phase 0 — Harden (🔴):** H2 (tenant-scope storage RLS) + H1 (receipt cleanup on replace/remove/fail).
2. **Phase 1 — Correctness (🟠):** M3 (recurring interval), M1 (bucket reflow RPC), M2 (rename + delete safety), M4 (unify the legacy vehicle dialog).
3. **Phase 2 — Polish (🟡):** L1 pagination + server search, L3 receipt preview, L2/L5/L6 cleanups, L7 tests.
4. **Phase 3 — Cool features:** Tier 1 (recurring automation → analytics → tax), then Tier 2/3 as desired.

---

## 9. Appendix — Quick Reference (file : line)

| Concern | Location |
|---------|----------|
| Receipt orphan (H1) | `expense-dialog.tsx:168`, `use-expenses.ts:251` |
| Storage RLS (H2) | `20260602120000_add_expense_tracker.sql:201` |
| Bucket reflow (M1) | trigger `…120000….sql:109`; dialog `expense-categories-dialog.tsx:120` |
| Category delete/rename (M2) | `expense-categories-dialog.tsx:144`; `use-expense-categories.ts:93` |
| Recurring null interval (M3) | `expense-dialog.tsx:494`, `:185` |
| Legacy dialog drift (M4) | `vehicle-expense-dialog.tsx:96`; `use-vehicle-expenses.ts:6` |
| RLS role gate (M5) | `…120100….sql:15`; `page.tsx:85` |
| Pagination/search (L1) | `use-expenses.ts:88` |
| Dead stat (L2) | `use-expenses.ts:157` |
| Receipt preview (L3) | `page.tsx:130` |
</content>
</invoke>
