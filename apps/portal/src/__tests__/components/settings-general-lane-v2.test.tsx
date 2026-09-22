/**
 * v2 Settings, team lead review of Sep 19 2026 (General and the sections that
 * moved out of it):
 *   - the reusable tab strip (`SettingsTabs`), whose panels stay mounted so a
 *     tab switch keeps unsaved edits;
 *   - controls at the END of a row (`SettingsRow align`, `SettingsRowAlignProvider`),
 *     opt-in so every other page keeps its layout;
 *   - Regional: US dollar is the one currency that can be picked, a saved
 *     other currency stays pickable, both pickers the same width at the row end;
 *   - Lockbox: Templates is a link with an arrow, not a button;
 *   - the index: the five pages that left General, in Business, each gated.
 *
 * Every expected value is written out by hand. The settings page itself is
 * too large to mount; its wiring is pinned in settings-v2-structure.test.tsx.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rental = vi.hoisted(() => ({
  state: { hasLoaded: true, error: null as unknown, isFetching: false, refetch: (() => undefined) as () => unknown },
}));

vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rental.state }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  SETTINGS_TAB_LIST,
  SETTINGS_TAB_TRIGGER,
  SettingsPanel,
  SettingsRow,
  SettingsRowAlignProvider,
  SettingsTabPanel,
  SettingsTabs,
} from "@/components/settings-v2/settings-kit";
import {
  BusinessRegionalPanel,
  CURRENCY_OPTION_LABELS,
  SELECTABLE_CURRENCY,
  isCurrencySelectable,
  savedRegionalV2,
  type GeneralSaveValues,
} from "@/components/settings-v2/business-settings-states";
import { LockboxPageV2 } from "@/components/settings-v2/business-rules-pages";
import { savedFieldsFor } from "@/components/settings-v2/business-rules-logic";
import { SETTINGS_INDEX_SECTIONS } from "@/components/settings-v2/settings-index";

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);
const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

// Radix's popper and select measure with these; jsdom has neither.
const SetupResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  rental.state = { hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() };
});
afterEach(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

/* -------------------------------------------------------------------------- */
/* The tab strip                                                               */
/* -------------------------------------------------------------------------- */

describe("SettingsTabs", () => {
  const TABS = [
    { value: "regional", label: "Regional" },
    { value: "driver-requirements", label: "Driver requirements" },
  ];

  /** Holds the open tab like the page does, with a field in each panel. */
  function Harness({ onChange }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState("regional");
    return (
      <SettingsTabs
        label="General"
        tabs={TABS}
        value={value}
        onValueChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      >
        <SettingsTabPanel value="regional">
          <input aria-label="Regional field" defaultValue="" />
        </SettingsTabPanel>
        <SettingsTabPanel value="driver-requirements">
          <input aria-label="Driver field" defaultValue="" />
        </SettingsTabPanel>
      </SettingsTabs>
    );
  }

  it("is a named tab list of pills, the open one selected", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    expect(list.getAttribute("aria-label")).toBe("General");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Regional", "Driver requirements"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("pills: brand tint when selected, the v2 hover pair, no grey track, no hardcoded indigo, rounded-full", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    expect(classes(list)).toEqual(expect.arrayContaining(["bg-transparent", "p-0", "justify-start"]));
    expect(classes(list)).not.toContain("bg-muted");
    const trigger = screen.getAllByRole("tab")[0];
    const cls = classes(trigger);
    expect(cls).toEqual(
      expect.arrayContaining([
        "rounded-full",
        "h-8",
        "hover:bg-primary/10",
        "dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
        "data-[state=active]:bg-primary/10",
        "data-[state=active]:text-primary",
        "dark:data-[state=active]:bg-primary/10",
        "dark:data-[state=active]:text-[hsl(var(--v2-link,var(--primary)))]",
      ]),
    );
    // The ui-v2 trigger's raised white segment look is replaced, not stacked under.
    for (const gone of [
      "data-[state=active]:bg-background",
      "data-[state=active]:text-foreground",
      "dark:data-[state=active]:bg-input/30",
      "dark:data-[state=active]:text-foreground",
      "flex-1",
      "hover:bg-muted",
    ]) {
      expect(cls, gone).not.toContain(gone);
    }
    for (const token of [SETTINGS_TAB_LIST, SETTINGS_TAB_TRIGGER]) {
      expect(token).not.toMatch(/indigo|#[0-9a-f]{3,6}|rounded-(md|sm|lg)\b/);
    }
  });

  it("switching tabs keeps the other tab mounted, hidden, with what was typed in it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const regional = screen.getByLabelText("Regional field") as HTMLInputElement;
    fireEvent.change(regional, { target: { value: "typed" } });

    fireEvent.mouseDown(screen.getAllByRole("tab")[1], { button: 0 });
    expect(onChange).toHaveBeenCalledWith("driver-requirements");
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);

    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels).toHaveLength(2);
    expect(panels.map((p) => p.getAttribute("data-state"))).toEqual(["inactive", "active"]);
    // Hidden by class, not unmounted: the edit and its registered save survive.
    expect(classes(panels[0])).toContain("data-[state=inactive]:hidden");
    expect((screen.getByLabelText("Regional field") as HTMLInputElement).value).toBe("typed");
    expect(screen.getByLabelText("Regional field")).toBe(regional);
  });
});

/* -------------------------------------------------------------------------- */
/* Controls at the end of the row                                              */
/* -------------------------------------------------------------------------- */

describe("SettingsRow align", () => {
  const Row = ({ align, id = "x" }: { align?: "start" | "end"; id?: string }) => (
    <div data-row="">
      <SettingsRow label="Distance unit" description="Used for mileage." align={align}>
        <button type="button" aria-label={`control ${id}`} />
      </SettingsRow>
    </div>
  );
  const rowRoot = (container: HTMLElement, index = 0) =>
    (container.querySelectorAll("[data-row]")[index] as Element).firstElementChild!;

  it('"end": the label takes the rest of the row and the control sits at its end, in the same two columns', () => {
    const { container } = render(<Row align="end" />);
    const layout = rowRoot(container).firstElementChild!;
    expect(classes(layout)).toEqual(
      expect.arrayContaining(["md:grid", "md:grid-cols-[minmax(0,1fr)_auto]", "md:items-center", "md:gap-x-10"]),
    );
    expect(classes(layout)).not.toContain("md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]");
    expect(layout.children).toHaveLength(2);
    expect(classes(layout.children[0])).toContain("md:max-w-2xl");
    expect(classes(layout.children[1])).toContain("md:justify-end");
    expect(layout.children[1].querySelector('[aria-label="control x"]')).not.toBeNull();
  });

  it("a provider sets it for every row inside; a row's own align wins; outside any provider it is the old layout", () => {
    const { container } = render(
      <>
        <SettingsRowAlignProvider align="end">
          <Row id="a" />
          <Row id="b" align="start" />
        </SettingsRowAlignProvider>
        <Row id="c" />
      </>,
    );
    const layouts = [0, 1, 2].map((i) => rowRoot(container, i).firstElementChild!);
    expect(classes(layouts[0])).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(classes(layouts[1])).toContain("md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]");
    expect(classes(layouts[1].children[1])).not.toContain("md:justify-end");
    expect(classes(layouts[2])).toContain("md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]");
    expect(classes(layouts[2].children[0])).toEqual(["min-w-0"]);
  });

  it("works inside a panel, with a divider between rows and none under the title", () => {
    const { container } = render(
      <SettingsRowAlignProvider align="end">
        <SettingsPanel title="Regional">
          <SettingsRow label="Currency">
            <span>USD</span>
          </SettingsRow>
          <SettingsRow label="Distance unit">
            <span>Miles</span>
          </SettingsRow>
        </SettingsPanel>
      </SettingsRowAlignProvider>,
    );
    const rows = container.querySelector("section > .divide-y")!.children;
    expect(rows).toHaveLength(2);
    for (const row of Array.from(rows)) {
      expect(classes(row.firstElementChild)).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    }
    expect(classes(container.querySelector("section h2")!.parentElement)).not.toContain("border-b");
  });
});

/* -------------------------------------------------------------------------- */
/* Regional                                                                    */
/* -------------------------------------------------------------------------- */

describe("Regional: US dollar only, a saved currency kept", () => {
  it("isCurrencySelectable: US dollar always, any other only when it is the saved one", () => {
    expect(SELECTABLE_CURRENCY).toBe("USD");
    const cases: Array<[string, string | null, boolean]> = [
      ["USD", "USD", true],
      ["GBP", "USD", false],
      ["EUR", "USD", false],
      ["GBP", "GBP", true],
      ["EUR", "GBP", false],
      ["USD", "GBP", true],
      ["AED", "AED", true],
      ["GBP", null, false],
      ["USD", null, true],
    ];
    for (const [code, saved, expected] of cases) {
      expect(isCurrencySelectable(code, saved), `${code} with ${saved} saved`).toBe(expected);
    }
  });

  it("names each currency plainly, with its symbol", () => {
    expect(CURRENCY_OPTION_LABELS).toEqual({ USD: "US dollar ($)", GBP: "British pound (£)", EUR: "Euro (€)" });
  });

  const form: GeneralSaveValues = { currency_code: "USD", distance_unit: "miles", privacy_policy_version: "1.0", terms_version: "1.0" };
  const mount = (over: Partial<React.ComponentProps<typeof BusinessRegionalPanel>> = {}) =>
    render(
      <BusinessRegionalPanel
        form={form}
        onFormChange={vi.fn()}
        savedCurrency="USD"
        isDirty={false}
        canEdit
        ready
        onRetryLoad={vi.fn()}
        onSave={vi.fn(async () => {})}
        onDiscard={vi.fn()}
        {...over}
      />,
    );

  /** Opens a ui-v2 Select from the keyboard and lists its options as [label, enabled]. */
  const openOptions = (triggerId: string) => {
    const trigger = document.getElementById(triggerId)!;
    act(() => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });
    return Array.from(document.querySelectorAll('[role="option"]')).map((option) => [
      option.textContent,
      option.getAttribute("data-disabled") === null,
    ]);
  };

  it("both pickers sit at the end of their row, the same width", () => {
    mount();
    for (const id of ["v2_currency_code", "v2_distance_unit"]) {
      const trigger = document.getElementById(id)!;
      expect(classes(trigger), id).toEqual(expect.arrayContaining(["w-44", "max-w-full"]));
      const layout = trigger.parentElement!.parentElement!;
      expect(classes(layout), id).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
      expect(classes(trigger.parentElement), id).toContain("md:justify-end");
    }
  });

  it("says only US dollar can be chosen", () => {
    mount();
    expect(document.body.textContent).toContain("Only US dollar can be chosen for now.");
  });

  it("a US dollar tenant sees every currency, with only US dollar enabled", () => {
    mount();
    expect(openOptions("v2_currency_code")).toEqual([
      ["US dollar ($)", true],
      ["British pound (£)", false],
      ["Euro (€)", false],
    ]);
  });

  it("a tenant saved on pounds keeps pounds pickable beside US dollar; euros stay disabled", () => {
    mount({ form: { ...form, currency_code: "GBP" }, savedCurrency: "GBP" });
    expect(openOptions("v2_currency_code")).toEqual([
      ["US dollar ($)", true],
      ["British pound (£)", true],
      ["Euro (€)", false],
    ]);
  });

  it("a saved currency the list doesn't offer stays listed and pickable, even after trying US dollar", () => {
    mount({ form: { ...form, currency_code: "USD" }, savedCurrency: "AED", isDirty: true });
    expect(openOptions("v2_currency_code")).toEqual([
      ["AED (current)", true],
      ["US dollar ($)", true],
      ["British pound (£)", false],
      ["Euro (€)", false],
    ]);
  });

  it("distance unit: Kilometres, then Miles, both pickable", () => {
    mount();
    expect(openOptions("v2_distance_unit")).toEqual([
      ["Kilometres", true],
      ["Miles", true],
    ]);
  });

  it("shows the tenant's own unit and currency when the shared org settings disagree", () => {
    // The lead's report: Kilometres picked (saved on the tenant), the one
    // org_settings row says miles / USD. Regional must say what Locations says.
    const saved = savedRegionalV2({ currency_code: "GBP", distance_unit: "km" }, { currency_code: "USD", distance_unit: "miles" });
    mount({ form: { ...form, ...saved }, savedCurrency: saved.currency_code });
    expect(document.getElementById("v2_distance_unit")!.textContent).toBe("Kilometres");
    expect(document.getElementById("v2_currency_code")!.textContent).toBe("British pound (£)");
  });
});

/* -------------------------------------------------------------------------- */
/* Regional on the settings page: the tenant's own row, read and written       */
/* -------------------------------------------------------------------------- */

describe("settings page: v2 Regional reads and writes tenants, v1 keeps the settings edge function", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const regional = page.slice(page.indexOf("<BusinessV2.BusinessRegionalPanel"), page.indexOf("case 'driver-requirements':"));
  const leaveSave = page.slice(page.indexOf("const saveAllDirtyForms = useCallback("), page.indexOf("const {\n    isDialogOpen: unsavedDialogOpen,"));
  const v2LeaveGeneral = leaveSave.slice(leaveSave.indexOf("if (v2Chrome) {\n              await BusinessV2.saveGeneralSettingsV2("), leaveSave.indexOf("return;\n            }"));

  it("v2 saves through the tenants writer only, then refreshes the tenant and its cached reads", () => {
    for (const block of [regional, v2LeaveGeneral]) {
      expect(block).toContain("await BusinessV2.saveGeneralSettingsV2({");
      expect(block).toMatch(/\.from\('tenants'\)\.update\(patch as never\)\.eq\('id', tenant\?\.id as string\)\.select\('id'\)/);
      // Never the settings edge function (it writes one unscoped org_settings row).
      expect(block).not.toContain("updateSettingsAsync");
      expect(block).not.toContain("writeOrg");
      expect(block).not.toContain("functions.invoke");
      expect(block).toContain("await refetchTenant();");
      expect(block).toContain("BusinessV2.TENANT_REGIONAL_QUERY_KEYS.forEach(");
    }
  });

  it("v2 reads the saved values tenant-first at every site; v1 keeps its own order", () => {
    // The General panel's saved currency and its discard.
    expect(page).toContain("const v2SavedRegional = BusinessV2.savedRegionalV2(tenant, settings);");
    expect(regional).toContain("...v2SavedRegional,");
    // The page's form sync and dirty check branch on v2 before v1's untouched lines.
    const sync = page.slice(page.indexOf("// Sync general form with loaded settings and tenant context"), page.indexOf("}, [settings, tenant, v2Chrome]);"));
    expect(sync).toMatch(/if \(v2Chrome\) \{\s*setGeneralForm\(\{\s*\.\.\.BusinessV2\.savedRegionalV2\(tenant, settings\),/);
    expect(sync).toContain("currency_code: settings?.currency_code || tenant?.currency_code || 'USD',");
    const dirty = page.slice(page.indexOf("const generalFormDirty = useMemo("), page.indexOf("}, [generalForm, settings, tenant, v2Chrome]);"));
    expect(dirty).toContain("const v2Saved = BusinessV2.savedRegionalV2(tenant, settings);");
    expect(dirty).toContain("generalForm.currency_code !== origCurrency ||");
    const discard = page.slice(page.indexOf("const discardV2PageEdits = () => {"), page.indexOf("const resetV2PageEdits = () => {"));
    expect(discard).toContain("...BusinessV2.savedRegionalV2(tenant, settings),");
  });

  it("v1 still writes org settings through the settings edge function", () => {
    const v1Save = page.slice(page.indexOf("const handleSaveGeneralSettings = async () => {"));
    expect(v1Save).toMatch(/await updateSettingsAsync\(\{\s*currency_code: generalForm\.currency_code,\s*distance_unit: generalForm\.distance_unit,\s*\}\);/);
    // …and the v1 leave-save does too, after the v2 branch has returned.
    expect(leaveSave.slice(leaveSave.indexOf("return;\n            }"))).toContain("await updateSettingsAsync({");
    // updateSettingsAsync is the org-settings mutation, which invokes 'settings'.
    const orgHook = read("hooks/use-org-settings.ts");
    expect(orgHook).toContain("updateSettingsAsync: updateSettingsMutation.mutateAsync,");
    expect(orgHook).toContain("supabase.functions.invoke('settings'");
  });
});

/* -------------------------------------------------------------------------- */
/* Lockbox                                                                     */
/* -------------------------------------------------------------------------- */

describe("Lockbox: Templates is a link to another page, with an arrow", () => {
  const TEMPLATES_HREF = "/settings?tab=templates#settings-lockbox-messages";
  const saved = { lockbox_enabled: true, lockbox_code_length: 6, lockbox_notification_methods: ["email"], lockbox_send_offset_minutes: 45 };

  function Harness({ canEdit = true }: { canEdit?: boolean }) {
    const [f, setF] = useState<Record<string, any>>(() => savedFieldsFor("lockbox", saved));
    return (
      <LockboxPageV2
        form={f}
        setForm={setF as any}
        saved={saved}
        canEdit={canEdit}
        onSave={vi.fn()}
        vehiclesHref="/vehicles"
        templatesHref={TEMPLATES_HREF}
      />
    );
  }

  it("a brand-coloured link reading Templates, with an up-right arrow after it and no button around it", () => {
    render(<Harness />);
    const link = document.querySelector<HTMLAnchorElement>("[data-lockbox-templates]")!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(TEMPLATES_HREF);
    expect(link.textContent).toBe("Templates");
    const arrow = link.querySelector("svg")!;
    expect(arrow).not.toBeNull();
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    // Text first, then the arrow.
    expect(link.lastElementChild).toBe(arrow);
    expect(arrow.getAttribute("class")).toContain("lucide-arrow-up-right");
    expect(classes(link)).toEqual(
      expect.arrayContaining(["text-primary", "hover:underline", "dark:text-[hsl(var(--v2-link,var(--primary)))]"]),
    );
    expect(link.getAttribute("data-slot")).toBeNull();
    expect(link.closest("button")).toBeNull();
    expect(link.className).not.toMatch(/indigo|rounded-(md|sm)\b/);
  });

  it("a view-only user can still follow it (a disabled fieldset never disables a link)", () => {
    render(<Harness canEdit={false} />);
    const link = document.querySelector<HTMLAnchorElement>("[data-lockbox-templates]")!;
    expect(link.closest("fieldset")?.disabled).toBe(true);
    expect(link.matches(":disabled")).toBe(false);
  });

  it("a failed leave-save names the page it is on now", () => {
    const src = read("components/settings-v2/business-rules-pages.tsx");
    // Not the whole call: `leaveSave` also takes the field a refused save
    // focuses, and this is about the words, not the arity.
    expect(src).toContain('leaveSave(codeError, submit, "your lockbox settings"');
    expect(src).not.toContain("your key handover settings");
  });
});

/* -------------------------------------------------------------------------- */
/* The index                                                                   */
/* -------------------------------------------------------------------------- */

describe("the index: the pages that came out of General", () => {
  const business = SETTINGS_INDEX_SECTIONS.find((section) => section.title === "Business")!;
  const pricing = SETTINGS_INDEX_SECTIONS.find((section) => section.title === "Pricing")!;

  it("Business reads General, Branding, Locations / Booking rules, Lockbox / Booking site, Optional modules, Team, Audit Logs", () => {
    expect(business.items.map((item) => item.title)).toEqual([
      "General",
      "Branding",
      "Locations",
      "Booking rules",
      "Lockbox",
      "Booking site",
      "Optional modules",
      "Team",
      // Not one of the pages that came out of General: Audit Logs came off the
      // v2 org menu on Sep 20 2026, when that menu became a plain link to this
      // index. It is pinned in full (entry, href and its `audit_logs` grant) by
      // settings-index-states; it is listed here only so this exact-equality
      // check keeps describing the whole Business group.
      "Audit Logs",
    ]);
  });

  it("Tax and deposit's ENTRY is first under Pricing, not in Business; the page and its aliases are unchanged", () => {
    // Ticket item 1: "fees, tax and deposit become a rule inside Pricing, next
    // to custom pricing". Only the entry moved.
    expect(business.items.map((item) => item.title)).not.toContain("Tax and deposit");
    expect(pricing.items[0].title).toBe("Tax and deposit");
    expect(pricing.items[0].href).toBe("/settings?tab=tax-and-deposit");
  });

  it("each new entry links to its page and follows the permission it had as a section", () => {
    const byTitle = new Map([...business.items, ...pricing.items].map((item) => [item.title, item]));
    // title -> [href, tab, anyOfTabs]
    const expected: Array<[string, string, string, readonly string[] | undefined]> = [
      // General gained the monthly rate (under the `pricing` grant), so it
      // spans three permissions now.
      ["General", "/settings?tab=general", "general", ["general", "requirements", "pricing"]],
      ["Booking rules", "/settings?tab=duration", "duration", undefined],
      ["Lockbox", "/settings?tab=lockbox", "lockbox", undefined],
      ["Booking site", "/settings?tab=booking-site", "general", undefined],
      ["Optional modules", "/settings?tab=modules", "general", undefined],
    ];
    for (const [title, href, tab, anyOf] of expected) {
      const item = byTitle.get(title)!;
      expect(item, title).toBeDefined();
      expect(item.href, title).toBe(href);
      expect(item.tab, title).toBe(tab);
      expect(item.anyOfTabs, title).toEqual(anyOf);
      expect(item.headAdminOnly, title).toBeUndefined();
      expect(item.description.length, title).toBeGreaterThanOrEqual(95);
      expect(item.description.length, title).toBeLessThanOrEqual(120);
    }
    // Tax and deposit is checked the same way from the Pricing group it moved to.
    const tax = byTitle.get("Tax and deposit")!;
    expect([tax.href, tax.tab, tax.anyOfTabs]).toEqual(["/settings?tab=tax-and-deposit", "fees", ["fees", "preauth"]]);
    expect(tax.description.length).toBeGreaterThanOrEqual(95);
    expect(tax.description.length).toBeLessThanOrEqual(120);
  });

  it("General's description is about what it holds now: currency, distance, driver age, ID and the monthly rate", () => {
    const general = business.items.find((item) => item.title === "General")!;
    // The monthly rate is General's third section now, so the description says
    // so. Asserted by substance, not by the exact sentence.
    expect(general.description.toLowerCase()).toContain("currency");
    expect(general.description.toLowerCase()).toContain("distance unit");
    expect(general.description.toLowerCase()).toContain("driver age");
    expect(general.description.toLowerCase()).toContain("monthly rate");
    for (const gone of ["key handover", "deposit", "booking site", "modules", "tax"]) {
      expect(general.description.toLowerCase(), gone).not.toContain(gone);
    }
  });
});
