# Review: `databaseFinanceScopes` — an explicit authorization change

**Status: implemented in code, committed, and NOT deployed.** `TRAX_FINANCE_READS` is absent from the project's edge-function secrets (verified 2026-09-18, names only), and no edge function has been deployed from these commits. Nothing described here is live.

This is a **permission widening** and is presented for approval on its own, separately from the security containment. It should not be enabled in production until the cases below are accepted.

## 1. What changed, and why

Money datasets (`payments`, `profit_and_loss`) and the customer-balance tool are gated on a finance scope. Before, that scope came from `financeScopes(auth, policy)`, where `policy` is the **read-only Stripe configuration** — absent unless `TRAX_FINANCE_READS=enabled`, which is every deployment. The effect: an admin asking "how much did we collect last month?" was refused, not because of their permissions but because Stripe was not configured.

Reading the account's own `payments` table has nothing to do with Stripe. So business queries now use `databaseFinanceScopes(auth)` (`supabase/functions/trax-support/support/finance-types.ts`), which applies the same staff rule without the Stripe policy. The Stripe tools still use the policy-bound `financeScopes` — that is unchanged.

**The widening, stated plainly:** finance *reads through TRAX* go from **nobody** to **head admins, admins, and managers holding the Payments tab**. Nothing else about the platform changes; no write capability is added anywhere.

## 2. The permitted and denied cases

| Caller | `rental_payments` | `account_balance` | Money answers | Balances |
|---|---|---|---|---|
| `head_admin` | yes | yes | yes | yes |
| `admin` | yes | yes | yes | yes |
| super admin (acts as head admin) | yes | yes | yes | yes |
| `manager` with Payments **and** Rentals tabs | yes | yes | yes | yes |
| `manager` with Payments only | no | yes | account balance only | no |
| `manager` without Payments | no | no | **no** | **no** |
| `ops` | no | no | **no** | **no** |
| `viewer` | no | no | **no** | **no** |

The balance tool additionally requires `canView(auth, 'customers')`, because a balance names customers: a manager needs that tab too, and is refused **before any statement is issued**.

Tested: `trax-conversation-data.test.ts` (admin allowed; viewer, ops and manager-without-Payments refused, through the real handler) and `trax-customer-balances.test.ts` (refusal before any read, verified by asserting zero statements were issued).

## 3. Tenant binding and revocation

- **Where the tenant comes from.** `authorize()` reads the staff row by `auth.uid()`; a `tenantId` in the request body is refused for anyone who is not a super admin. `databaseFinanceScopes` takes only `auth` — it cannot widen the tenant, only decide whether money may be read *within* the already-established account.
- **Every statement is scoped.** The query layer applies `eq(tenant_id, auth.tenant.id)` first and re-checks each returned row, refusing the result if a foreign row appears (`isolation_violation`). Proven against real SQL in `tests/trax/business-storage.mjs`.
- **Revocation.** The scope key (`SupportContext.scope`) is a digest over user, staff row, tenant, role, super-admin flag and ordered permissions. Any change — role, tab permission, tenant, deactivation — produces a different key, so nothing cached under the old one is reused. A removed staff row or a mismatched `auth_user_id` is refused outright. Tested in `trax-tenant-isolation.test.ts`.
- **Not cached across requests.** Scopes are computed per request from the freshly read staff row; there is no scope cache with its own lifetime to invalidate.

## 4. A real limitation in the money guard, stated honestly

The orchestrator now allows an answer to state a money figure **only if the query layer measured that figure in the same request** (`verifiedMoney`, keyed to two decimal places). That stops an **invented** number.

It does **not** verify **attribution**. The allowlist matches on value alone, so if a request measures `250.00` for one customer, an answer that attaches `250.00` to a *different* customer would pass the guard. Correct attribution comes from the query layer computing per-customer figures correctly — which is tested — not from this check.

Consequences, for review:

- an allowed amount on the wrong customer, period or currency is still a wrong answer, and this guard is not what prevents it;
- the guard is a **floor** (no fabricated totals), not a proof of correctness;
- the answer is required to state the definition, period and timezone the backend returned, so a reader can see what was measured;
- strengthening it would mean binding each figure to the group it came from — carrying label/currency/period with the value and checking co-occurrence in the answer text. That is not implemented. It is the obvious next increment if this is considered load-bearing.

Related and also honest: figures from the payment-investigation tools remain **unquotable** — those are displayed to the user from tool results, not restated by the model, exactly as before.

## 5. What to verify before enabling in production

1. Each row of the §2 table, against a real staff account in a non-production tenant.
2. A manager whose Payments tab is removed mid-session: the next question is refused.
3. A figure TRAX reports, reconciled by hand against the portal's own Payments page for the same period and timezone — including the known discrepancy that `/reports` and `/pl-dashboard` use the uncorrected pool, so the numbers can legitimately differ. That reconciliation is a task, not a claim.
4. That `ops` and `viewer` accounts are not even *offered* the finance datasets or the balance tool in discovery.
5. Currency handling for a tenant whose `currency_code` is unset: the total must be reported without a currency and with the limitation stated, not silently defaulted.
