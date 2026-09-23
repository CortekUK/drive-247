/**
 * v2 Settings → Locations, team lead review of Sep 19 2026 (UI only):
 *   - two sections, "Pickup and delivery" and "Return", headed outside their
 *     panels with a divider under each heading;
 *   - every option row ends in its control; "Add location" sits in the row,
 *     beside the switch, only while the option is on;
 *   - problems are a faded red row (heading and why, then the fix), never a
 *     toast: switching off a side's last option is held on and says so;
 *   - a location's Edit, No fee and Delete are in its table row. No fee opens
 *     the Edit dialog with the fee at 0 and focused, and writes nothing until
 *     that dialog's Save (it moves money, so never on one click);
 *   - the area's price is one row of radios, each opening a dialog, and the
 *     row says what is set;
 *   - every distance follows `tenants.distance_unit` (km or miles), stored in
 *     km as before.
 *
 * Every expected value is worked out by hand in the comment beside it.
 *
 * HARNESS: `react-dom/client` + `act`, same as business-settings-states.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastMock = vi.hoisted(() => vi.fn());
const perms = vi.hoisted(() => ({ edit: true }));
const pickup = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const tenantState = vi.hoisted(() => ({ unit: "miles" as "km" | "miles" }));

vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => perms.edit, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-google-maps-loader", () => ({ useGoogleMapsLoader: () => ({ isLoaded: false }) }));
vi.mock("@/lib/google-places-session", () => ({
  PlacesSessionManager: class {
    getToken() {
      return undefined;
    }
    refreshToken() {}
  },
}));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => undefined }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", currency_code: "USD", distance_unit: tenantState.unit } }),
}));
vi.mock("@/hooks/use-pickup-locations", () => ({ usePickupLocations: () => pickup.value }));

import { LocationSettings } from "@/components/settings/location-settings";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { V2Provider } from "@/lib/v2-context";
import { SettingsPageSaveProvider, SettingsStickySaveBar } from "@/components/settings-v2/settings-kit";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { locationFormFromSettings, locationFeeLabel } from "@/components/settings-v2/business-settings-states";
import {
  addPriceBand,
  buildLocationSettingsPayloadV2,
  describeAreaPrice,
  optionToFocus,
  priceDialogErrors,
  priceDialogPatch,
  setOpenPriceBand,
  startingPriceBands,
  wouldTurnOffLastOption,
} from "@/components/settings-v2/locations-v2";
import { kmToDisplayUnit } from "@/lib/format-utils";

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  toastMock.mockReset();
  perms.edit = true;
  tenantState.unit = "miles";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}" in: ${(scope as HTMLElement).textContent ?? ""}`);
  return found as HTMLButtonElement;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const location = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "l1",
    tenant_id: "t1",
    name: "Airport",
    address: "1 Terminal Rd",
    description: null,
    delivery_fee: 10,
    is_pickup_enabled: true,
    is_return_enabled: false,
    is_active: true,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...over,
  }) as any;

const settingsRow = (over: Record<string, unknown> = {}) =>
  ({
    pickup_location_mode: "custom",
    return_location_mode: "custom",
    fixed_pickup_address: "1 Depot Way",
    fixed_return_address: null,
    pickup_area_radius_km: 40,
    return_area_radius_km: 40,
    area_center_lat: null,
    area_center_lon: null,
    fixed_address_enabled: true,
    multiple_locations_enabled: false,
    area_around_enabled: false,
    area_delivery_fee: 0,
    delivery_tiers_enabled: false,
    delivery_distance_tiers: [],
    delivery_max_distance_km: null,
    pickup_fixed_enabled: true,
    return_fixed_enabled: true,
    pickup_multiple_locations_enabled: false,
    return_multiple_locations_enabled: false,
    pickup_area_enabled: false,
    return_area_enabled: false,
    ...over,
  }) as any;

const hook = (over: Record<string, unknown> = {}) => ({
  locationSettings: settingsRow(),
  isLoadingSettings: false,
  hasSettingsData: true,
  settingsError: null,
  refetchSettings: vi.fn(),
  isFetchingSettings: false,
  settingsUpdateError: null,
  updateSettings: vi.fn(async (_patch: Record<string, unknown>) => ({})),
  isUpdatingSettings: false,
  locations: [],
  isLoadingLocations: false,
  locationsError: null,
  refetchLocations: vi.fn(),
  isFetchingLocations: false,
  createLocation: vi.fn(async () => ({})),
  isCreating: false,
  updateLocation: vi.fn(async (_input: Record<string, unknown>) => ({})),
  isUpdating: false,
  deleteLocation: vi.fn(async () => ({})),
  isDeleting: false,
  ...over,
});

/** The settings page's part in a save: one sticky bar runs every registered save. */
function PageSaveHarness({ children }: { children: (register: RegisterSectionSave) => React.ReactNode }) {
  const saves = useRef<Record<string, () => Promise<unknown>>>({});
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const register = useCallback<RegisterSectionSave>((key, save) => {
    if (save) saves.current[key] = save;
    else delete saves.current[key];
    setDirtyKeys((prev) => (prev.includes(key) === !!save ? prev : save ? [...prev, key] : prev.filter((k) => k !== key)));
  }, []);
  return (
    <SettingsPageSaveProvider>
      {children(register)}
      <SettingsStickySaveBar
        dirty={dirtyKeys.length > 0}
        saving={false}
        error={error}
        onSave={async () => {
          setError(null);
          try {
            for (const save of Object.values(saves.current)) await save();
          } catch (e) {
            setError(e);
          }
        }}
        onReset={() => setError(null)}
      />
    </SettingsPageSaveProvider>
  );
}

const renderPage = () =>
  render(
    <V2Provider flags={{ chrome: true }}>
      <PageSaveHarness>{(register) => <LocationSettings registerSave={register} />}</PageSaveHarness>
    </V2Provider>,
  );

const $ = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = container) =>
  scope.querySelector(selector) as T;
const saveBar = () => $("[data-settings-save-bar]");
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const option = (id: string) => $(`[data-location-option="${id}"]`);

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                  */
/* -------------------------------------------------------------------------- */

describe("pure rules", () => {
  const form = locationFormFromSettings(settingsRow(), (km) => kmToDisplayUnit(km, "miles"));

  it("knows when a switch would leave its side with no option on", () => {
    // Stored defaults: only the address option is on, on both sides.
    expect(wouldTurnOffLastOption(form, "pickupFixed", false)).toBe(true);
    expect(wouldTurnOffLastOption(form, "returnFixed", false)).toBe(true);
    expect(wouldTurnOffLastOption(form, "pickupFixed", true)).toBe(false);
    expect(wouldTurnOffLastOption({ ...form, pickupMultipleEnabled: true }, "pickupFixed", false)).toBe(false);
    // Only Delivery locations on: turning it off is the last one too.
    const listOnly = { ...form, pickupFixedEnabled: false, pickupMultipleEnabled: true };
    expect(wouldTurnOffLastOption(listOnly, "pickupMultiple", false)).toBe(true);
    // The other side never counts.
    expect(wouldTurnOffLastOption({ ...form, returnAreaEnabled: true }, "pickupFixed", false)).toBe(true);
  });

  it("'Choose an option' moves to the side's first option that is off", () => {
    expect(optionToFocus(form, "pickup")).toBe("v2-pickup-multiple");
    expect(optionToFocus({ ...form, returnMultipleEnabled: true }, "return")).toBe("v2-return-area");
    // Every option on: the first one.
    const allOn = { ...form, pickupMultipleEnabled: true, pickupAreaEnabled: true };
    expect(optionToFocus(allOn, "pickup")).toBe("v2-pickup-fixed");
  });

  it("adds a band 10 past the furthest one, before 'Anywhere further', at the one-fee price", () => {
    // Furthest bounded band is 20, so the new one is up to 30, at the 12 fee.
    expect(addPriceBand([{ up_to: 20, fee: 5 }, { up_to: null, fee: 40 }], 12)).toEqual([
      { up_to: 20, fee: 5 },
      { up_to: 30, fee: 12 },
      { up_to: null, fee: 40 },
    ]);
    // No bands and no fee: up to 0 + 10, free.
    expect(addPriceBand([], null)).toEqual([{ up_to: 10, fee: 0 }]);
  });

  it("the 'anywhere further' checkbox adds the open band at the one-fee price, keeps an existing one, and removes it", () => {
    expect(setOpenPriceBand([{ up_to: 20, fee: 5 }], true, 12)).toEqual([
      { up_to: 20, fee: 5 },
      { up_to: null, fee: 12 },
    ]);
    const withOpen = [{ up_to: null, fee: 40 }, { up_to: 20, fee: 5 }];
    expect(setOpenPriceBand(withOpen, true, 12)).toEqual([
      { up_to: 20, fee: 5 },
      { up_to: null, fee: 40 },
    ]);
    expect(setOpenPriceBand(withOpen, false, 12)).toEqual([{ up_to: 20, fee: 5 }]);
  });

  it("starts pricing by distance from two bands, as v1 did", () => {
    // 12 flat: up to 20 at 12, anywhere further at 12 + 25 = 37.
    expect(startingPriceBands([], 12)).toEqual([
      { up_to: 20, fee: 12 },
      { up_to: null, fee: 37 },
    ]);
    expect(startingPriceBands([], null)).toEqual([
      { up_to: 20, fee: 0 },
      { up_to: null, fee: 25 },
    ]);
    const saved = [{ up_to: 5, fee: 1 }];
    const copy = startingPriceBands(saved, 12);
    expect(copy).toEqual(saved);
    expect(copy[0]).not.toBe(saved[0]);
  });

  it("says in the row what the price is, in the tenant's unit", () => {
    const flat = { deliveryTiersEnabled: false, tiers: [], maxDeliveryDistance: null };
    expect(describeAreaPrice({ ...flat, areaDeliveryFee: 25 }, "USD", "km")).toBe("One fee: $25.00");
    // 0 reads "No fee", the words the locations table uses.
    expect(describeAreaPrice({ ...flat, areaDeliveryFee: 0 }, "USD", "km")).toBe("No fee");
    expect(describeAreaPrice({ ...flat, areaDeliveryFee: null }, "USD", "km")).toBe("No fee");
    const tiers = [{ up_to: 10, fee: 5 }, { up_to: 25, fee: 10 }, { up_to: null, fee: 20 }];
    const byDistance = { deliveryTiersEnabled: true, areaDeliveryFee: 0 };
    // A maximum wins over the open band.
    expect(describeAreaPrice({ ...byDistance, tiers, maxDeliveryDistance: 50 }, "USD", "km")).toBe("3 price bands, up to 50 km");
    expect(describeAreaPrice({ ...byDistance, tiers, maxDeliveryDistance: null }, "USD", "mi")).toBe(
      "3 price bands, no distance limit",
    );
    // No maximum and no open band: the furthest band (40) is the limit.
    expect(
      describeAreaPrice({ ...byDistance, tiers: [{ up_to: 40, fee: 9 }, { up_to: 10, fee: 5 }], maxDeliveryDistance: null }, "USD", "mi"),
    ).toBe("2 price bands, up to 40 mi");
    expect(describeAreaPrice({ ...byDistance, tiers: [{ up_to: 10, fee: 5 }], maxDeliveryDistance: null }, "USD", "km")).toBe(
      "1 price band, up to 10 km",
    );
    expect(describeAreaPrice({ ...byDistance, tiers: [], maxDeliveryDistance: null }, "USD", "km")).toBe(
      "Price by distance: no price bands yet",
    );
  });

  it("the price dialogs check only their own fields, with the page's rules and unit", () => {
    const area = { ...form, pickupAreaEnabled: true, areaCenterLat: 51.47, areaCenterLon: -0.45 };
    expect(priceDialogErrors(area, { fee: -1, tiers: [], maxDistance: null }, "flat", "km")).toEqual({
      fee: "Fee can't be negative.",
    });
    // One fee never trips over bands it isn't using.
    expect(priceDialogErrors(area, { fee: 5, tiers: [{ up_to: 0, fee: -1 }], maxDistance: null }, "flat", "km")).toEqual({});
    expect(priceDialogErrors(area, { fee: 5, tiers: [], maxDistance: null }, "distance", "km")).toEqual({
      bands: "Add at least one price band, or choose One fee.",
    });
    // Furthest band 40 km, maximum 30 km: too short.
    expect(
      priceDialogErrors(area, { fee: 5, tiers: [{ up_to: 20, fee: 5 }, { up_to: 40, fee: 9 }], maxDistance: 30 }, "distance", "km"),
    ).toEqual({ maxDistance: "Must be at least your furthest band (40 km)." });
    // A radius or center problem is the page's, not the dialog's.
    expect(priceDialogErrors({ ...area, areaCenterLat: null, areaRadius: 0 }, { fee: 5, tiers: [], maxDistance: null }, "flat", "mi")).toEqual({});
  });

  it("Done writes only the chosen mode's fields", () => {
    const draft = { fee: 7, tiers: [{ up_to: 20, fee: 5 }], maxDistance: 60 };
    expect(priceDialogPatch("flat", draft)).toEqual({ deliveryTiersEnabled: false, areaDeliveryFee: 7 });
    expect(priceDialogPatch("distance", draft)).toEqual({
      deliveryTiersEnabled: true,
      tiers: [{ up_to: 20, fee: 5 }],
      maxDeliveryDistance: 60,
    });
    expect(locationFeeLabel(0, "USD")).toBe("No fee");
    expect(locationFeeLabel("12.5", "USD")).toBe("$12.50");
  });
});

/* -------------------------------------------------------------------------- */
/* The save payload: untouched distances keep their stored km                  */
/* -------------------------------------------------------------------------- */

describe("buildLocationSettingsPayloadV2: no drift on a miles save", () => {
  // Every value below is one the audit found drifting by 0.1 km a save.
  const stored = settingsRow({
    pickup_area_enabled: true,
    return_area_enabled: true,
    area_center_lat: 51.47,
    area_center_lon: -0.45,
    pickup_area_radius_km: 40,
    return_area_radius_km: 50,
    delivery_tiers_enabled: true,
    delivery_distance_tiers: [
      { up_to_km: 25, fee: 5 },
      { up_to_km: 30, fee: 9 },
      { up_to_km: null, fee: 20 },
    ],
    delivery_max_distance_km: 100,
  });
  const miles = (km: number) => kmToDisplayUnit(km, "miles");
  const form = locationFormFromSettings(stored, miles);

  it("shows each stored distance in miles, rounded to 0.1", () => {
    // 40 x 0.621371 = 24.85484 -> 24.9;  50 x 0.621371 = 31.06855 -> 31.1;
    // 25 x 0.621371 = 15.534275 -> 15.5; 30 x 0.621371 = 18.64113 -> 18.6;
    // 100 x 0.621371 = 62.1371 -> 62.1.
    expect([form.areaRadius, form.returnAreaRadius, form.tiers[0].up_to, form.tiers[1].up_to, form.maxDeliveryDistance]).toEqual([
      24.9, 31.1, 15.5, 18.6, 62.1,
    ]);
  });

  it("an untouched save writes every stored km back exactly (40 stays 40, 50 stays 50)", () => {
    const payload = buildLocationSettingsPayloadV2(form, "miles", stored);
    expect(payload.pickup_area_radius_km).toBe(40);
    expect(payload.return_area_radius_km).toBe(50);
    expect(payload.delivery_distance_tiers).toEqual([
      { up_to_km: 25, fee: 5 },
      { up_to_km: 30, fee: 9 },
      { up_to_km: null, fee: 20 },
    ]);
    expect(payload.delivery_max_distance_km).toBe(100);
  });

  it("without what is stored, converting back drifts (the bug this guards)", () => {
    // 24.9 / 0.621371 = 40.0727 -> 40.1;  31.1 / 0.621371 = 50.0506 -> 50.1;
    // 15.5 / 0.621371 = 24.9448 -> 24.9;  18.6 / 0.621371 = 29.9338 -> 29.9;
    // 62.1 / 0.621371 = 99.9403 -> 99.9.
    const payload = buildLocationSettingsPayloadV2(form, "miles");
    expect(payload.pickup_area_radius_km).toBe(40.1);
    expect(payload.return_area_radius_km).toBe(50.1);
    expect(payload.delivery_distance_tiers!.map((t) => t.up_to_km)).toEqual([24.9, 29.9, null]);
    expect(payload.delivery_max_distance_km).toBe(99.9);
  });

  it("an edited distance is converted: 25 mi saves as 40.2 km, the rest stay as stored", () => {
    // 25 / 0.621371 = 40.2336 -> 40.2.
    const payload = buildLocationSettingsPayloadV2({ ...form, areaRadius: 25 }, "miles", stored);
    expect(payload.pickup_area_radius_km).toBe(40.2);
    expect(payload.return_area_radius_km).toBe(50);
    expect(payload.delivery_max_distance_km).toBe(100);
  });

  it("removing a band leaves the bands after it on their stored km", () => {
    // The 25 km band (15.5 mi) is removed; 18.6 mi is still the stored 30 km.
    const payload = buildLocationSettingsPayloadV2({ ...form, tiers: form.tiers.slice(1) }, "miles", stored);
    expect(payload.delivery_distance_tiers).toEqual([
      { up_to_km: 30, fee: 9 },
      { up_to_km: null, fee: 20 },
    ]);
  });

  it("km: shown as stored and written as typed", () => {
    const kmForm = locationFormFromSettings(stored, (km) => kmToDisplayUnit(km, "km"));
    expect(buildLocationSettingsPayloadV2(kmForm, "km", stored)).toMatchObject({
      pickup_area_radius_km: 40,
      return_area_radius_km: 50,
      delivery_max_distance_km: 100,
    });
    expect(buildLocationSettingsPayloadV2({ ...kmForm, areaRadius: 25 }, "km", stored).pickup_area_radius_km).toBe(25);
  });
});

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

describe("v2 Locations page", () => {
  it("two sections, each headed outside its panel with its line of help and a divider under the heading", () => {
    pickup.value = hook();
    renderPage();
    const sections = Array.from(container.querySelectorAll("[data-location-section]"));
    expect(sections.map((s) => s.querySelector("h2")?.textContent)).toEqual(["Pickup and delivery", "Return"]);
    sections.forEach((section) => {
      const heading = section.querySelector("h2")!;
      // Not inside a panel — and the panel under it draws no box either, so
      // the heading, its divider and every option row share one left edge.
      expect(heading.closest("[data-settings-rows]")).toBeNull();
      const panel = section.querySelector("[data-settings-rows]")!.parentElement!;
      for (const chrome of ["rounded-xl", "bg-card", "px-5", "divide-y"]) {
        expect(panel.className).not.toContain(chrome);
      }
      expect(heading.parentElement!.className.split(/\s+/)).toContain("border-b");
    });
    // The heading pair is set like the kit's `SettingsSection` (settings-kit),
    // which is the 14px section description — not the 13px one, which belongs
    // to a PANEL's description, and these headings sit outside their panels.
    for (const section of sections) {
      expect(section.querySelector("h2 + p")!.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["text-sm", "text-muted-foreground"]),
      );
      expect(section.querySelector("h2 + p")!.className).not.toContain("text-[13px]");
    }
    expect(sections[0].querySelector("h2 + p")?.textContent).toBe("How customers get the car.");
    expect(sections[1].querySelector("h2 + p")?.textContent).toBe("How customers bring the car back.");
    // Collection locations are called Return locations now.
    expect(option("v2-return-multiple").textContent).toContain("Return locations");
    expect(container.textContent).not.toContain("Collection locations");
  });

  it("each option row ends in its switch, and Add location joins it only while the option is on", () => {
    const h = hook({ locations: [location()] });
    pickup.value = h;
    renderPage();
    const row = option("v2-pickup-multiple");
    const controls = () => $("#v2-pickup-multiple", row).parentElement as HTMLElement;
    // The controls column sits at the end of the row.
    expect(controls().className).toContain("md:justify-end");
    expect(row.textContent).not.toContain("Add location");

    act(() => $<HTMLButtonElement>("#v2-pickup-multiple").click());
    const buttons = Array.from(controls().children).map((el) => el.textContent || el.getAttribute("role"));
    expect(buttons).toEqual(["Add location", "switch"]);
    // The table under it has no Add button of its own.
    expect($('table[aria-label="Delivery locations"]', row).textContent).not.toContain("Add location");

    act(() => buttonByText("Add location", controls()).click());
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Add delivery location");
  });

  it("Return's Add location opens 'Add return location'", () => {
    pickup.value = hook({ locationSettings: settingsRow({ return_multiple_locations_enabled: true }) });
    renderPage();
    act(() => buttonByText("Add location", option("v2-return-multiple")).click());
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Add return location");
    expect(dialog()!.textContent).toContain("Return fee");
  });

  it("switching off a side's last option keeps it on and says so in a faded red row with the fix, not a toast", () => {
    pickup.value = hook();
    renderPage();
    act(() => $<HTMLButtonElement>("#v2-pickup-fixed").click());
    expect($("#v2-pickup-fixed").getAttribute("aria-checked")).toBe("true");
    expect(toastMock).not.toHaveBeenCalled();

    const notice = $('[data-location-section="v2-locations-pickup"] [data-location-notice]');
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("At least one pickup option must be on");
    expect(notice.textContent).toContain(
      "Customers need a way to get the car. Turn on another option first, then turn this one off.",
    );
    // Toned down: a 10% tint and the contrast-corrected ink, never solid red.
    const tint = notice.className.split(/\s+/);
    expect(tint).toEqual(expect.arrayContaining(["rounded-xl", "bg-destructive/10"]));
    expect(tint).not.toContain("bg-destructive");
    expect(notice.querySelector("p")!.className).toContain("panel-ink-danger");
    // Return is untouched.
    expect($('[data-location-section="v2-locations-return"] [data-location-notice]')).toBeNull();

    // The fix: go to the first option that is off.
    act(() => buttonByText("Choose an option", notice).click());
    expect(document.activeElement?.id).toBe("v2-pickup-multiple");
    // Turning another one on clears the row, and then the first can go off.
    act(() => $<HTMLButtonElement>("#v2-pickup-multiple").click());
    expect($('[data-location-section="v2-locations-pickup"] [data-location-notice]')).toBeNull();
    act(() => $<HTMLButtonElement>("#v2-pickup-fixed").click());
    expect($("#v2-pickup-fixed").getAttribute("aria-checked")).toBe("false");
  });

  it("the last option held on is never swapped for the address option (v1 did that silently)", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_fixed_enabled: false, pickup_multiple_locations_enabled: true }),
      locations: [location()],
    });
    renderPage();
    act(() => $<HTMLButtonElement>("#v2-pickup-multiple").click());
    expect($("#v2-pickup-multiple").getAttribute("aria-checked")).toBe("true");
    expect($("#v2-pickup-fixed").getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("At least one pickup option must be on");
  });

  it("No fee opens the Edit dialog with the fee at 0 and focused, and writes nothing until its Save", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", delivery_fee: 15 })],
    });
    pickup.value = h;
    renderPage();
    const noFee = () => $<HTMLButtonElement>('button[aria-label="Set no fee for Airport"]');
    act(() => noFee().click());
    const d = dialog()!;
    expect(d.querySelector("h2")?.textContent).toBe("Edit delivery location");
    expect(d.textContent).toContain("The fee is set to 0. Nothing changes until you press Save.");
    const fee = $<HTMLInputElement>("#v2-location-fee", d);
    expect(fee.value).toBe("0");
    expect(document.activeElement).toBe(fee);
    // One click moved no money.
    expect(h.updateLocation).not.toHaveBeenCalled();

    // Cancel: still nothing written.
    act(() => buttonByText("Cancel", d).click());
    expect(dialog()).toBeNull();
    expect(h.updateLocation).not.toHaveBeenCalled();

    // Again, then Save: the Edit dialog's own update, with the fee at 0. From
    // the fixture: name "Airport", address "1 Terminal Rd", description null
    // (sent as null), and Available to customers unchanged (so not sent).
    act(() => noFee().click());
    await act(async () => buttonByText("Save", dialog()!).click());
    expect(h.updateLocation).toHaveBeenCalledTimes(1);
    expect(h.updateLocation).toHaveBeenCalledWith({
      id: "l1",
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 0,
    });
    expect(h.updateSettings).not.toHaveBeenCalled();
    // A location's own write never makes the page unsaved.
    expect(buttonByText("Save changes", saveBar()).disabled).toBe(true);
  });

  it("Edit still opens at the stored fee (only No fee starts at 0)", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", delivery_fee: 15 })],
    });
    renderPage();
    act(() => $<HTMLButtonElement>('button[aria-label="Edit Airport"]').click());
    expect($<HTMLInputElement>("#v2-location-fee", dialog()!).value).toBe("15");
    expect(dialog()!.textContent).toContain("Changes save as soon as you press Save.");
  });

  it.each([
    ["a location write", { isUpdating: true }],
    ["the list's read after one", { isFetchingLocations: true }],
  ])("No fee waits while %s is running", (_what, busy) => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", delivery_fee: 15 })],
      ...busy,
    });
    renderPage();
    const noFee = $<HTMLButtonElement>('button[aria-label="Set no fee for Airport"]');
    expect(noFee.disabled).toBe(true);
    act(() => noFee.click());
    expect(dialog()).toBeNull();
  });

  it("the held-on notice goes once anything else on the page changes", () => {
    pickup.value = hook();
    renderPage();
    act(() => $<HTMLButtonElement>("#v2-pickup-fixed").click());
    expect(container.textContent).toContain("At least one pickup option must be on");
    act(() => $<HTMLButtonElement>("#v2-return-same-address").click());
    expect(container.textContent).not.toContain("At least one pickup option must be on");
  });

  it("the held-on notice goes after a save, even when the save changed only the other side", async () => {
    const h = hook({
      locations: [location({ id: "r1", name: "Harbour", is_pickup_enabled: false, is_return_enabled: true })],
    });
    pickup.value = h;
    renderPage();
    act(() => $<HTMLButtonElement>("#v2-pickup-fixed").click());
    // Return's option is a different side: Pickup's notice stays.
    act(() => $<HTMLButtonElement>("#v2-return-multiple").click());
    expect(container.textContent).toContain("At least one pickup option must be on");
    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("At least one pickup option must be on");
  });

  it("One fee says what it is charged for: collections too only while Collect within an area is on", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_area_enabled: true, area_center_lat: 51.47, area_center_lon: -0.45 }),
    });
    renderPage();
    const openFee = () => act(() => $<HTMLButtonElement>('button[aria-label="Edit delivery price"]').click());
    openFee();
    expect(dialog()!.textContent).toContain("One price for every address in the area, charged for each delivery.");
    act(() => buttonByText("Cancel", dialog()!).click());

    act(() => $<HTMLButtonElement>("#v2-return-area").click());
    openFee();
    expect(dialog()!.textContent).toContain(
      "One price for every address in the area, charged for each delivery and each collection.",
    );
  });

  it("a field's problem is a compact faded-red note, and the radius box is outlined in the faded red", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_area_enabled: true, area_center_lat: 51.47, area_center_lon: -0.45 }),
    });
    renderPage();
    act(() => typeInto($<HTMLInputElement>("#v2-pickup-area-radius"), "0"));
    const note = option("v2-pickup-area").querySelector("[data-location-issue]") as HTMLElement;
    expect(note.getAttribute("role")).toBe("alert");
    expect(note.textContent).toBe("Radius must be at least 1 mi.");
    const tint = note.className.split(/\s+/);
    expect(tint).toEqual(expect.arrayContaining(["rounded-xl", "bg-destructive/10", "px-3", "py-2"]));
    expect(tint).not.toContain("bg-destructive");
    expect(note.querySelector("p")!.className.split(/\s+/)).toContain("panel-ink-danger");
    const radius = $<HTMLInputElement>("#v2-pickup-area-radius");
    expect(radius.getAttribute("aria-invalid")).toBe("true");
    const cls = radius.className.split(/\s+/);
    expect(cls).toContain("aria-[invalid=true]:border-destructive/40");
    // The full-strength border from the ui-v2 Input is replaced, not stacked.
    expect(cls).not.toContain("aria-[invalid=true]:border-destructive");
  });

  it("a refused save says what is missing in the same note under the row", async () => {
    const h = hook({ locationSettings: settingsRow({ fixed_pickup_address: "" }) });
    pickup.value = h;
    renderPage();
    // Any edit, so the page has something to save.
    act(() => $<HTMLButtonElement>("#v2-return-same-address").click());
    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings).not.toHaveBeenCalled();
    const note = option("v2-pickup-fixed").querySelector("[data-location-issue]") as HTMLElement;
    expect(note.textContent).toBe("Enter your pickup address.");
    expect(note.className.split(/\s+/)).toContain("bg-destructive/10");
  });

  it("a stored price problem is a note on the price row whose fix opens the price dialog", () => {
    pickup.value = hook({
      locationSettings: settingsRow({
        pickup_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
        area_delivery_fee: -5,
      }),
    });
    renderPage();
    const note = option("v2-pickup-area").querySelector("[data-location-issue]") as HTMLElement;
    expect(note.textContent).toBe("Fee can't be negative.Edit price");
    act(() => buttonByText("Edit price", note).click());
    expect(dialog()!.querySelector("h2")?.textContent).toBe("One fee");
  });

  it("Center point says what it means", () => {
    pickup.value = hook({ locationSettings: settingsRow({ pickup_area_enabled: true }) });
    renderPage();
    expect(option("v2-pickup-area").textContent).toContain(
      "Center pointThe address distances are measured from, usually your shop.",
    );
  });

  it("a price dialog changes nothing on Cancel, holds a bad value on Done, and Edit reopens the chosen one", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_area_enabled: true, area_center_lat: 51.47, area_center_lon: -0.45, area_delivery_fee: 12 }),
    });
    pickup.value = h;
    renderPage();
    const summary = () => $("[data-area-price-summary]").textContent;
    const radios = () => Array.from(container.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];

    act(() => radios()[1].click());
    act(() => buttonByText("Cancel", dialog()!).click());
    expect(dialog()).toBeNull();
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
    expect(summary()).toBe("One fee: $12.00");
    expect(buttonByText("Save changes", saveBar()).disabled).toBe(true);

    // Edit opens the mode that is chosen, starting from the form's fee.
    act(() => $<HTMLButtonElement>('button[aria-label="Edit delivery price"]').click());
    expect(dialog()!.querySelector("h2")?.textContent).toBe("One fee");
    const fee = $<HTMLInputElement>("#v2-area-fee", dialog()!);
    expect(fee.value).toBe("12");
    act(() => typeInto(fee, "-3"));
    act(() => buttonByText("Done", dialog()!).click());
    // Still open, and it says why in the toned-down red.
    expect(dialog()).not.toBeNull();
    const alert = dialog()!.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe("Fee can't be negative.");
    expect(alert.className).toContain("panel-ink-danger");

    act(() => typeInto(fee, "30"));
    act(() => buttonByText("Done", dialog()!).click());
    expect(dialog()).toBeNull();
    expect(summary()).toBe("One fee: $30.00");

    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({ area_delivery_fee: 30, delivery_tiers_enabled: false });
  });

  it("view-only: no actions, no Edit on the price, radios locked", () => {
    perms.edit = false;
    pickup.value = hook({
      locationSettings: settingsRow({
        pickup_multiple_locations_enabled: true,
        pickup_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
      }),
      locations: [location()],
    });
    render(
      <V2Provider flags={{ chrome: true }}>
        <LocationSettings />
      </V2Provider>,
    );
    expect(container.textContent).not.toContain("Add location");
    expect($('button[aria-label="Edit delivery price"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('[role="radio"]')).every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    expect($("table").querySelectorAll("button")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Distance unit                                                               */
/* -------------------------------------------------------------------------- */

describe("every distance follows the tenant's unit", () => {
  const areaRow = settingsRow({
    pickup_area_enabled: true,
    area_center_lat: 51.47,
    area_center_lon: -0.45,
    pickup_area_radius_km: 40,
    delivery_tiers_enabled: true,
    delivery_distance_tiers: [
      { up_to_km: 20, fee: 5 },
      { up_to_km: null, fee: 30 },
    ],
    delivery_max_distance_km: 50,
  });

  const radiusRow = () => option("v2-pickup-area");

  it("km: shown and typed in km, saved in km unchanged (40 km stays 40)", async () => {
    tenantState.unit = "km";
    const h = hook({ locationSettings: areaRow });
    pickup.value = h;
    renderPage();
    expect($<HTMLInputElement>("#v2-pickup-area-radius").value).toBe("40");
    expect(radiusRow().textContent).toContain("How far from your center point you deliver, in km.");
    expect(($("#v2-pickup-area-radius").nextElementSibling as HTMLElement).textContent).toBe("km");
    // Max 50 km, shown as stored.
    expect($("[data-area-price-summary]").textContent).toBe("2 price bands, up to 50 km");
    expect(container.textContent).not.toMatch(/\bmi\b|miles/);

    act(() => typeInto($<HTMLInputElement>("#v2-pickup-area-radius"), "0"));
    expect(container.textContent).toContain("Radius must be at least 1 km.");
    act(() => typeInto($<HTMLInputElement>("#v2-pickup-area-radius"), "25"));
    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({
      pickup_area_radius_km: 25,
      return_area_radius_km: 40,
      delivery_distance_tiers: [
        { up_to_km: 20, fee: 5 },
        { up_to_km: null, fee: 30 },
      ],
      delivery_max_distance_km: 50,
    });
  });

  it("km: the band editor and maximum distance are in km too", () => {
    tenantState.unit = "km";
    pickup.value = hook({ locationSettings: areaRow });
    renderPage();
    act(() => $<HTMLButtonElement>('button[aria-label="Edit delivery price"]').click());
    const d = dialog()!;
    expect(d.textContent).toContain("Distances are in km.");
    expect($<HTMLInputElement>('input[aria-label="Band 1 distance"]', d).value).toBe("20");
    expect(d.querySelector('input[aria-label="Up to 20 km fee"]')).not.toBeNull();
    expect(($("#v2-area-max-distance", d).nextElementSibling as HTMLElement).textContent).toBe("km");
  });

  it("miles: shown and typed in miles, saved back in km (25 mi -> 40.2 km)", async () => {
    tenantState.unit = "miles";
    const h = hook({ locationSettings: areaRow });
    pickup.value = h;
    renderPage();
    // 40 km x 0.621371 = 24.85484 -> 24.9 mi.
    expect($<HTMLInputElement>("#v2-pickup-area-radius").value).toBe("24.9");
    expect(radiusRow().textContent).toContain("How far from your center point you deliver, in miles.");
    expect(($("#v2-pickup-area-radius").nextElementSibling as HTMLElement).textContent).toBe("mi");
    // 50 km x 0.621371 = 31.06855 -> 31.1 mi.
    expect($("[data-area-price-summary]").textContent).toBe("2 price bands, up to 31.1 mi");

    act(() => typeInto($<HTMLInputElement>("#v2-pickup-area-radius"), "0"));
    expect(container.textContent).toContain("Radius must be at least 1 mi.");
    act(() => typeInto($<HTMLInputElement>("#v2-pickup-area-radius"), "25"));
    await act(async () => buttonByText("Save changes", saveBar()).click());
    // 25 / 0.621371 = 40.2336 -> 40.2 km. Everything not touched goes back as
    // stored: the 20 km band (12.4 mi), Return's 40 km radius (24.9 mi, which
    // converted would be 40.1) and the 50 km maximum (31.1 mi, converted 50.1).
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({
      pickup_area_radius_km: 40.2,
      return_area_radius_km: 40,
      delivery_distance_tiers: [
        { up_to_km: 20, fee: 5 },
        { up_to_km: null, fee: 30 },
      ],
      delivery_max_distance_km: 50,
    });
  });

  it.each([
    // 30 km stored: km shows 30; miles 30 x 0.621371 = 18.64113 -> 18.6.
    ["km" as const, "30", "km", "km"],
    ["miles" as const, "18.6", "miles", "mi"],
  ])("%s: Return's own radius is shown, described and suffixed in the tenant's unit", (unit, shown, long, short) => {
    tenantState.unit = unit;
    pickup.value = hook({
      locationSettings: settingsRow({
        return_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
        return_area_radius_km: 30,
      }),
    });
    renderPage();
    const input = $<HTMLInputElement>("#v2-return-area-radius");
    expect(input.value).toBe(shown);
    expect(option("v2-return-area").textContent).toContain(`How far from your center point you collect, in ${long}.`);
    expect((input.nextElementSibling as HTMLElement).textContent).toBe(short);
  });

  it.each([
    // Stored 60 km. km: 60 > 50, the limit floor(50) = 50.
    ["km" as const, "For the most accurate address suggestions, keep this under 50 km."],
    // miles: 60 x 0.621371 = 37.28226 -> 37.3 mi; the limit is floor(50 x 0.621371 = 31.06855 -> 31.1) = 31.
    ["miles" as const, "For the most accurate address suggestions, keep this under 31 mi."],
  ])("%s: the address-suggestion hint gives its limit in the tenant's unit, in the toned-down amber", (unit, hint) => {
    tenantState.unit = unit;
    pickup.value = hook({
      locationSettings: settingsRow({
        pickup_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
        pickup_area_radius_km: 60,
      }),
    });
    renderPage();
    const row = option("v2-pickup-area");
    const note = Array.from(row.querySelectorAll("p")).find((p) => p.textContent?.startsWith("For the most accurate")) as HTMLElement;
    expect(note.textContent).toBe(`${hint} Above that, suggestions are filtered by distance instead.`);
    expect(note.className.split(/\s+/)).toContain("panel-ink-warn");
    expect(note.className).not.toMatch(/amber/);
  });

  it("miles: the band editor says miles", () => {
    tenantState.unit = "miles";
    pickup.value = hook({ locationSettings: areaRow });
    renderPage();
    act(() => $<HTMLButtonElement>('button[aria-label="Edit delivery price"]').click());
    const d = dialog()!;
    expect(d.textContent).toContain("Distances are in miles.");
    // 20 km -> 12.4 mi.
    expect($<HTMLInputElement>('input[aria-label="Band 1 distance"]', d).value).toBe("12.4");
    expect(d.querySelector('input[aria-label="Up to 12.4 mi fee"]')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Markup rules                                                                */
/* -------------------------------------------------------------------------- */

describe("v2 markup rules on the Locations files", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const locationsPage = strip(read("components/settings-v2/locations-v2.tsx"));
  const shared = strip(read("components/settings-v2/business-settings-states.tsx"));
  const listPart = shared.slice(shared.indexOf("export interface LocationsListV2Props"));

  it.each([
    ["locations-v2.tsx", locationsPage],
    ["the locations list", listPart],
  ])("%s: rounded system, brand-driven colour, no serif, no grey hover", (_name, src) => {
    expect(src).not.toMatch(/\brounded-(md|sm)\b/);
    expect(src).not.toMatch(/indigo-|#[0-9a-fA-F]{6}\b/);
    expect(src).not.toMatch(/\bfont-sans\b/);
    expect(src).not.toMatch(/(^|[\s"'`])hover:bg-(muted|accent|white|gray)/);
  });

  it("locations-v2.tsx: warnings use the contrast-corrected ink, never a hardcoded amber", () => {
    expect(locationsPage).not.toMatch(/amber-\d/);
    expect(locationsPage).toContain('const HINT_WARN = "panel-ink-warn";');
  });

  it("the v2 address hint is rounded like its menu", () => {
    function Controlled() {
      const [value, setValue] = useState("");
      return <LocationAutocomplete value={value} onChange={(v) => setValue(v)} v2States />;
    }
    vi.useFakeTimers();
    render(<Controlled />);
    act(() => typeInto(container.querySelector("input")!, "12 King Street"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const hint = container.querySelector('[role="status"]') as HTMLElement;
    expect(hint.textContent).toBe("Address suggestions aren't available right now. Type the full address.");
    const classes = hint.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["rounded-xl", "border", "border-border"]));
    expect(classes).not.toContain("rounded-2xl");
  });
});

/* -------------------------------------------------------------------------- */
/* A refused save takes the operator to the field                              */
/* -------------------------------------------------------------------------- */

/**
 * Team lead, Sep 20 2026: Save changes was refused with "Enter your pickup
 * address" while that field was scrolled far off the top of the page, so the
 * toast named somewhere he could not see. Every reason `locationSaveIssueV2`
 * can give now carries the id of its own control; the page's save bar focuses
 * it, scrolls it into view, and the reason is written beside it as well as in
 * the bar.
 *
 * jsdom has no scrollIntoView, so it is stubbed here and read back.
 */
describe("a refused save takes the operator to the field", () => {
  let scrolled: { id: string; options: unknown }[];
  const hadScroll = "scrollIntoView" in Element.prototype;
  const realScroll = Element.prototype.scrollIntoView;

  beforeEach(() => {
    // Every distance in km, so a message's number is the stored one.
    tenantState.unit = "km";
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
      scrolled.push({ id: this.id, options });
    } as typeof realScroll;
  });

  afterEach(() => {
    if (hadScroll) Element.prototype.scrollIntoView = realScroll;
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  /** A stored return address equal to the pickup one: the Same-as switch is on. */
  const sameAddress = (over: Record<string, unknown> = {}) =>
    settingsRow({ fixed_return_address: "1 Depot Way", ...over });
  /** An area with a saved center point, so only the reason under test is left. */
  const withCenter = (over: Record<string, unknown> = {}) =>
    sameAddress({ area_center_lat: 51.47, area_center_lon: -0.45, ...over });

  /** Flips Same as pickup address: an edit that changes nothing else. */
  const toggleSameAddress = () => act(() => $<HTMLButtonElement>("#v2-return-same-address").click());
  const flip = (id: string) => () => act(() => $<HTMLButtonElement>(id).click());
  const typeIn = (id: string, value: string) => () => act(() => typeInto($<HTMLInputElement>(id), value));

  const notes = () =>
    Array.from(container.querySelectorAll("[data-location-issue], [data-location-notice]")).map(
      (n) => n.textContent ?? "",
    );

  const cases: {
    reason: string;
    settings: Record<string, unknown>;
    edit: () => void;
    /** The control the operator lands on. */
    field: string;
    /** What the row beside it says. */
    note: string;
  }[] = [
    {
      reason: "no pickup option is on",
      settings: sameAddress({ pickup_fixed_enabled: false, pickup_multiple_locations_enabled: false, pickup_area_enabled: false }),
      edit: toggleSameAddress,
      // Every pickup option is off, so "the first one that is off" is the first.
      field: "v2-pickup-fixed",
      note: "Turn on a pickup option",
    },
    {
      reason: "no return option is on",
      settings: settingsRow({ return_fixed_enabled: false, return_multiple_locations_enabled: false, return_area_enabled: false }),
      edit: flip("#v2-pickup-multiple"),
      field: "v2-return-fixed",
      note: "Turn on a return option",
    },
    {
      reason: "the pickup address is missing",
      settings: settingsRow({ fixed_pickup_address: "" }),
      edit: toggleSameAddress,
      field: "v2-pickup-address",
      note: "Enter your pickup address.",
    },
    {
      reason: "the return address is missing",
      settings: settingsRow(),
      edit: toggleSameAddress,
      field: "v2-return-address",
      note: "Enter your return address.",
    },
    {
      reason: "the delivery list has nothing customers can choose",
      settings: sameAddress(),
      edit: flip("#v2-pickup-multiple"),
      field: "v2-pickup-add-location",
      note: "Add a delivery location",
    },
    {
      reason: "the return list has nothing customers can choose",
      settings: sameAddress(),
      edit: flip("#v2-return-multiple"),
      field: "v2-return-add-location",
      note: "Add a return location",
    },
    {
      reason: "the center point is not set",
      settings: sameAddress(),
      edit: flip("#v2-pickup-area"),
      field: "v2-area-center",
      note: "Pick a center point from the address suggestions.",
    },
    {
      reason: "the pickup radius is below 1",
      settings: withCenter({ pickup_area_enabled: true }),
      edit: typeIn("#v2-pickup-area-radius", "0"),
      field: "v2-pickup-area-radius",
      note: "Radius must be at least 1 km.",
    },
    {
      reason: "the return radius is below 1",
      // Pickup's area is off, so Return owns the center point and the price.
      settings: withCenter({ return_area_enabled: true }),
      edit: typeIn("#v2-return-area-radius", "0"),
      field: "v2-return-area-radius",
      note: "Radius must be at least 1 km.",
    },
    {
      reason: "the one fee is negative",
      settings: withCenter({ pickup_area_enabled: true, area_delivery_fee: -5 }),
      edit: toggleSameAddress,
      field: "v2-pickup-price-fix",
      note: "Fee can't be negative.",
    },
    {
      reason: "pricing by distance has no bands left",
      settings: withCenter({ pickup_area_enabled: true, delivery_tiers_enabled: true, delivery_distance_tiers: [] }),
      edit: toggleSameAddress,
      field: "v2-pickup-price-fix",
      note: "Add at least one price band, or choose One fee.",
    },
    {
      reason: "a price band is negative",
      settings: withCenter({
        pickup_area_enabled: true,
        delivery_tiers_enabled: true,
        delivery_distance_tiers: [{ up_to_km: 10, fee: -5 }],
      }),
      edit: toggleSameAddress,
      field: "v2-pickup-price-fix",
      note: 'Price band "Up to 10 km": Fee can\'t be negative.',
    },
    {
      reason: "the maximum distance stops short of the furthest band",
      settings: withCenter({
        pickup_area_enabled: true,
        delivery_tiers_enabled: true,
        delivery_distance_tiers: [{ up_to_km: 10, fee: 5 }],
        delivery_max_distance_km: 5,
      }),
      edit: toggleSameAddress,
      field: "v2-pickup-price-fix",
      // 10 is the furthest band, so 5 is short of it.
      note: "Must be at least your furthest band (10 km).",
    },
  ];

  it.each(cases)("$reason: lands on $field, with the reason beside it", async (c) => {
    const h = hook({ locationSettings: c.settings });
    pickup.value = h;
    renderPage();
    c.edit();
    await act(async () => buttonByText("Save changes", saveBar()).click());

    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe(c.field);
    expect(scrolled).toEqual([{ id: c.field, options: { behavior: "smooth", block: "center" } }]);
    expect(notes().some((text) => text.includes(c.note))).toBe(true);
  });

  it("the save bar keeps its own summary line", async () => {
    pickup.value = hook({ locationSettings: settingsRow({ fixed_pickup_address: "" }) });
    renderPage();
    toggleSameAddress();
    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(saveBar().querySelector('[data-settings-state="save-error"]')!.textContent).toContain(
      "Enter your pickup address.",
    );
  });

  it("asked for less motion, the jump is instant", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query.includes("prefers-reduced-motion"),
    })) as typeof window.matchMedia;
    try {
      pickup.value = hook({ locationSettings: settingsRow({ fixed_pickup_address: "" }) });
      renderPage();
      toggleSameAddress();
      await act(async () => buttonByText("Save changes", saveBar()).click());
      expect(scrolled).toEqual([{ id: "v2-pickup-address", options: { behavior: "auto", block: "center" } }]);
    } finally {
      window.matchMedia = real;
    }
  });

  it("a save that goes through moves nothing and focuses nothing", async () => {
    const h = hook({ locationSettings: settingsRow({ fixed_return_address: "1 Depot Way" }) });
    pickup.value = h;
    renderPage();
    toggleSameAddress();
    await act(async () => buttonByText("Save changes", saveBar()).click());

    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    expect(scrolled).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });
});
