/**
 * The multi-period switch — the one line that puts extensions back.
 *
 * A rental on this screen is ONE fixed period: one start date, one end date,
 * one set of charges. Everything that would split it into more than one period
 * — extensions, auto-extension, pay-as-you-go accrual, instalment plans — is
 * off the rendered surface, and this constant is what takes it off.
 *
 * ── What it gates ──────────────────────────────────────────────────────────
 *
 *   right-rail.tsx        the Extensions tab (strip, cards, detail dialog and
 *                         the pinned Extend / Auto-extension footer)
 *   stage-payments.tsx    the read of `rental_extension_totals` — with no
 *                         periods to compare there is nothing to read
 *   payments-model.ts     `extension_id` as a grouping dimension, and the
 *                         per-extension segments built from it
 *   stage-agreement.tsx   the Extension agreements block
 *   stage-insurance.tsx   the Extension cover block
 *   stage-when-where.tsx  the "this hire was extended" line, and pay-as-you-go
 *                         wording on the duration chip
 *
 * ── What was NOT gated, and deliberately ───────────────────────────────────
 *
 * Nothing period-shaped was removed along with it. Ad-hoc charges (a parking
 * fine belongs to no period, but it is not an extension), refunds, the deposit
 * and its hold, payment links, and the `Excess Mileage` allocator finding all
 * stay exactly as they were. Period drift on the agreement and the insurance
 * window comparison also stay — an operator can still move a rental's dates,
 * so a stored window can still disagree with it; only the claim that an
 * extension caused it is gone.
 *
 * ── Restoring it ───────────────────────────────────────────────────────────
 *
 * Flip this to `true`, then put back the two imports that were dropped rather
 * than gated: `RailExtensions` in `right-rail.tsx` and `SegmentMoney` in
 * `stage-payments.tsx`. Both files are untouched on disk and still compile —
 * they are simply not imported. `rail-activity.tsx` also lost its
 * `rental_extensions` read; the block it fed is the one thing that has to be
 * written again rather than switched back on.
 *
 * Typed `boolean` rather than left as the literal `false` so the gates below
 * read as conditions and not as unreachable code.
 */
export const SHOW_MULTI_PERIOD: boolean = false;
