// scripts/sim/scenario-payg-30-days.mjs
// Simulate ~30 days of PAYG accrual on a staging rental in seconds.
//
//   1. Load env:  set -a; source .env.staging; set +a
//   2. Run:       node scripts/sim/scenario-payg-30-days.mjs <rentalId>
//
// The rental must be an Active PAYG fixture on staging. Nothing here can touch
// production (helpers.mjs + sim-control both refuse any non-staging target).
import { shift, fire, log } from "./helpers.mjs";

const rentalId = process.argv[2];
if (!rentalId) {
  console.error("usage: node scripts/sim/scenario-payg-30-days.mjs <rentalId>");
  process.exit(1);
}

const DAYS = 30;
log(`PAYG catch-up: backdating rental ${rentalId} by ${DAYS} days`);
const s = await shift("payg", rentalId, DAYS);
log(`shifted [${s.cols.join(", ")}] (${s.rowsUpdated} row)`);

// accrue-payg-charges posts up to maxDaysFor() days per dispatch (a CONSTANT cap,
// e.g. 7/dispatch for 24h-window tenants), so a steady per-fire count is normal
// progress, NOT a stall. Fire until it posts nothing (backlog drained). The i<=10
// ceiling (>=70 days capacity) bounds runtime. Assert final ledger state, not counts.
for (let i = 1; i <= 10; i++) {
  const r = await fire("accrue-payg-charges", rentalId);
  const d = r.dispatch[0];
  const processed = d.body?.processed ?? d.body?.charged ?? null;
  log(`fire #${i} → HTTP ${d.status}, processed=${JSON.stringify(processed)}`);
  if (processed === 0 || processed === null) break;
}
log(`done — inspect the ledger for ~${DAYS} daily accruals on rental ${rentalId}`);
