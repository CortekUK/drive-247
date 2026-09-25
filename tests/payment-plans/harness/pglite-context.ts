/**
 * A ScenarioContext on real Postgres: a private clone of the fully-migrated
 * PGlite database, the PglitePlanStore (pp_* functions + live FIFO trigger),
 * and the same simulated provider / recorders the memory context uses.
 */
import { RecordingNotifier, SimulatedLinkMinter, SimulatedProvider } from "@fn/_shared/payment-plans/providers.ts";
import { runTick } from "@fn/_shared/payment-plans/engine.ts";
import type { ScenarioContext, ScenarioPayment } from "@fn/_shared/payment-plans/scenarios.ts";
import { cloneDatabase, seedRental, toCents, type Db } from "./pglite";
import { PglitePlanStore } from "./pglite-store";

/** Every database handed out, so the suite can close them. */
export const openDatabases: Db[] = [];

export async function createPgliteContext(): Promise<ScenarioContext & { db: Db }> {
  const db = await cloneDatabase();
  openDatabases.push(db);
  const store = new PglitePlanStore(db);
  const provider = new SimulatedProvider({ account: "acct_sim", mode: "test", fallback: "succeed" });
  const notifier = new RecordingNotifier();
  const links = new SimulatedLinkMinter();
  const ctx: ScenarioContext & { db: Db } = {
    kind: "pglite",
    db,
    store,
    provider,
    notifier,
    links,
    tick: (asOf) => runTick({ store, provider, notifier, links }, { asOf }),
    at: async (asOf) => store.setNow(asOf),
    seedRental: async (owedCents) => {
      const r = await seedRental(db, { owedCents, timezone: "America/New_York" });
      return { rentalId: r.rentalId, tenantId: r.tenantId, customerId: r.customerId };
    },
    payments: async (rentalId) => {
      const rows = await db.q<any>(
        `SELECT id, payment_plan_occurrence_id, amount, refund_amount, method,
                COALESCE(stripe_payment_intent_id, square_payment_id) ref
           FROM payments WHERE rental_id = $1
          ORDER BY COALESCE(paid_at, created_at), created_at, id`,
        [rentalId],
      );
      return rows.map(
        (p): ScenarioPayment => ({
          id: p.id,
          occurrenceId: p.payment_plan_occurrence_id,
          amountCents: toCents(p.amount),
          refundCents: toCents(p.refund_amount),
          method: p.method,
          providerRef: p.ref,
        }),
      );
    },
    revisionCount: async (planId) => (await db.one<{ n: number }>(`SELECT count(*)::int n FROM payment_plan_revisions WHERE plan_id = $1`, [planId]))!.n,
  };
  return ctx;
}

export async function closeOpenDatabases(): Promise<void> {
  while (openDatabases.length) await openDatabases.pop()!.close();
}
