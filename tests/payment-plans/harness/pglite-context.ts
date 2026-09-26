/**
 * A ScenarioContext on real Postgres: a private clone of the fully-migrated
 * PGlite database, the PglitePlanStore (pp_* functions + live FIFO trigger),
 * and the same simulated provider / recorders the memory context uses.
 */
import { RecordingNotifier, SimulatedInsurer, SimulatedLinkMinter, SimulatedProvider } from "@fn/_shared/payment-plans/providers.ts";
import { runTick } from "@fn/_shared/payment-plans/engine.ts";
import type { ScenarioContext, ScenarioExtension, ScenarioPayment } from "@fn/_shared/payment-plans/scenarios.ts";
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
  const insurer = new SimulatedInsurer();
  const ctx: ScenarioContext & { db: Db } = {
    kind: "pglite",
    db,
    store,
    provider,
    notifier,
    links,
    insurer,
    tick: (asOf) => runTick({ store, provider, notifier, links, insurer }, { asOf }),
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
    seedRenewalRental: async (seed) => {
      const r = await seedRental(db, {
        timezone: "America/New_York",
        startDate: "2026-09-25",
        endDate: seed.endDate,
        monthlyAmount: seed.monthlyAmount,
        discountApplied: seed.discountApplied,
        tenantPricing: { taxPercentage: seed.taxPercentage, serviceFeeFixed: seed.serviceFeeFixed },
      });
      return { rentalId: r.rentalId, tenantId: r.tenantId, customerId: r.customerId };
    },
    rentalEndDate: (rentalId) => store.rentalEndDate(rentalId),
    extensions: async (rentalId) => {
      const exts = await db.q<any>(
        `SELECT id, sequence_number, status, previous_end_date, new_end_date, extension_days, rental_amount, tax_amount,
                service_fee_amount, insurance_amount, bonzah_policy_id
           FROM rental_extensions WHERE rental_id = $1 ORDER BY sequence_number`,
        [rentalId],
      );
      const out: ScenarioExtension[] = [];
      for (const e of exts) {
        const charges = await db.q<any>(
          `SELECT category, amount, remaining_amount FROM ledger_entries
            WHERE extension_id = $1 AND type = 'Charge'
            ORDER BY CASE category WHEN 'Extension Rental' THEN 8 WHEN 'Extension Tax' THEN 9
                                   WHEN 'Extension Service Fee' THEN 10 WHEN 'Extension Insurance' THEN 11 ELSE 13 END,
                     created_at, id`,
          [e.id],
        );
        out.push({
          sequenceNumber: e.sequence_number,
          status: e.status,
          previousEndDate: e.previous_end_date,
          newEndDate: e.new_end_date,
          days: e.extension_days,
          rentalCents: toCents(e.rental_amount),
          taxCents: toCents(e.tax_amount),
          serviceFeeCents: toCents(e.service_fee_amount),
          insuranceCents: toCents(e.insurance_amount),
          bonzahPolicyId: e.bonzah_policy_id,
          charges: charges.map((c) => [c.category, toCents(c.amount), toCents(c.remaining_amount)] as [string, number, number]),
        });
      }
      return out;
    },
  };
  return ctx;
}

export async function closeOpenDatabases(): Promise<void> {
  while (openDatabases.length) await openDatabases.pop()!.close();
}
