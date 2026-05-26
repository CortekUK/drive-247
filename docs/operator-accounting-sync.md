# Finance Sync — Operator Guide

This guide explains how to connect your accounting system (Xero or Zoho Books) to Drive247, configure which charges go to which accounts, and what to do when something goes wrong.

If you don't see **Settings → Accounting** in your portal, your subscription is on a tier that doesn't include Finance Sync. Contact your account manager to upgrade.

---

## 1. What Finance Sync does

Every rental-related financial event that happens in Drive247 — a customer paying, a damage charge, a refund, an extension fee — is automatically pushed into your accounting system. **You stop re-keying numbers manually**.

It works one-way: Drive247 → Xero / Zoho. We never read back from them or change anything you've manually adjusted on their side.

Each rental gets **one invoice** in your accounting system. As more charges happen (mileage overage, damage, late fee), we add lines to the same invoice. When the rental closes, the invoice is final. Rental extensions get their own new invoice that references the original (e.g. `INV-2026-0001 / EXT-1`).

You also get a brand-new **Reports → Vehicle Profitability** dashboard showing per-car revenue / expenses / profit / ROI — something neither Xero nor Zoho can compute for a rental business.

---

## 2. Connecting Xero

1. Open **Settings → Accounting**.
2. Click **Connect Xero**.
3. You'll be redirected to Xero — sign in if you aren't already.
4. Pick the Xero organisation you want to sync to (most operators have one).
5. Click **Allow access**.
6. You'll be brought back to Drive247 with a green "Connected" badge.

We automatically pre-fill sensible default account mappings based on a typical car-rental business. Review them on the next screen, change anything you want, and click **Save mappings**.

### Connecting Zoho Books

The flow is the same, but Zoho has a regional data centre setup so we ask you to pick yours first:
- **Global (.com)** — United States
- **Europe (.eu)** — UK / EU
- **India (.in)** — India
- **Australia (.com.au)** — Australia
- **Japan (.jp)** — Japan
- **Saudi Arabia (.sa)** — Middle East

You can tell which one you're on by looking at your Zoho URL — if it's `books.zoho.eu/...`, pick Europe.

You can connect **both** Xero and Zoho at the same time if you keep different parts of your business in different tools. Each event will be pushed to both.

---

## 3. Configuring mappings

Open **Settings → Accounting → Configure mappings**.

Each row tells Drive247 which account each type of charge should be posted to, and which tax rate to apply.

| Charge type | What it is | Typical Xero account |
|---|---|---|
| Rental charge | Standard daily/weekly/monthly fee | 200 — Sales |
| Insurance charge | Bonzah or other insurance | 260 — Other Revenue |
| Damage charge | Damage assessed | 260 — Other Revenue |
| Mileage charge | Excess mileage overage | 260 — Other Revenue |
| Late fee | Late return penalty | 260 — Other Revenue (no VAT) |
| Charging cost | Tesla supercharger pass-through | 200 — Sales |
| Extension charge | Rental extension (own invoice) | 200 — Sales |
| Deposit (captured) | Security deposit captured | 260 — Other Revenue |
| Discount | Promo / goodwill discount | 200 — Sales (will appear negative) |

**Payment account** at the bottom is the bank or clearing account in your books where customer payments land — typically your Stripe Clearing account.

If you're not sure, leave the defaults. You can change any of these later. **New invoice lines** will use the new mapping; **existing invoices** in your provider aren't changed.

---

## 4. Syncing historical data (backfill)

If you've been on Drive247 for a while before connecting your accounting system, you'll have months of past charges + payments that aren't in your books yet.

Click **Sync historical data** from the connected card to open the backfill wizard:

1. **Pick a date range** — Last 12 months / All time / Custom. We show how many events would sync and roughly how long it takes (~2 min per 100 events).
2. **Confirm your mappings are set** — if anything's missing, the wizard nudges you to fix it first.
3. **Start** — the backfill runs in the background. You can close the wizard and check the sync log later.

The backfill *queues* events for sync; the actual posting to Xero/Zoho happens at the normal 2-minute cadence so we don't burst-blast their API.

---

## 5. The sync log

Open **Settings → Accounting → View sync log** to see every event we've tried to sync.

Four KPI tiles at the top:
- **Synced** — succeeded
- **Pending** — queued, will sync within ~2 minutes
- **Failed** — needs your attention
- **Total** — all-time count

Filter by status or date, search by invoice number or error text, and click any row to see the full detail.

---

## 6. Fixing failed syncs

If a row shows **Failed**, click it to open the detail drawer. We show:
- The error message from Xero/Zoho
- The most likely fix (with a one-click button)
- A **Retry now** button
- A **Mark skipped** option for events you genuinely don't want synced (e.g. a test transaction)

Common failure causes:

| Error code | What's wrong | Fix |
|---|---|---|
| `NO_MAPPING` | An event came in but the operator never mapped its account | Open Configure mappings, set an account for that charge type |
| `NO_PAYMENT_ACCOUNT` | Payment account isn't set | Open Configure mappings, scroll to the Payment account section |
| `VALIDATION` | The Xero/Zoho account code is inactive or deleted | Open Configure mappings, pick a different account |
| `AUTH` | The connection token has expired | Reconnect the provider (top banner usually has a [Reconnect] button) |
| `RATE_LIMIT` | Provider's rate limit hit | Wait — we back off automatically, no action needed |
| `WAITING_FOR_INVOICE` | Payment received before invoice synced | Wait — usually fixes itself on the next cron tick |

After fixing the underlying problem, click **Retry now** on the failed row. The next cron tick (within 2 minutes) processes it.

If we can't sync a row after 5 attempts, it goes into **dead-letter** state. The row stays `failed` and **only manual retry from the UI** re-queues it. Backoff schedule between attempts: 1 min, 5 min, 30 min, 2 hours, 12 hours.

---

## 7. The expired-connection banner

If your access to Xero or Zoho expires (which can happen after a few weeks of inactivity, or if you revoke our app in their settings), Drive247 shows a yellow banner at the top of every page:

> **Your Xero connection has expired.** New financial events aren't syncing. Reconnect to resume. [Reconnect →]

Click Reconnect, complete the OAuth flow again, and pending syncs pick up automatically. Nothing is lost — events stay in our queue until you reconnect.

---

## 8. Disconnecting

Open **Settings → Accounting**, click **Disconnect** on the provider card, confirm.

What happens:
- Drive247 stops syncing new events to that provider
- Existing invoices already in your Xero/Zoho stay where they are (we never delete anything)
- The connection row stays in our history (marked `revoked`)
- You can reconnect at any time — past financial events sit waiting in the queue and resume syncing as soon as you reconnect (same mappings)

---

## 9. The Vehicle Profitability dashboard

Open **Reports → Vehicle Profitability**.

This is independent of Xero/Zoho — it reads Drive247's internal ledger directly, so it works even before you've connected a provider.

You see:
- **4 KPI cards** — Revenue, Expenses, Net Profit, Avg ROI for the period
- **Per-vehicle table** with revenue, expenses, profit, utilisation %, ROI %
- Sortable by any column
- Click a row for a detail drawer (per-event-type breakdown coming in a future iteration)
- Period selector — last 30 days, 3 months, 6 months, 12 months, or all time
- Optional "include disposed vehicles" toggle

ROI is computed as `(period profit ÷ purchase price)`. Vehicles without a purchase price recorded show ROI as `—`.

---

## 10. Edge cases + limits

**What's NOT yet supported in V1** (will land in future versions):
- Per-vehicle Xero tracking categories (we put the reg in the invoice reference instead)
- Multi-org Zoho selection (we pick the first one)
- Multi-currency tenants — all events stamp the tenant's `currency_code` setting
- QuickBooks Online (Phase 3+)
- Reading paid status BACK from your provider (would need webhooks — V2)
- Stripe payout → bank rec
- Partner / co-host payouts as bills

**Rate limits**:
- Xero: we cap at 50 calls/min (their limit is 60)
- Zoho: we cap at 80 calls/min (their limit is 100)
- A big backfill (5000+ events) takes longer because of these caps — typically 30–60 minutes for the full sync.

**Closed rentals**: once a rental is marked `Closed` in Drive247, its invoice is final — no more lines added. Subsequent charges (e.g. a damage claim discovered after the rental ended) become their own new invoice.

---

## 11. Need help?

Reach out via the in-app chat or support@drive-247.com. Include:
- The tenant slug (in your URL: `<slug>.portal.drive-247.com`)
- The sync log row ID if it's a specific failure
- Screenshot of the error if possible

We can look up the full sync state, error class, and retry the row directly if needed.
