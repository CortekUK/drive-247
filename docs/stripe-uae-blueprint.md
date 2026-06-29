# Stripe Config Blueprint (exported from old account) — Phase 1a

Exported via Stripe MCP from the old account **"Cortek US"** (`acct_1SqMDfB2eFJBbbzi`) + cross-referenced against the prod DB `subscription_plans` table. This is the spec to recreate ("identical twin") on the new **UAE** account.

> **⚠️ Discovery 1 — there are TWO old Stripe accounts in play, not one.**
> - `acct_1SqMDfB2eFJBbbzi` ("Cortek US") — price IDs end in **`B2eFJBbbzi`**. Used by all the **real live operators**.
> - A **second account** — price IDs end in **`B9wIYWaRK0`**. Used only by test/demo/early tenants (`acme`, `delta-fleet`, `design`, `moiz`, `neema`, `temp`, `test`, `test-2`).
> The MCP is currently connected to the **Cortek US** one. The second account would need its own export if anything on it matters (looks like it doesn't — all test/demo).

> **⚠️ Discovery 2 — currency.** All real subscription prices are **USD**. A UAE Stripe account settles in **AED** but can present/charge in USD (converts on payout). A couple of legacy one-time products are in **GBP**.

---

## A. Subscriptions — the only part that really matters

**Architecture:** ONE shared product `Drive247 Platform Subscription` (`prod_TxiEj3BSH3NbO4`) with a separate **Price object per tenant** (22 active recurring prices, many duplicate amounts).

**Coupons / promo codes:** NONE on the account — nothing to recreate. ✅

### What each ACTIVE tenant plan needs recreated on UAE
(from prod `subscription_plans`, `is_active = true`; `amount` in cents)

| Tenant | Plan name | Amount | Interval | Trial days | Old price ID | Acct |
|---|---|---|---|---|---|---|
| amgroadside | Premium | $350 | month | 1 | price_1TLiGkB2eFJBbbzil0aD6ogg | US |
| averysrental | Premium | $250 | month | 7 | price_1TehoVB2eFJBbbzi4jwnl8uy | US |
| dbcarrentals | Premium | $350 | month | 0 | price_1T00plB2eFJBbbzix1Sr6BFi | US |
| eastpeakrentalsllc | Premium | $299 | month | 0 | price_1TfMK6B2eFJBbbzi6J7UwjAG | US |
| ejlbllc | Premium | $200 | month | 0 | price_1TjaXtB2eFJBbbziaEOOBh9B | US |
| flowautorentals | Premium | $250 | month | 0 | price_1TjaWvB2eFJBbbzitmy5ovWV | US |
| flowrentalsllc | Premium | $300 | month | 7 | price_1Tj2xqB2eFJBbbzi9yVJh3q9 | US |
| globalmotiontransport | Premium | $150 | month | 0 | price_1T4l3EB2eFJBbbziUbkLKZVC | US |
| goniko | Premium | $200 | month | 7 | price_1TaFWQB2eFJBbbzil61admP8 | US |
| jangramrentals | Premium | $350 | month | 7 | price_1TKmnmB2eFJBbbziHrqfHJUc | US |
| kedic-services | Premium | $350 | month | 0 | price_1SznLAB2eFJBbbzijhgvZoO3 | US |
| motoraprimellc | Premium | $200 | month | 7 | price_1TaaYlB2eFJBbbzi2GVPQJFm | US |
| nealcorentals | Premium | $350 | month | 0 | price_1T00mbB2eFJBbbziZ0KwwIA6 | US |
| openbayrental | Premium | $200 | month | 7 | price_1TgSrHB2eFJBbbzitrgnrbDH | US |
| rbvs | Premium | $350 | month | 7 | price_1TFJ5BB2eFJBbbzicTsJ5TGO | US |
| revtekrentals | Premium | $350 | month | 14 | price_1T7cHSB2eFJBbbzidMQXQR89 | US |
| torqueandtravel | Premium | $200 | month | 7 | price_1TFJPCB2eFJBbbziYy4pAvQe | US |

**Test/demo/second-account tenants (likely DON'T migrate):** `acme` $200, `delta-fleet` $200, `design` $200, `moiz` $200, `neema` $200, `temp` (×3), `test`, `test-2` $200, `drive-247` TEST $1, — most on the **B9wIYWaRK0** second account.

**Distinct real amounts:** $150, $200, $250, $299, $300, $350 /month.
**✅ DECIDED: exact 1:1 mirror** — recreate one price per tenant on UAE, matching amount/currency/interval/trial exactly as the old account (no dedupe).

---

## B. One-time products (setup / onboarding / deposits)
Recreate only the ones still in use; several look like stale duplicates.

| Product | Amount | Old price ID |
|---|---|---|
| Drive247 Platform Setup (US) | $2,500 | price_1TABHnB2eFJBbbziavpG8iS7 |
| Drive247 Platform Setup (US) (20% Discount) | $2,000 | price_1TBeXwB2eFJBbbziDE2Kzy1f |
| Drive247 Onboarding Fee (2/3) | $833.33 | price_1Tg7MEB2eFJBbbziX7qElSSQ |
| Drive247 Incubator | $300 | price_1Tl8U5B2eFJBbbzixAL78cZC |
| Drive247 Launch | $180 / $250 | price_1Tjp2q… / price_1Tj1lq… |
| Drive247 Growth | $200 / $250 / $299 | price_1Tg44i… / price_1TgBuK… / price_1Teyg7… |
| Deposit Drive247 Launch | $25 | price_1TjL9wB2eFJBbbziKQy2AgGa |
| Drive247 System Incubator | £1,878 (GBP) | price_1TBebPB2eFJBbbzihu3t4rBB |
| Drive247 (legacy) | £2,500 (GBP) | price_1TABCpB2eFJBbbziUpLtk68R |

## C. Credit packs — SKIP
~45 `Drive247 Credits (N)` products + 61 one-time credit prices. **Auto-created per purchase** — do NOT recreate. New ones generate naturally on the UAE account.

---

## Recreation plan (Phase 1b, once UAE MCP attached with a write key)
1. Create product `Drive247 Platform Subscription` on UAE.
2. Create the subscription **prices** (per-tenant or deduped — pending decision) → record new `price_…` IDs.
3. Create the in-use one-time fee products (setup/onboarding/deposit).
4. Update prod DB `subscription_plans.stripe_price_id` + `stripe_product_id` → new UAE IDs (per migrated tenant, as each moves).
5. Skip credit packs.
