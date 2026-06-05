// One-off: attach sample PDF receipts to a few MOCK-DATA expenses on the test
// tenant so the receipt preview/download buttons are visible. Safe to re-run.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";

// --- load env from apps/portal/.env.local ---
const envText = readFileSync(
  new URL("../apps/portal/.env.local", import.meta.url),
  "utf8"
);
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error("Missing Supabase URL or service role key");

const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });
const TENANT = "09926302-f0ec-49f9-a05d-0cf1da93cf16";
const BUCKET = "expense-receipts";

function makeReceiptPdf({ category, amount, date, vehicle }) {
  const doc = new jsPDF({ unit: "pt", format: [320, 420] });
  doc.setFontSize(18);
  doc.text("RECEIPT", 24, 40);
  doc.setDrawColor(200);
  doc.line(24, 52, 296, 52);
  doc.setFontSize(11);
  doc.setTextColor(90);
  let y = 80;
  const row = (k, v) => {
    doc.setTextColor(140);
    doc.text(k, 24, y);
    doc.setTextColor(40);
    doc.text(String(v), 296, y, { align: "right" });
    y += 26;
  };
  row("Category", category);
  row("Date", date);
  if (vehicle) row("Vehicle", vehicle);
  row("Amount", `$${Number(amount).toFixed(2)}`);
  doc.line(24, y + 4, 296, y + 4);
  y += 34;
  doc.setFontSize(9);
  doc.setTextColor(160);
  doc.text("Sample receipt — Drive247 demo data", 24, y);
  return Buffer.from(doc.output("arraybuffer"));
}

const { data: rows, error } = await supabase
  .from("vehicle_expenses")
  .select("id, category, amount, expense_at, vehicle:vehicles(reg, make, model)")
  .eq("tenant_id", TENANT)
  .eq("reference", "MOCK-DATA")
  .is("receipt_url", null)
  .order("expense_at", { ascending: false })
  .limit(6);
if (error) throw error;

let done = 0;
for (const r of rows) {
  const pdf = makeReceiptPdf({
    category: r.category,
    amount: r.amount,
    date: new Date(r.expense_at).toISOString().slice(0, 10),
    vehicle: r.vehicle?.reg ? `${r.vehicle.reg} (${r.vehicle.make} ${r.vehicle.model})` : null,
  });
  const path = `${TENANT}/mock-receipt-${r.id}.pdf`;
  const up = await supabase.storage
    .from(BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    console.error("upload failed", r.id, up.error.message);
    continue;
  }
  const upd = await supabase
    .from("vehicle_expenses")
    .update({ receipt_url: path })
    .eq("id", r.id)
    .eq("tenant_id", TENANT);
  if (upd.error) {
    console.error("update failed", r.id, upd.error.message);
    continue;
  }
  done++;
  console.log(`attached receipt → ${r.category} $${r.amount}`);
}
console.log(`\nDone. Attached ${done} sample receipts.`);
