import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * A variable an operator can PICK from the editor menu must reach the signed PDF.
 *
 * Moore Luxe's live agreement R-798b28 printed the literal text
 * "{{rental_discount}}" to the renter, in the fee section of a contract they were
 * being asked to sign. The variable was offered in the picker and rendered
 * correctly in the editor preview, so nothing looked wrong until it reached a
 * customer — the preview and the three send engines build their variable maps
 * from completely separate code, and `rental_discount` existed only in the
 * preview's.
 *
 * This test locks the picker and the send path together for the names it is
 * reasonable to expect everywhere.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const CATALOGUE = read("apps/portal/src/lib/template-variables.ts");

/**
 * The engines spread shared modules into their maps, so a name can be supplied
 * without appearing literally in the route file.
 */
const SHARED = [
  "apps/portal/src/lib/agreement-datetime.ts",
  "apps/portal/src/lib/agreement-mileage.ts",
].map(read).join("\n");

const ENGINES: Record<string, string> = {
  portal: read("apps/portal/src/app/api/esign/route.ts") + SHARED,
  booking: read("apps/booking/src/app/api/esign/route.ts") + SHARED,
  edge: read("supabase/functions/create-boldsign-document/index.ts") + SHARED,
};

const supplies = (engine: string, key: string) =>
  new RegExp(`\\b${key}\\b`).test(ENGINES[engine]);

/**
 * Names every engine must supply, whatever kind of rental it is sending. These
 * describe the rental itself — dates, money, vehicle, renter — so there is no
 * engine for which "not applicable" is a defensible answer.
 *
 * Deliberately NOT the whole catalogue. The booking engine legitimately omits 50+
 * names for features it never sends (extensions, installment plans, additional
 * drivers, PAYG); asserting those would force stub values into a contract for
 * things that do not exist on that rental.
 */
const UNIVERSAL = [
  "customer_name",
  "customer_email",
  "vehicle_make",
  "vehicle_model",
  "vehicle_reg",
  "rental_number",
  "rental_start_date",
  "rental_end_date",
  "rental_price",
  "rental_period_type",
  "rental_discount",
  "pickup_location",
  "return_location",
  "company_name",
  "agreement_date",
];

describe("template variable parity — picker vs signed document", () => {
  it.each(Object.keys(ENGINES))(
    "%s engine supplies every universal rental variable",
    (engine) => {
      const missing = UNIVERSAL.filter((k) => !supplies(engine, k));
      // A name in this list that an engine does not supply reaches the customer
      // as literal "{{name}}" text inside a contract they are signing.
      expect(missing).toEqual([]);
    }
  );

  it("every universal variable is actually offered in the picker", () => {
    // Guards the other direction: a name asserted above but absent from the
    // catalogue would make this suite pass while operators cannot pick it.
    const offered = new Set(
      [...CATALOGUE.matchAll(/^\s{4}key:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    );
    expect(UNIVERSAL.filter((k) => !offered.has(k))).toEqual([]);
  });

  it("rental_discount specifically reaches all three engines", () => {
    // The exact regression: picked from the menu, rendered in preview, printed
    // literally into Moore Luxe's signed contract R-798b28.
    for (const engine of Object.keys(ENGINES)) {
      expect(supplies(engine, "rental_discount")).toBe(true);
    }
  });

  it("the catalogue has no duplicate keys", () => {
    const keys = [...CATALOGUE.matchAll(/^\s{4}key:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});
