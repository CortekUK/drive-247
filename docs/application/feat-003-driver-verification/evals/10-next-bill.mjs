// Spec 10 · The next bill. Stripe TEST mode only, on Northwind's staging test subscription (UAE test account).
// Every invoice item this eval makes is removed again through the sweep's staging-only undo.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { cleanup, customer, fn, NW, q, RAY1, sql, staff, sweep } from "./lib/helpers.mjs";

/** A finished premium check with its charge row, as finishPremium leaves it; returns the charge id. */
async function finishedCharge(name, { stateFee = 0 } = {}) {
  const c = await customer(name);
  const [s] = await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status, finished_at, booking_origin)
    values (${q(NW)}, ${q(c)}, md5(random()::text) || md5(random()::text), now() + interval '1 day', 'copy', 'verified', now(), 'https://northwind.ray1.drive-247.com') returning id`);
  await sql(`insert into verification_session_checks (session_id, tenant_id, service_key, provider_cost_cents, margin_cents, result, finished_at) values
    (${q(s.id)}, ${q(NW)}, 'standard', 33, 0, 'pass', now()),
    (${q(s.id)}, ${q(NW)}, 'licence_status', 299, 50, 'pass', now())`);
  const [ch] = await sql(`insert into verification_charges (tenant_id, session_id, customer_id, customer_name, service_key, provider_cost_cents, state_fee_cents, margin_cents)
    values (${q(NW)}, ${q(s.id)}, ${q(c)}, ${q(name)}, 'licence_status', 299, ${stateFee}, 50) returning id`);
  cleanup(() => sweep({ undoTestCharge: ch.id }));
  return ch.id;
}
const upcoming = async () => (await fn("integration-billing", { action: "upcoming" }, { as: await staff(), headers: RAY1 })).data?.upcoming;
const chargeRow = async (id) => (await sql(`select stripe_invoice_item_id, stripe_account, stripe_mode, sent_at, attempts, last_error, total_cents from verification_charges where id = ${q(id)}`))[0];

statement("10.1", "A charge becomes one Stripe invoice item on the company's subscription, for its total", async () => {
  const id = await finishedCharge("Bill One");
  equal((await sweep()).status, 200, "sweep ran");
  const ch = await chargeRow(id);
  ok(!!ch.stripe_invoice_item_id && !!ch.sent_at, "sent to Stripe");
  const lines = (await upcoming())?.lines ?? [];
  ok(lines.some((l) => l.kind === "verification" && l.label.startsWith("Licence active with the state ×")), "on the next bill");
});

statement("10.2", "It goes to the subscription's own Stripe account and mode", async () => {
  const id = await finishedCharge("Bill Account");
  await sweep();
  const ch = await chargeRow(id);
  const [sub] = await sql(`select stripe_account from tenant_subscriptions where tenant_id = ${q(NW)} order by created_at desc limit 1`);
  const [t] = await sql(`select subscription_stripe_mode from tenants where id = ${q(NW)}`);
  equal(`${ch.stripe_account}/${ch.stripe_mode}`, `${sub.stripe_account}/${t.subscription_stripe_mode}`, "account/mode");
});

statement("10.5", "A retry never makes a second item (idempotency key d247-vcheck-<charge id>)", async () => {
  const id = await finishedCharge("Bill Retry");
  await sweep();
  const first = await chargeRow(id);
  await sql(`update verification_charges set sent_at = null, stripe_invoice_item_id = null where id = ${q(id)}`);
  await sweep();
  const again = await chargeRow(id);
  equal(again.stripe_invoice_item_id, first.stripe_invoice_item_id, "the same Stripe item comes back");
});

statement("10.6", "On success the charge row gets the item id, the account, the mode and sent_at", async () => {
  const id = await finishedCharge("Bill Saved");
  await sweep();
  const ch = await chargeRow(id);
  ok(/^ii_/.test(ch.stripe_invoice_item_id ?? ""), "item id");
  ok(!!ch.stripe_account && !!ch.stripe_mode && !!ch.sent_at, "account, mode, sent_at");
  equal(ch.last_error, null, "no error");
});

statement("10.10", "The Stripe item is the charge row's total, to the cent", async () => {
  const id = await finishedCharge("Bill Amount", { stateFee: 800 });
  await sweep();
  const ch = await chargeRow(id);
  equal(ch.total_cents, 1149, "charge row total (299 + 800 + 50)");
  const lines = (await upcoming())?.lines ?? [];
  const row = lines.find((l) => l.kind === "verification" && l.label.startsWith("Licence active"));
  const [sum] = await sql(`select coalesce(sum(total_cents), 0)::int as cents from verification_charges
    where tenant_id = ${q(NW)} and service_key = 'licence_status' and sent_at is not null and stripe_mode = 'test'`);
  equal(row?.amount, sum.cents, "the bill's line equals the sum of the charge rows sent, to the cent");
});

statement("10.12", "The next bill labels these items as verification checks, grouped by check with a count", async () => {
  await finishedCharge("Bill Group A");
  await finishedCharge("Bill Group B");
  await sweep();
  const lines = (await upcoming())?.lines ?? [];
  const row = lines.find((l) => l.kind === "verification" && l.label.startsWith("Licence active with the state ×"));
  ok(!!row, "one grouped row");
  ok(Number(row.label.split("×")[1]) >= 2, `count shown (${row.label})`);
});

statement("10.14", "The free standard checks of the period are listed, counted from our own tables", async () => {
  await finishedCharge("Bill Standard");
  await sweep();
  const lines = (await upcoming())?.lines ?? [];
  const row = lines.find((l) => l.label.startsWith("Standard check,"));
  ok(!!row, "the free line");
  equal(row.amount, 0, "free");
});

statement("10.9", "A trialing subscription still gets the item on its next invoice", async () => {
  const [sub] = await sql(`select id, status from tenant_subscriptions where tenant_id = ${q(NW)} order by created_at desc limit 1`);
  await sql(`update tenant_subscriptions set status = 'trialing' where id = ${q(sub.id)}`);
  try {
    const id = await finishedCharge("Bill Trial");
    await sweep();
    ok(!!(await chargeRow(id)).sent_at, "sent while trialing");
  } finally {
    await sql(`update tenant_subscriptions set status = ${q(sub.status)} where id = ${q(sub.id)}`);
  }
});

statement("10.7", "With no live subscription the charge is kept unsent, with the attempt and the reason", async () => {
  const [sub] = await sql(`select id, status from tenant_subscriptions where tenant_id = ${q(NW)} order by created_at desc limit 1`);
  await sql(`update tenant_subscriptions set status = 'canceled' where id = ${q(sub.id)}`);
  try {
    const id = await finishedCharge("Bill Unsent");
    await sweep();
    const ch = await chargeRow(id);
    equal(ch.sent_at, null, "not sent");
    ok(ch.attempts >= 1 && /no live subscription/.test(ch.last_error ?? ""), `kept with its reason (${ch.last_error})`);
  } finally {
    await sql(`update tenant_subscriptions set status = ${q(sub.status)} where id = ${q(sub.id)}`);
  }
});

statement("10.17", "On staging a live Stripe mode is refused and nothing is sent", async () => {
  await sql(`update tenants set subscription_stripe_mode = 'live' where id = ${q(NW)}`);
  try {
    const id = await finishedCharge("Bill Live Refused");
    await sweep();
    const ch = await chargeRow(id);
    equal(ch.sent_at, null, "not sent");
    ok(/live Stripe mode on staging/.test(ch.last_error ?? ""), `refused (${ch.last_error})`);
  } finally {
    await sql(`update tenants set subscription_stripe_mode = 'test' where id = ${q(NW)}`);
  }
});

statement("10.18", "The company's own Stripe Connect account is never used: the item is on the subscription's customer", async () => {
  const id = await finishedCharge("Bill Not Connect");
  await sweep();
  const ch = await chargeRow(id);
  ok(["uk", "uae"].includes(ch.stripe_account), "a platform subscription account");
  const [t] = await sql(`select stripe_account_id from tenants where id = ${q(NW)}`).catch(() => [{}]);
  ok(!t?.stripe_account_id || !String(ch.stripe_invoice_item_id).includes(t.stripe_account_id), "not the Connect account");
});

await run(import.meta.url);
