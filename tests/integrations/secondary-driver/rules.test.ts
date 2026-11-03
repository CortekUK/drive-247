import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canManageSecondaryDriver,
  driverNameMatchesDocument,
  isDocumentExpired,
  parseSecondaryDriverInput,
} from "../../../supabase/functions/_shared/secondary-driver-rules";

const repo = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

describe("secondary driver: name on the ID", () => {
  it.each([
    ["Jane Mason", "JANE", "MASON"],
    ["jane mason", "Jane Ann", "Mason"],
    ["Jane Ann Mason", "Jane", "Mason"],
    ["José García", "JOSE", "GARCIA"],
    ["Mary-Jane O'Neil", "Mary Jane", "O Neil"],
    ["John Smith Jr", "John", "Smith"],
    ["Jane Mason", "MASON,", "JANE"],
  ])("accepts %s against %s %s", (typed, first, last) => {
    expect(driverNameMatchesDocument(typed, first, last)).toBe(true);
  });

  it.each([
    ["Jane Mason", "David", "Mason"],
    ["Jane Mason", "Jane", "Smith"],
    ["Jane", "Jane", "Mason"],
    ["Jane Mason", null, null],
    ["Jane Mason", "", ""],
    ["", "Jane", "Mason"],
    [null, "Jane", "Mason"],
  ])("rejects %s against %s %s", (typed, first, last) => {
    expect(driverNameMatchesDocument(typed, first, last)).toBe(false);
  });
});

describe("secondary driver: document expiry", () => {
  it("fails only a readable date in the past", () => {
    expect(isDocumentExpired("2026-11-02", "2026-11-03")).toBe(true);
    expect(isDocumentExpired("2026-11-03", "2026-11-03")).toBe(false);
    expect(isDocumentExpired("2030-01-01", "2026-11-03")).toBe(false);
    expect(isDocumentExpired(null, "2026-11-03")).toBe(false);
    expect(isDocumentExpired("not a date", "2026-11-03")).toBe(false);
  });
});

describe("secondary driver: what the renter submits", () => {
  it("cleans a valid driver", () => {
    const parsed = parseSecondaryDriverInput(
      { name: "  Jane   Mason ", email: " Jane@Example.COM ", phone: " " },
      "david@example.com",
    );
    expect(parsed).toEqual({ ok: true, driver: { name: "Jane Mason", email: "jane@example.com", phone: null } });
  });

  it.each([
    [{ name: "Jane", email: "jane@example.com" }, "first and last name"],
    [{ name: "x".repeat(121) + " Mason", email: "jane@example.com" }, "first and last name"],
    [{ name: "Jane Mason", email: "not-an-email" }, "valid email"],
    [{ name: "Jane Mason" }, "valid email"],
    [{ name: "Jane Mason", email: "DAVID@example.com" }, "own email"],
    [{ name: "Jane Mason", email: "jane@example.com", phone: "1".repeat(31) }, "too long"],
    [{ name: 42, email: {} }, "first and last name"],
  ])("rejects %j", (raw, message) => {
    const parsed = parseSecondaryDriverInput(raw as any, "david@example.com");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });
});

describe("secondary driver: pending rentals only", () => {
  const open = { status: "Pending", cancellation_requested: false, keysHandedOver: false };

  it("allows a pending rental before pick-up", () => {
    expect(canManageSecondaryDriver(open)).toBe(true);
  });

  it.each(["Active", "Closed", "Completed", "Cancelled", "Rejected", "", null])("refuses status %s", (status) => {
    expect(canManageSecondaryDriver({ ...open, status })).toBe(false);
  });

  it("refuses once the keys are out, or a cancellation is requested", () => {
    expect(canManageSecondaryDriver({ ...open, keysHandedOver: true })).toBe(false);
    expect(canManageSecondaryDriver({ ...open, cancellation_requested: true })).toBe(false);
  });
});

describe("secondary driver: stays out of agreements and Bonzah", () => {
  it("every agreement send that reads drivers excludes listing-only ones", () => {
    for (const path of ["apps/portal/src/app/api/esign/route.ts", "supabase/functions/create-boldsign-document/index.ts"]) {
      const src = read(path);
      const reads = [...src.matchAll(/\.from\('rental_additional_drivers'\)\s*\.select\(/g)];
      expect(reads.length, `${path} should read drivers once`).toBe(1);
      expect(src.slice(reads[0].index, reads[0].index + 300), path).toContain(".eq('listing_only', false)");
    }
  });

  it("the renter's function reaches no agreement, insurance or money table", () => {
    const src = read("supabase/functions/customer-secondary-driver/index.ts");
    const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set(["identity_verifications", "rental_additional_drivers", "rentals", "customer_users", "rental_key_handovers"]),
    );
    expect(src).not.toMatch(/functions\.invoke|functions\/v1/);
  });

  it("the renter's function never returns a licence number or verification link", () => {
    const src = read("supabase/functions/customer-secondary-driver/index.ts");
    expect(src).not.toMatch(/license_number|verification_url|verificationUrl/);
  });
});

describe("secondary driver: every portal renders it", () => {
  it("Northwind screens toast through its own sonner, or the messages never appear", () => {
    for (const path of [
      "apps/booking/src/northwind-site/components/portal/secondary-driver-panel.tsx",
      "apps/booking/src/app/(northwind-v2)/northwind-site-v2/portal-v2/rentals/[id]/secondary-driver-card.tsx",
    ]) {
      expect(read(path), path).toContain("from 'sonner-nw'");
    }
  });

  it.each([
    ["apps/booking/src/app/(legacy)/(customer-portal)/portal/bookings/[id]/page.tsx", "<SecondaryDriverCard rentalId={id} />"],
    ["apps/booking/src/app/(northwind)/northwind-site/(portal)/portal/bookings/[id]/page.tsx", "<SecondaryDriverPanel rentalId={rental.id} />"],
    ["apps/booking/src/app/(northwind-v2)/northwind-site-v2/portal-v2/rentals/[id]/page.tsx", "<SecondaryDriverCard rentalId={rental.id} />"],
  ])("%s", (path, tag) => {
    expect(existsSync(join(repo, path))).toBe(true);
    expect(read(path)).toContain(tag);
  });
});
