/**
 * v2 Settings (northwind): the Pricing cleanup (build-spec D3, D5).
 *
 *   D3  The monthly rate leaves the Weekend and holiday pricing page for
 *       General, as `MonthlyRateSectionV2`, with the same save key.
 *   D5  Weekend and holiday pricing: one line when there are no holidays, Add
 *       holiday always in the section header, settings tables on the flat
 *       panel surface with no count line under a fully visible list, and the
 *       "Holiday on a weekend day" row saying what the engine really does.
 *
 * Expected numbers are worked out by hand in the comments, never produced by
 * the code under test.
 *
 * HARNESS: `react-dom/client` + `act`, like settings-v2-pricing-money-states.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  reads: {} as Record<string, any>,
  weekend: {} as any,
  holidays: {} as any,
}));

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }),
}));
vi.mock("@/hooks/use-weekend-pricing", () => ({ useWeekendPricing: () => h.weekend }));
vi.mock("@/hooks/use-tenant-holidays", () => ({ useTenantHolidays: () => h.holidays }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => undefined }));
vi.mock("@/components/settings-v2/pricing-money-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/settings-v2/pricing-money-parts")>();
  return {
    ...actual,
    useSettingsReadState: (key: any, enabled?: boolean) =>
      h.reads[String(key[0])] ?? actual.useSettingsReadState(key, enabled),
  };
});

import {
  MONTHLY_RATE_SAVE_KEY,
  MONTHLY_RATE_SECTION,
  MonthlyRateSectionV2,
  PricingRulesV2,
  STACK_SURCHARGES_COPY,
} from "@/components/settings-v2/pricing-rules-v2";
import { SettingsPageSaveProvider, SettingsSection } from "@/components/settings-v2/settings-kit";
import {
  SETTINGS_EMPTY_INLINE_CLASS,
  SettingsEmptyState,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import { LIST_SETTINGS_SURFACE } from "@/components/shared/list-table-v2";
import { calculateRentalPriceBreakdown } from "@/lib/calculate-rental-price";
import { CalendarRange } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const text = () => document.body.textContent ?? "";
const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

function buttons(name: string, scope: ParentNode = document.body): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button")).filter(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
}

function button(name: string, scope: ParentNode = document.body): HTMLButtonElement {
  const [hit] = buttons(name, scope);
  if (!hit) throw new Error(`No button "${name}"`);
  return hit;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const readState = (over: Record<string, unknown> = {}) => ({
  hasData: true,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: vi.fn(async () => undefined),
  ...over,
});
const loadingState = () => readState({ hasData: false, isLoading: true });

const holiday = (i: number, over: Record<string, unknown> = {}) => ({
  id: `h${i}`,
  tenant_id: "t1",
  name: `Holiday ${i}`,
  start_date: "2099-12-24",
  end_date: "2099-12-26",
  surcharge_percent: 20,
  excluded_vehicle_ids: [],
  recurs_annually: true,
  created_at: "",
  updated_at: "",
  ...over,
});

const monthlyTier = (over: Record<string, unknown> = {}) => ({
  value: 30,
  savedValue: 30,
  onChange: vi.fn(),
  onSave: vi.fn(async () => undefined),
  read: readState() as any,
  ...over,
});

/** Holiday pricing's <section>. */
const holidaySection = () => document.querySelector('section[aria-labelledby="v2-holiday-pricing"]')!;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // setup.ts mocks these with arrow `vi.fn`s, which cannot be `new`ed.
  (globalThis as any).ResizeObserver = ObserverStub;
  (globalThis as any).IntersectionObserver = ObserverStub;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.reads = { "weekend-pricing": readState(), "tenant-holidays": readState() };
  h.weekend = {
    settings: { weekend_surcharge_percent: 10, weekend_days: [6, 0], stack_surcharges: false },
    updateSettings: vi.fn(async () => undefined),
  };
  h.holidays = {
    holidays: [],
    addHoliday: vi.fn(async () => undefined),
    isAdding: false,
    updateHoliday: vi.fn(async () => undefined),
    isUpdating: false,
    deleteHoliday: vi.fn(async () => undefined),
    isDeleting: false,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/* -------------------------------------------------------------------------- */
/* D3: the monthly rate, on its own                                            */
/* -------------------------------------------------------------------------- */

describe("MonthlyRateSectionV2", () => {
  const lastSave = (registerSave: ReturnType<typeof vi.fn>) => {
    const calls = registerSave.mock.calls.filter((call) => call[0] === MONTHLY_RATE_SAVE_KEY && call[1]);
    return calls[calls.length - 1] as [string, () => Promise<unknown>, () => void] | undefined;
  };

  it("keeps the save key the page and business-rules-logic already use", () => {
    expect(MONTHLY_RATE_SAVE_KEY).toBe("pricing-monthly-tier");
  });

  it("renders the row with no heading of its own by default (General's section heads it)", () => {
    render(<MonthlyRateSectionV2 canEdit monthlyTier={monthlyTier()} />);
    expect(container.querySelector('[aria-label="Monthly rate starts at"]')).not.toBeNull();
    expect(container.querySelector("h2")).toBeNull();
    expect(document.getElementById("v2-monthly-rate")).toBeNull();
  });

  it("inside General's SettingsSection: exactly one 'Monthly rate' heading", () => {
    render(
      <SettingsSection anchor="monthly-rate" title={MONTHLY_RATE_SECTION.title} description={MONTHLY_RATE_SECTION.description}>
        <MonthlyRateSectionV2 canEdit monthlyTier={monthlyTier()} />
      </SettingsSection>,
    );
    const headings = Array.from(container.querySelectorAll("h1, h2, h3")).map((el) => el.textContent);
    expect(headings).toEqual(["Monthly rate"]);
    expect(text()).toContain(MONTHLY_RATE_SECTION.description);
  });

  it("withHeading draws its own heading, as the Custom pricing page did", () => {
    render(<MonthlyRateSectionV2 canEdit withHeading monthlyTier={monthlyTier()} />);
    const h2 = document.getElementById("v2-monthly-rate")!;
    expect(h2.tagName).toBe("H2");
    expect(h2.textContent).toBe(MONTHLY_RATE_SECTION.title);
    expect(container.querySelector('section[aria-labelledby="v2-monthly-rate"]')).not.toBeNull();
  });

  it("registers a save and a discard under the monthly key only while it differs from what is saved", async () => {
    const registerSave = vi.fn();
    const tier = monthlyTier({ value: 31, savedValue: 30 });
    render(
      <SettingsPageSaveProvider>
        <MonthlyRateSectionV2 canEdit registerSave={registerSave} monthlyTier={tier} />
      </SettingsPageSaveProvider>,
    );
    // Inside the page's save bar the section has no Save button of its own.
    expect(buttons("Save")).toHaveLength(0);
    const [, save, discard] = lastSave(registerSave)!;
    await act(async () => {
      await save();
    });
    expect(tier.onSave).toHaveBeenCalledTimes(1);
    act(() => discard());
    expect(tier.onChange).toHaveBeenCalledWith(30);

    // Saved value reached: it unregisters.
    registerSave.mockClear();
    render(
      <SettingsPageSaveProvider>
        <MonthlyRateSectionV2 canEdit registerSave={registerSave} monthlyTier={{ ...tier, savedValue: 31 }} />
      </SettingsPageSaveProvider>,
    );
    expect(registerSave).toHaveBeenCalledWith(MONTHLY_RATE_SAVE_KEY, null);
  });

  it("outside a page save bar it keeps its own Save; view only has none and a disabled select", () => {
    render(<MonthlyRateSectionV2 canEdit monthlyTier={monthlyTier({ value: 31 })} />);
    expect(button("Save").disabled).toBe(false);
    render(<MonthlyRateSectionV2 canEdit={false} monthlyTier={monthlyTier({ value: 31 })} />);
    expect(buttons("Save")).toHaveLength(0);
    expect(container.querySelector('[aria-label="Monthly rate starts at"]')!.matches(":disabled")).toBe(true);
  });
});

describe("PricingRulesV2 without the monthly rate", () => {
  it("has no monthly rate: no monthly row, heading or save registration", () => {
    const registerSave = vi.fn();
    render(<PricingRulesV2 canEdit registerSave={registerSave} />);
    expect(container.querySelector('[aria-label="Monthly rate starts at"]')).toBeNull();
    expect(document.getElementById("v2-monthly-rate")).toBeNull();
    expect(text()).not.toContain("Monthly rate");
    expect(registerSave.mock.calls.some((call) => call[0] === MONTHLY_RATE_SAVE_KEY)).toBe(false);
  });

  it("shows Weekend pricing, then Holiday pricing, and keeps the anchors", () => {
    render(<PricingRulesV2 canEdit />);
    expect(Array.from(container.querySelectorAll("h2")).map((el) => el.textContent)).toEqual([
      "Weekend pricing",
      "Holiday pricing",
    ]);
    expect(document.getElementById("v2-weekend-pricing")).not.toBeNull();
    expect(document.getElementById("v2-holiday-pricing")).not.toBeNull();
    expect(document.getElementById("v2-weekend-percent")).not.toBeNull();
    expect(document.getElementById("v2-stack-surcharges")).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* D5: holiday pricing                                                         */
/* -------------------------------------------------------------------------- */

describe("Holiday pricing, no holidays", () => {
  it("is one line, not the tall teaching card", () => {
    render(<PricingRulesV2 canEdit />);
    const empty = holidaySection().querySelector('[data-settings-state="empty"]')!;
    expect(empty.getAttribute("data-variant")).toBe("inline");
    expect(empty.textContent).toContain("No holiday surcharges yet.");
    // No icon tile heading, no bullet points, no button of its own.
    expect(empty.querySelector("h3")).toBeNull();
    expect(empty.querySelector("ul")).toBeNull();
    expect(empty.querySelector("button")).toBeNull();
  });

  it("has Add holiday in the section header, and it opens the add dialog", () => {
    render(<PricingRulesV2 canEdit />);
    const adds = buttons("Add holiday", holidaySection());
    expect(adds).toHaveLength(1);
    // In the header, beside the title, not inside the empty line.
    expect(adds[0].closest('[data-settings-state="empty"]')).toBeNull();
    act(() => adds[0].click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Add holiday");
  });

  it("adding: a complete form sends v1's payload and closes the dialog", async () => {
    render(<PricingRulesV2 canEdit />);
    act(() => button("Add holiday").click());
    const set = (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    set("v2-holiday-name", "Christmas");
    set("v2-holiday-start", "2026-12-24");
    set("v2-holiday-end", "2026-12-26");
    set("v2-holiday-surcharge", "20");
    act(() => button("Add holiday", document.querySelector('[role="dialog"]')!).click());
    await flush();
    expect(h.holidays.addHoliday).toHaveBeenCalledWith({
      name: "Christmas",
      start_date: "2026-12-24",
      end_date: "2026-12-26",
      surcharge_percent: 20,
      recurs_annually: false,
      excluded_vehicle_ids: [],
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("view only: the same one line, asking an admin, and nothing to click", () => {
    render(<PricingRulesV2 canEdit={false} />);
    const empty = holidaySection().querySelector('[data-settings-state="empty"]')!;
    expect(empty.textContent).toContain("Ask an admin");
    expect(buttons("Add holiday")).toHaveLength(0);
  });

  it("no Add holiday over a skeleton or a failed read", () => {
    h.reads["tenant-holidays"] = loadingState();
    render(<PricingRulesV2 canEdit />);
    expect(buttons("Add holiday")).toHaveLength(0);
    h.reads["tenant-holidays"] = readState({ hasData: false, isError: true, error: new Error("boom") });
    render(<PricingRulesV2 canEdit />);
    expect(buttons("Add holiday")).toHaveLength(0);
  });
});

describe("Holiday pricing, with holidays", () => {
  it("the table sits on the flat settings surface, not the padded, shadowed card", () => {
    h.holidays.holidays = [holiday(1), holiday(2)];
    render(<PricingRulesV2 canEdit />);
    const section = holidaySection();
    const surface = section.querySelector('[data-list-surface="settings"]')!;
    expect(surface.querySelector("table")).not.toBeNull();
    expect(section.querySelector('[data-slot="card"]')).toBeNull();
    // Add holiday stays in the header with rows too: one button.
    expect(buttons("Add holiday", section)).toHaveLength(1);
  });

  it("puts the controls at the end of the row, like the other v2 settings pages", () => {
    // Left-aligned, the input, the day pills and the switch sat just past the
    // 420px label column with the whole right half of the panel empty.
    render(<PricingRulesV2 canEdit />);
    const percent = document.querySelector("#v2-weekend-percent")!;
    const row = percent.closest("div.px-5")!;
    // The end layout: label takes the free space, the control column is auto.
    expect(row.querySelector("div")!.className).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    const controls = percent.closest("div.md\\:justify-end");
    expect(controls).not.toBeNull();

    // Every row of the panel follows, including the switch.
    const stack = document.querySelector("#v2-stack-surcharges")!;
    expect(stack.closest("div.md\\:justify-end")).not.toBeNull();
  });

  it("the name column reads from the left, while dates and numbers stay centred", () => {
    // A centred name column left a wide empty gap down the left of the table,
    // because Holiday takes whatever width the other four columns leave.
    h.holidays.holidays = [holiday(1), holiday(2)];
    render(<PricingRulesV2 canEdit />);
    const section = holidaySection();
    const heads = Array.from(section.querySelectorAll("th"));
    const nameHead = heads.find((th) => th.textContent?.trim() === "Holiday")!;
    const datesHead = heads.find((th) => th.textContent?.trim() === "Dates")!;
    expect(nameHead.className).toContain("text-left");
    expect(datesHead.className).not.toContain("text-left");

    const firstCell = section.querySelector("tbody tr td")!;
    expect(firstCell.className).toContain("text-left");
    expect(firstCell.querySelector("div")!.className).toContain("justify-start");
  });

  it("says nothing under the table when every holiday is on screen, and counts while more are coming", () => {
    h.holidays.holidays = [holiday(1), holiday(2)];
    render(<PricingRulesV2 canEdit />);
    expect(text()).not.toContain("holidays shown");

    // 30 holidays: the first fill is 25 rows, so 5 are still to come.
    h.holidays.holidays = Array.from({ length: 30 }, (_, i) => holiday(i + 1));
    render(<PricingRulesV2 canEdit />);
    expect(text()).toContain("Showing 25 of 30 holidays");
    expect(buttons("Show more")).toHaveLength(1);
  });

  it("the actions column: a screen-reader heading for editors, no column at all for viewers", () => {
    h.holidays.holidays = [holiday(1)];
    render(<PricingRulesV2 canEdit />);
    const heads = Array.from(holidaySection().querySelectorAll("thead th"));
    // Holiday, Dates, Surcharge, Repeats, Actions.
    expect(heads).toHaveLength(5);
    const last = heads[heads.length - 1];
    expect(last.textContent).toBe("Actions");
    expect(last.querySelector(".sr-only")?.textContent).toBe("Actions");

    render(<PricingRulesV2 canEdit={false} />);
    expect(holidaySection().querySelectorAll("thead th")).toHaveLength(4);
    expect(holidaySection().querySelectorAll("tbody tr:first-child td")).toHaveLength(4);
  });

  it("deleting: confirm removes it and closes the confirm", async () => {
    h.holidays.holidays = [holiday(1, { name: "Christmas" })];
    render(<PricingRulesV2 canEdit />);
    act(() => button("Delete Christmas").click());
    const confirm = document.querySelector('[role="alertdialog"]')!;
    act(() => button("Delete", confirm).click());
    await flush();
    expect(h.holidays.deleteHoliday).toHaveBeenCalledWith("h1");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("loading: the skeleton is the settings surface too, so nothing jumps by the card's padding", () => {
    h.reads["tenant-holidays"] = loadingState();
    render(<PricingRulesV2 canEdit />);
    const loading = holidaySection().querySelector('[data-settings-state="loading"]')!;
    expect(loading.querySelector('[data-list-surface="settings"]')).not.toBeNull();
    expect(loading.querySelector('[data-slot="card"]')).toBeNull();
    expect(loading.textContent).toContain("Loading holiday pricing");
  });
});

/* -------------------------------------------------------------------------- */
/* D5: "Holiday on a weekend day" says what the engine does                    */
/* -------------------------------------------------------------------------- */

describe("the stack surcharges row", () => {
  it("names the case in plain words and says the current effect beside the switch", () => {
    render(<PricingRulesV2 canEdit />);
    const label = container.querySelector('label[for="v2-stack-surcharges"]')!;
    expect(label.textContent).toBe(STACK_SURCHARGES_COPY.label);
    expect(text()).toContain(STACK_SURCHARGES_COPY.description);
    expect(document.getElementById("v2-stack-surcharges-state")!.textContent).toBe(STACK_SURCHARGES_COPY.off);

    act(() => (document.getElementById("v2-stack-surcharges") as HTMLButtonElement).click());
    expect(document.getElementById("v2-stack-surcharges-state")!.textContent).toBe(STACK_SURCHARGES_COPY.on);
    expect(document.getElementById("v2-stack-surcharges")!.getAttribute("aria-describedby")).toBe(
      "v2-stack-surcharges-help v2-stack-surcharges-state",
    );
  });

  it("the switch still saves stack_surcharges, unchanged", async () => {
    render(<PricingRulesV2 canEdit />);
    act(() => (document.getElementById("v2-stack-surcharges") as HTMLButtonElement).click());
    act(() => button("Save").click());
    await flush();
    expect(h.weekend.updateSettings).toHaveBeenCalledWith({
      weekend_surcharge_percent: 10,
      weekend_days: [6, 0],
      stack_surcharges: true,
    });
  });

  it("never claims 'the highest one applies' or that long bookings are exempt", () => {
    render(<PricingRulesV2 canEdit />);
    expect(text()).not.toMatch(/highest/i);
    expect(text()).not.toMatch(/7 days or more|under 7 days/);
  });

  describe("the copy matches the pricing engine", () => {
    // 2026-09-19 is a Saturday. Daily rate 100; weekend (Sat, Sun) 10%.
    const rates = { daily_rent: 100, weekly_rent: 700, monthly_rent: 0 };
    const weekend = (stack: boolean) => ({ weekend_surcharge_percent: 10, weekend_days: [6, 0], stack_surcharges: stack });
    const saturdayHoliday = (percent: number) => [
      { id: "h", name: "Holiday", start_date: "2026-09-19", end_date: "2026-09-19", surcharge_percent: percent, recurs_annually: false, excluded_vehicle_ids: [] },
    ];
    const oneSaturday = (stack: boolean, holidayPercent: number) =>
      calculateRentalPriceBreakdown("2026-09-19", "2026-09-20", rates, weekend(stack), saturdayHoliday(holidayPercent) as any, [], "v", 30).rentalPrice;

    it("off: only the holiday's surcharge, even when the weekend's is higher (not 'the higher one')", () => {
      // 5% holiday on a 10% weekend day: 100 x 1.05 = 105, not 110.
      expect(oneSaturday(false, 5)).toBe(105);
    });

    it("on: both added together; the description's own example, 20% on 10%, is 30% more", () => {
      // 100 x (1 + (20 + 10) / 100) = 130.
      expect(oneSaturday(true, 20)).toBe(130);
      // Off, the same day: 100 x 1.20 = 120.
      expect(oneSaturday(false, 20)).toBe(120);
      expect(STACK_SURCHARGES_COPY.description).toContain("a 20% holiday on a 10% weekend day costs 30% more");
    });

    it("weekly bookings pay the weekend surcharge too, on their per-day price", () => {
      // Sat 19 to Sat 26: 7 days, weekly tier, 700 / 7 = 100 a day.
      // Sat and Sun at 110, five weekdays at 100: 220 + 500 = 720.
      const week = calculateRentalPriceBreakdown("2026-09-19", "2026-09-26", rates, weekend(false), [], [], "v", 30);
      expect(week.pricingTier).toBe("weekly");
      expect(week.rentalPrice).toBe(720);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The kit additions                                                           */
/* -------------------------------------------------------------------------- */

describe("SettingsEmptyState inline", () => {
  it("is one flat bordered line, with the headline closed by a full stop", () => {
    render(<SettingsEmptyState variant="inline" icon={CalendarRange} headline="Nothing here yet" body="Add one above." points={["hidden"]} footnote="hidden too" />);
    const el = container.querySelector('[data-settings-state="empty"]')!;
    expect(classes(el)).toEqual(expect.arrayContaining(SETTINGS_EMPTY_INLINE_CLASS.split(" ")));
    expect(el.textContent).toBe("Nothing here yet. Add one above.");
    expect(el.querySelector("h3")).toBeNull();
  });

  it("does not double a headline's own punctuation, and puts an action at the end of the line", () => {
    const onClick = vi.fn();
    render(<SettingsEmptyState variant="inline" icon={CalendarRange} headline="Nothing here yet!" body="Go on." primaryAction={{ label: "Add one", onClick }} />);
    expect(container.textContent).toContain("Nothing here yet! Go on.");
    act(() => button("Add one").click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("leaves the card and compact variants as they were", () => {
    render(<SettingsEmptyState icon={CalendarRange} headline="Card" body="Body" points={["One"]} />);
    const card = container.querySelector('[data-settings-state="empty"]')!;
    expect(card.hasAttribute("data-variant")).toBe(false);
    expect(card.querySelector("h3")?.textContent).toBe("Card");
    expect(card.querySelector("ul")).not.toBeNull();
  });
});

describe("SettingsSectionSkeleton table surface", () => {
  it("defaults to the card, as every other list's skeleton", () => {
    render(<SettingsSectionSkeleton variant="table" rows={2} columns={3} />);
    expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(container.querySelector("[data-list-surface]")).toBeNull();
  });

  it("settings: the ListTable settings surface, with the same rows", () => {
    render(<SettingsSectionSkeleton variant="table" rows={2} columns={3} surface="settings" />);
    const surface = container.querySelector('[data-list-surface="settings"]')!;
    expect(surface.getAttribute("class")).toBe(LIST_SETTINGS_SURFACE);
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    // A head row and two body rows, three columns each.
    expect(surface.children).toHaveLength(3);
    expect(surface.children[1].children).toHaveLength(3);
  });
});
