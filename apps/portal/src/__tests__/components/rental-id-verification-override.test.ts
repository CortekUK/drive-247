/**
 * ID-verification override on the new-rental form (GMT request #2: "Could we
 * also get an admin override to be able to create a rental without id
 * verification").
 *
 * ── NOT YET BUILT ────────────────────────────────────────────────────────────
 * As of this suite there is no override anywhere in the repo. The gate in
 * apps/portal/src/app/(dashboard)/rentals/new/page.tsx is still unconditional:
 *
 *   // Check customer verification (STRICT — always required)
 *   if (!isCustomerVerified) {
 *     throw new Error("Customer must complete identity verification before rental can be created.");
 *   }
 *
 * and the submit button still hard-labels itself "Verification Required".
 * `git status` shows no working-tree changes to that file, and a repo-wide grep
 * for verification_override / skip_verification / bypass_verification finds only
 * apps/booking's unrelated `dev_bypass_verification` localStorage escape hatch.
 *
 * These are therefore left as todos rather than as red tests: failing on work
 * that was never delivered tells the next person nothing they don't already
 * know, and would block an unrelated merge. Fill them in when the override
 * lands — the three cases below are the ones the brief calls for, and each is
 * named after the way it can go wrong.
 *
 * Note for whoever writes them: rendering the new-rental page is not currently
 * possible in this workspace. apps/portal pins React 18.3.1 while the monorepo
 * root hoists React 19 for admin/web, so root-hoisted UI packages (@radix-ui/*,
 * lucide-react, @tanstack/react-query, react-hook-form) hand React-19 elements
 * to portal's React-18 renderer. Either add a resolve.alias for react/react-dom
 * to apps/portal/vitest.config.ts, or test the override's decision function in
 * isolation (which is the better shape for it anyway — a permission decision
 * should not need a DOM to be checked).
 */

import { describe, it } from 'vitest';

describe('new rental — ID-verification override (B4, not yet implemented)', () => {
  it.todo('is not offered to a viewer');

  it.todo('is not offered to a manager without the rentals editor permission');

  it.todo('is offered to head_admin and admin');

  it.todo('refuses to apply without a written reason');

  it.todo('records the reason and the acting user alongside the rental');

  it.todo('unblocks submission once applied, for an unverified customer');

  it.todo('leaves the strict gate in force for every other tenant and role');
});
