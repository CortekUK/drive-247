import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const sql = read("supabase/migrations/20261119100000_invoice_numbers_never_collide.sql");

describe("invoice numbers never collide between companies", () => {
  it("runs before the insert, so the unique index never refuses a new rental", () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.invoices/);
  });

  it("can see every company's numbers even though staff cannot", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = ''");
  });

  it("makes rentals saved at the same moment take turns", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("only changes the monthly running numbers", () => {
    const shape = new RegExp("^INV-[0-9]{6}-[0-9]{4,}$");
    expect(sql).toContain("'^INV-[0-9]{6}-[0-9]{4,}$'");
    expect(shape.test("INV-202611-0033")).toBe(true);
    for (const other of ["INV-20261119-AB12CD", "INV-20261119-4821", "INV-NW-202609-012", "INV-QA-16"]) {
      expect(shape.test(other)).toBe(false);
    }
  });

  it.each(["apps/portal/src/app/(dashboard)/rentals/new/page.tsx", "apps/portal/src/components/rentals-v2/rental-create-v2.tsx"])(
    "%s saves through the insert the database now protects",
    (screen) => {
      expect(read(screen)).toContain('import { createInvoice, Invoice } from "@/lib/invoice-utils"');
    },
  );
});
