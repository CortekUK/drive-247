/**
 * A column count a phone cannot honour.
 *
 * `grid-cols-3` with no responsive prefix applies at 390px exactly as it does
 * at 1440px: three cells across a phone, ~106px each once the gaps and the
 * page gutter are taken out. That is narrower than a form input, narrower than
 * a formatted currency value, and narrower than most labels — so the content
 * either wraps into a column of single words or spills past its cell.
 *
 * A responsive pair (`grid-cols-1 sm:grid-cols-3`) costs the desktop nothing:
 * `sm:` is 640px, so every layout above a phone is byte for byte what it was.
 *
 * Not every fixed count is a mistake, though, and a rule that cannot say which
 * is which is a rule nobody keeps. The exceptions below were each looked at on
 * Sep 24 2026 and are listed with the reason they stay. The test is the list:
 * a NEW fixed grid fails until someone either makes it responsive or adds it
 * here with a reason — and an entry that no longer matches anything fails too,
 * so the list cannot rot into a pile of stale paths.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const SRC = resolve(__dirname, "../../");

/** Every fixed `grid-cols-N` for N >= 3 — no `sm:`/`md:`/`lg:` in front. */
const FIXED_GRID = /(?<![:\w-])grid-cols-([3-9]|1[0-2])\b/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * Known and kept, grouped by why.
 *
 * A week is seven days wide on every screen there is; a swatch grid and a
 * thumbnail grid are small square things that do fit; a tab strip that drops
 * its labels below `lg` is already showing icons at a 55px target; and a
 * handful of tiles hold one short number each. Where a file escapes the count
 * another way — a `col-span-3 sm:col-span-1` on each child, a `v2Chrome`
 * conditional — the grid class alone cannot show it, so it is named here.
 */
const KEPT: Record<string, string> = {
  // Seven days, or a seven-day drawing of one.
  "components/availability-v2/availability-v2.tsx:548": "a week",
  "components/availability-v2/week-calendar.tsx:85": "a week (in a comment)",
  "components/availability-v2/week-calendar.tsx:112": "a week",
  "components/installments/InstallmentCalendar.tsx:114": "a week",
  "components/installments/InstallmentCalendar.tsx:120": "a week",
  "components/rentals/cadence-editor-dialog.tsx:95": "a week",
  "components/rentals/cadence-editor-dialog.tsx:98": "a week",
  "components/vehicles/vehicle-daily-pricing-calendar.tsx:141": "a week",
  "components/payment-plans/schedule-preview.tsx:261": "a week (the payment plan preview calendar)",
  "components/shared/featured-card-art-v2.tsx:299": "a drawing of a week",
  "components/shared/featured-card-art-v2.tsx:304": "a drawing of a week",

  // Tab strips that already drop their labels to icons below lg/sm.
  "app/(dashboard)/cms/about/page.tsx:293": "icon-only below lg",
  "app/(dashboard)/cms/contact/page.tsx:257": "icon-only below sm",
  "app/(dashboard)/cms/fleet/page.tsx:253": "icon-only below lg",
  "app/(dashboard)/cms/promotions/page.tsx:583": "icon-only below lg",
  "app/(dashboard)/cms/reviews/page.tsx:179": "icon-only below sm",
  "components/settings/communication-settings.tsx:83": "three tabs, icon-only below sm",

  // Small square things, which is what a phone has room for three or six of.
  "components/settings/color-picker.tsx:144": "colour swatches",
  "components/cms-v2/cms-image-picker.tsx:120": "thumbnails, already 3 then 4",

  // One short number per cell.
  "app/(dashboard)/blocked-customers/page.tsx:282": "three counts",
  "app/(dashboard)/settings/blacklist/page.tsx:148": "three counts",
  "app/(dashboard)/integrations/_panels/square.tsx:739": "three counts",
  "app/(dashboard)/integrations/_panels/xero.tsx:566": "four counts",
  "components/customers/customer-csv-import-dialog.tsx:226": "three counts",
  "components/settings/accounting-backfill-wizard.tsx:283": "three counts, text-xs",
  "components/insurance/rental-insurance-verifications-card.tsx:74": "three, text-xs",
  "components/availability-v2/weekly-hours-card.tsx:109": "a three-way segmented control",
  "components/customers/start-cmd-verification-dialog.tsx:268": "three channel buttons",

  // The grid class is not the whole story in these.
  "app/(dashboard)/vehicles/page.tsx:896": "grid-cols-4 IS the phone layout; sm: goes to flex",
  "components/vehicle-owners/create-payout-dialog.tsx:142": "each child is col-span-3 sm:col-span-1",
  "components/settings/extras-settings.tsx:1024": "responsive already, behind v2Chrome",
  "components/insurance/verification-detail-sheet.tsx:40": "a 1/3 + 2/3 split, not three cells",

  // Signed off as stable by the product owner on Sep 24 2026; left alone.
  "components/dashboard/action-items.tsx:309": "dashboard, kept as is",
  "components/dashboard/calendar-widget.tsx:83": "dashboard, kept as is",
  "components/dashboard/compliance-overview-card.tsx:66": "dashboard, kept as is",
  "components/dashboard/revenue-chart.tsx:156": "dashboard, kept as is",

  // Not the product.
  "app/playground/customer-detail-fake/_history.tsx:534": "playground",
  "app/playground/rental-create-fake/_customer-tab.tsx:1070": "playground",
  "app/playground/rental-create-fake/_handover-tab.tsx:456": "playground",
  "app/playground/vehicle-detail-fake/_tabs-money.tsx:118": "playground",
};

describe("no page lays out a phone in three fixed columns", () => {
  const found = new Set<string>();
  for (const file of tsxFiles(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const _ of line.matchAll(FIXED_GRID)) found.add(`${rel}:${i + 1}`);
    });
  }

  it("has no fixed grid that is not a known, reasoned exception", () => {
    const unexplained = [...found].filter((site) => !(site in KEPT)).sort();
    expect(unexplained).toEqual([]);
  });

  it("lists no exception that has moved or gone", () => {
    // Line numbers drift. An entry that matches nothing is a stale licence for
    // a grid that may since have become a real one, so it has to be re-checked
    // rather than carried.
    const stale = Object.keys(KEPT).filter((site) => !found.has(site)).sort();
    expect(stale).toEqual([]);
  });

  it("keeps the desktop layout on every grid the sweep made responsive", () => {
    // The whole safety of the change: each one restores its original count at
    // `sm:` and up, so nothing above a phone moved.
    for (const [file, cls] of [
      ["components/vehicles/add-vehicle-dialog.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/vehicles/edit-vehicle-dialog.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/settings/installment-config-dialog.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/ui/location-picker.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/shared/dialogs/refund-dialog.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/rentals-v2/vehicle-step.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/vehicle-owners/create-payout-dialog.tsx", "grid-cols-2 sm:grid-cols-4"],
      ["components/rentals-v2/rental-detail/stage-customer.tsx", "grid-cols-2 sm:grid-cols-3"],
      ["components/rentals-v2/rental-detail/stage-handover.tsx", "grid-cols-2 sm:grid-cols-3"],
    ] as const) {
      expect(readFileSync(resolve(SRC, file), "utf8")).toContain(cls);
    }
  });
});
