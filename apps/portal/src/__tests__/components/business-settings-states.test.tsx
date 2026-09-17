/**
 * v2 Settings → Business (General, Locations, Appearance) states.
 *
 * Pins the rules the northwind pages rely on, with hand-worked expectations:
 *   - a placeholder read is never the tenant's configuration,
 *   - a zero-row or failed tenants write is never a save,
 *   - editing a location never moves it between the delivery/collection lists,
 *   - radius / fee / name limits, and the "nothing active" dependency,
 *   - the Locations page does not report unsaved changes on mount (the v1 bug),
 *     and v1 renders exactly as before when the chrome flag is off,
 *   - v2 Locations stacks Pickup above Return with one switch per option, saves
 *     each side's radius on its own through the page's save bar, and keeps a
 *     location's on/off and delete in its dialog.
 *
 * HARNESS: `react-dom/client` + `act`, same as settings-section-states.test.tsx
 * (the repo lacks @testing-library/dom).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Tell React this is a test environment, so act() flushes without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastMock = vi.hoisted(() => vi.fn());
const perms = vi.hoisted(() => ({ edit: true }));
const pickup = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => perms.edit, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
  useTenant: () => ({ tenant: { id: "t1", currency_code: "USD", distance_unit: "miles" } }),
}));
vi.mock("@/hooks/use-pickup-locations", () => ({ usePickupLocations: () => pickup.value }));

import {
  BusinessRegionalPanel,
  CURRENCY_NOT_CONFIRMED_MESSAGE,
  LocationsListV2,
  areaFieldErrors,
  buildLocationPayload,
  filterLocations,
  hasRealOrgSettings,
  hasRealRentalSettings,
  isAlreadyToasted,
  isHexColor6,
  isLocationFormDirty,
  isSupportedCurrency,
  locationFormFromSettings,
  PARTIAL_GENERAL_SAVE_MESSAGE,
  saveGeneralSettingsV2,
  useImageLoadFailed,
  validateLocationDraft,
  validateLocationSettingsV2,
  type GeneralSaveValues,
} from "@/components/settings-v2/business-settings-states";
import { LocationAutocomplete, sanitizeAddressInputV2 } from "@/components/ui/location-autocomplete";
import { LocationSettings } from "@/components/settings/location-settings";
import { V2Provider } from "@/lib/v2-context";
import { kmToDisplayUnit } from "@/lib/format-utils";
import { describeSaveError } from "@/components/settings-v2/section-states";
import { SettingsPageSaveProvider, SettingsStickySaveBar } from "@/components/settings-v2/settings-kit";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import {
  buildLocationDialogPayload,
  buildLocationSettingsPayloadV2,
  describeLocationDeleteError,
} from "@/components/settings-v2/locations-v2";

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
    name: "Heathrow Terminal 5",
    address: "Wallis Rd, Hounslow TW6 2GA",
    description: "Meet at arrivals hall",
    delivery_fee: 10,
    is_pickup_enabled: true,
    is_return_enabled: true,
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

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                  */
/* -------------------------------------------------------------------------- */

describe("placeholder detection", () => {
  it("treats the org-settings placeholder and a missing row as not loaded", () => {
    expect(hasRealOrgSettings({ org_id: "placeholder" })).toBe(false);
    expect(hasRealOrgSettings(undefined)).toBe(false);
    expect(hasRealOrgSettings({ org_id: "org-123" })).toBe(true);
  });

  it("recognises a real rental-settings row by its migration marker", () => {
    expect(hasRealRentalSettings({ minimum_rental_age: 21 })).toBe(false);
    expect(hasRealRentalSettings({ _paygMigrationReady: false })).toBe(true);
    expect(hasRealRentalSettings(null)).toBe(false);
  });

  it("knows which currencies the picker offers and which hex values are complete", () => {
    expect(isSupportedCurrency("GBP")).toBe(true);
    expect(isSupportedCurrency("AED")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isHexColor6("#C6A256")).toBe(true);
    expect(isHexColor6("#C6A25")).toBe(false);
    expect(isHexColor6("C6A256")).toBe(false);
  });
});

describe("saveGeneralSettingsV2", () => {
  const values: GeneralSaveValues = {
    currency_code: "GBP",
    distance_unit: "km",
    privacy_policy_version: "1.0",
    terms_version: "1.0",
  };

  it("writes the tenants row first, then org settings", async () => {
    const calls: string[] = [];
    const writeTenant = vi.fn(async (patch: Record<string, unknown>) => {
      calls.push("tenant");
      return { data: [{ id: "t1" }], error: null };
    });
    const writeOrg = vi.fn(async () => {
      calls.push("org");
    });
    await saveGeneralSettingsV2({ tenantId: "t1", values, policyVersionChanged: false, writeTenant, writeOrg });
    expect(calls).toEqual(["tenant", "org"]);
    expect(writeTenant).toHaveBeenCalledWith({
      distance_unit: "km",
      currency_code: "GBP",
      privacy_policy_version: "1.0",
      terms_version: "1.0",
    });
    expect(writeOrg).toHaveBeenCalledWith({ currency_code: "GBP", distance_unit: "km" });
  });

  it("clears policy acceptance only when a policy version changed", async () => {
    const writeTenant = vi.fn(async (_patch: Record<string, unknown>) => ({ data: [{ id: "t1" }], error: null }));
    await saveGeneralSettingsV2({ tenantId: "t1", values, policyVersionChanged: true, writeTenant, writeOrg: vi.fn(async () => {}) });
    expect(writeTenant.mock.calls[0][0]).toMatchObject({ policies_accepted_at: null });
  });

  it("refuses without a tenant and writes nothing", async () => {
    const writeTenant = vi.fn();
    await expect(
      saveGeneralSettingsV2({ tenantId: undefined, values, policyVersionChanged: false, writeTenant, writeOrg: vi.fn() }),
    ).rejects.toThrow("Your business details haven't loaded yet. Reload the page and try again.");
    expect(writeTenant).not.toHaveBeenCalled();
  });

  it("treats a zero-row update as a failure and never reaches org settings", async () => {
    const writeOrg = vi.fn();
    await expect(
      saveGeneralSettingsV2({
        tenantId: "t1",
        values,
        policyVersionChanged: false,
        writeTenant: async () => ({ data: [], error: null }),
        writeOrg,
      }),
    ).rejects.toThrow("You don't have permission to change these settings.");
    expect(writeOrg).not.toHaveBeenCalled();
  });

  it("rethrows a tenants error as-is, and flags an org failure as already toasted", async () => {
    const dbError = { message: "permission denied for table tenants", code: "42501" };
    await expect(
      saveGeneralSettingsV2({
        tenantId: "t1",
        values,
        policyVersionChanged: false,
        writeTenant: async () => ({ data: null, error: dbError }),
        writeOrg: vi.fn(),
      }),
    ).rejects.toBe(dbError);

    let caught: unknown;
    try {
      await saveGeneralSettingsV2({
        tenantId: "t1",
        values,
        policyVersionChanged: false,
        writeTenant: async () => ({ data: [{ id: "t1" }], error: null }),
        writeOrg: async () => {
          throw new Error("Failed to update settings: 500");
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(isAlreadyToasted(caught)).toBe(true);
    expect(isAlreadyToasted(new Error("x"))).toBe(false);
    // The tenants row is already written, so the reason says the save was partial.
    expect((caught as Error).message).toBe(PARTIAL_GENERAL_SAVE_MESSAGE);
    expect(describeSaveError(caught)).toBe(
      "Only part of this change was saved, so some screens may still show the old setting. Retry to finish saving it.",
    );
  });

  it("describes an edge-function transport failure in plain words", () => {
    expect(describeSaveError(new Error("Failed to update settings: Edge Function returned a non-2xx status code"))).toBe(
      "The server couldn't save this right now. Your changes are still here. Try again.",
    );
  });
});

describe("location form mapping and dirty state", () => {
  const toMiles = (km: number) => kmToDisplayUnit(km, "miles");

  it("maps stored km to the display unit exactly as the sync effect does", () => {
    const form = locationFormFromSettings(
      settingsRow({
        pickup_area_radius_km: 40, // 40 × 0.621371 = 24.85484 → 24.9 mi
        delivery_distance_tiers: [
          { up_to_km: 16.0934, fee: 15 }, // 9.99997 → 10 mi
          { up_to_km: null, fee: 40 },
        ],
        delivery_max_distance_km: 80, // 49.70968 → 49.7 mi
      }),
      toMiles,
    );
    expect(form.areaRadius).toBe(24.9);
    expect(form.tiers).toEqual([
      { up_to: 10, fee: 15 },
      { up_to: null, fee: 40 },
    ]);
    expect(form.maxDeliveryDistance).toBe(49.7);
    expect(form.sameReturnAddress).toBe(true); // no separate return address stored
    expect(locationFormFromSettings(settingsRow({ pickup_area_radius_km: null }), toMiles).areaRadius).toBe(100);
  });

  it("reads the return radius from its own column", () => {
    // 16.0934 km × 0.621371 = 9.99997 → 10 mi; the pickup side keeps 40 km → 24.9 mi.
    const form = locationFormFromSettings(settingsRow({ pickup_area_radius_km: 40, return_area_radius_km: 16.0934 }), toMiles);
    expect([form.areaRadius, form.returnAreaRadius]).toEqual([24.9, 10]);
    expect(locationFormFromSettings(settingsRow({ return_area_radius_km: null }), toMiles).returnAreaRadius).toBe(100);
    expect(isLocationFormDirty({ ...form, returnAreaRadius: 12 }, form)).toBe(true);
  });

  it("is clean when nothing changed and dirty after any real edit", () => {
    const saved = locationFormFromSettings(settingsRow({ delivery_distance_tiers: [{ up_to_km: 20, fee: 5 }] }), toMiles);
    expect(isLocationFormDirty({ ...saved, tiers: saved.tiers.map((t) => ({ ...t })) }, saved)).toBe(false);
    expect(isLocationFormDirty({ ...saved, fixedPickupAddress: "2 Depot Way" }, saved)).toBe(true);
    expect(isLocationFormDirty({ ...saved, tiers: [{ up_to: saved.tiers[0].up_to, fee: 6 }] }, saved)).toBe(true);
    expect(isLocationFormDirty({ ...saved, tiers: [] }, saved)).toBe(true);
  });
});

describe("area and save validation", () => {
  const base = locationFormFromSettings(settingsRow(), (km) => kmToDisplayUnit(km, "miles"));
  const area = { ...base, pickupAreaEnabled: true, areaCenterLat: 51.47, areaCenterLon: -0.45 };

  it("checks nothing while area delivery is off", () => {
    expect(areaFieldErrors({ ...base, areaRadius: -3, areaDeliveryFee: -1 }, "mi")).toEqual({});
  });

  it("never lets a blank, zero or negative radius through (v1 saved 100)", () => {
    expect(areaFieldErrors({ ...area, areaRadius: null }, "mi").radius).toBe("Enter a radius of at least 1 mi.");
    expect(areaFieldErrors({ ...area, areaRadius: 0 }, "mi").radius).toBe("Radius must be at least 1 mi.");
    expect(areaFieldErrors({ ...area, areaRadius: -5 }, "km").radius).toBe("Radius must be at least 1 km.");
    expect(areaFieldErrors({ ...area, areaRadius: 1 }, "mi").radius).toBeUndefined();
  });

  it("checks each side's radius only while that side's area is on", () => {
    const both = { ...area, returnAreaEnabled: true };
    expect(areaFieldErrors({ ...both, areaRadius: 25, returnAreaRadius: 0 }, "mi")).toEqual({
      returnRadius: "Radius must be at least 1 mi.",
    });
    // Return area off: its radius is hidden, so it never blocks.
    expect(areaFieldErrors({ ...area, returnAreaRadius: null }, "mi")).toEqual({});
    // Pickup area off: only the return radius counts.
    const returnOnly = { ...base, returnAreaEnabled: true, areaCenterLat: 51.47, areaCenterLon: -0.45 };
    expect(areaFieldErrors({ ...returnOnly, areaRadius: -1, returnAreaRadius: null }, "km")).toEqual({
      returnRadius: "Enter a radius of at least 1 km.",
    });
    expect(
      validateLocationSettingsV2({ ...both, returnAreaRadius: 0 }, { unitLabel: "mi", pickupActiveLocations: null, returnActiveLocations: null }),
    ).toBe("Radius must be at least 1 mi.");
  });

  it("rejects a negative flat fee, but not when bands set the fee", () => {
    expect(areaFieldErrors({ ...area, areaDeliveryFee: -2 }, "mi").fee).toBe("Fee can't be negative.");
    expect(areaFieldErrors({ ...area, areaDeliveryFee: -2, deliveryTiersEnabled: true }, "mi").fee).toBeUndefined();
    expect(areaFieldErrors({ ...area, areaCenterLat: null }, "mi").center).toBe(
      "Pick a center point from the address suggestions.",
    );
  });

  it("checks price bands inline: none, negative fee, zero distance, duplicate distance, and the distance cap", () => {
    const tiered = { ...area, deliveryTiersEnabled: true };
    expect(areaFieldErrors({ ...tiered, tiers: [] }, "mi").bands).toBe(
      "Add at least one price band, or choose One fee.",
    );
    const bad = areaFieldErrors(
      { ...tiered, tiers: [{ up_to: 10, fee: 5 }, { up_to: 0, fee: 5 }, { up_to: 30, fee: -5 }, { up_to: null, fee: 40 }] },
      "mi",
    );
    expect(bad.bandRows).toEqual({ 1: "Distance must be more than 0 mi.", 2: "Fee can't be negative." });
    expect(
      validateLocationSettingsV2(
        { ...tiered, tiers: [{ up_to: 10, fee: 5 }, { up_to: 30, fee: -5 }] },
        { unitLabel: "mi", pickupActiveLocations: null, returnActiveLocations: null },
      ),
    ).toBe('Price band "Up to 30 mi": Fee can\'t be negative.');
    expect(areaFieldErrors({ ...tiered, tiers: [{ up_to: 20, fee: 5 }, { up_to: 20, fee: 9 }] }, "km").bands).toBe(
      "Two bands have the same distance. Give each band its own distance.",
    );
    // Out of order is fine (v1 sorts); only a repeat is not.
    expect(areaFieldErrors({ ...tiered, tiers: [{ up_to: 40, fee: 9 }, { up_to: 20, fee: 5 }] }, "km")).toEqual({});
    expect(
      areaFieldErrors({ ...tiered, tiers: [{ up_to: 20, fee: 5 }, { up_to: 40, fee: 9 }], maxDeliveryDistance: 30 }, "mi")
        .maxDistance,
    ).toBe("Must be at least your furthest band (40 mi).");
    expect(
      areaFieldErrors({ ...tiered, tiers: [{ up_to: 20, fee: 5 }], maxDeliveryDistance: -1 }, "mi").maxDistance,
    ).toBe("Enter a distance above 0, or leave it blank for no limit.");
    // Bands are only checked while tiered pricing is on.
    expect(areaFieldErrors({ ...area, tiers: [{ up_to: 0, fee: -1 }] }, "mi")).toEqual({});
  });

  it("blocks saving a delivery list with nothing active, and skips the check while the list is unknown", () => {
    const withList = { ...base, pickupMultipleEnabled: true };
    expect(
      validateLocationSettingsV2(withList, { unitLabel: "mi", pickupActiveLocations: 0, returnActiveLocations: null }),
    ).toBe("Delivery locations is on but none are active. Add or switch on a location, or turn it off.");
    expect(
      validateLocationSettingsV2(withList, { unitLabel: "mi", pickupActiveLocations: null, returnActiveLocations: null }),
    ).toBeNull();
    expect(
      validateLocationSettingsV2({ ...base, fixedPickupAddress: "  " }, { unitLabel: "mi", pickupActiveLocations: 2, returnActiveLocations: 2 }),
    ).toBe("Enter your pickup address.");
  });
});

describe("location drafts", () => {
  it("names each problem with the field", () => {
    expect(validateLocationDraft({ name: " ", address: "", description: "", delivery_fee: null })).toEqual({
      name: "Enter a name customers will recognise.",
      address: "Enter the address.",
    });
    expect(validateLocationDraft({ name: "x".repeat(81), address: "a", description: "", delivery_fee: -1 })).toEqual({
      name: "Keep the name to 80 characters (it has 81).",
      fee: "Fee can't be negative.",
    });
    expect(validateLocationDraft({ name: "a", address: "a", description: "", delivery_fee: Number.NaN }).fee).toBe(
      "Enter a valid fee.",
    );
  });

  it("an edit sends no pickup/return flags; a new location takes the dialog's side", () => {
    const draft = { name: " Airport ", address: "1 Terminal Rd", description: "  ", delivery_fee: 4.125 };
    expect(buildLocationPayload(draft, { editing: true, mode: "pickup" })).toEqual({
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 4.125, // sent as typed, exactly like v1; numeric(10,2) stores 4.13
    });
    // Math.round(1.005 * 100) / 100 is 1, but Postgres stores 1.005 as 1.01: never pre-round.
    expect(buildLocationPayload({ ...draft, delivery_fee: 1.005 }, { editing: true, mode: "pickup" }).delivery_fee).toBe(1.005);
    expect(buildLocationPayload({ ...draft, delivery_fee: null }, { editing: false, mode: "return" })).toEqual({
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 0,
      is_pickup_enabled: false,
      is_return_enabled: true,
    });
  });

  it("filters by name, address or description", () => {
    const list = [location(), location({ id: "l2", name: "Kings Cross", address: "Euston Rd", description: null })];
    expect(filterLocations(list, "terminal").map((l) => l.id)).toEqual(["l1"]);
    expect(filterLocations(list, "ARRIVALS").map((l) => l.id)).toEqual(["l1"]);
    expect(filterLocations(list, "euston").map((l) => l.id)).toEqual(["l2"]);
    expect(filterLocations(list, "  ")).toHaveLength(2);
  });
});

describe("the v2 Locations save payload", () => {
  const toMiles = (km: number) => kmToDisplayUnit(km, "miles");
  const saved = locationFormFromSettings(
    settingsRow({
      pickup_area_enabled: true,
      return_area_enabled: true,
      area_center_lat: 51.47,
      area_center_lon: -0.45,
      area_delivery_fee: 12,
    }),
    toMiles,
  );

  it("writes each side's radius from its own field (v1 wrote the pickup radius to both)", () => {
    // 25 mi ÷ 0.621371 = 40.23 km → 40.2; 10 mi ÷ 0.621371 = 16.09 km → 16.1.
    expect(buildLocationSettingsPayloadV2({ ...saved, areaRadius: 25, returnAreaRadius: 10 }, "miles")).toEqual({
      fixed_address_enabled: true,
      multiple_locations_enabled: false,
      area_around_enabled: true,
      pickup_fixed_enabled: true,
      return_fixed_enabled: true,
      pickup_multiple_locations_enabled: false,
      return_multiple_locations_enabled: false,
      pickup_area_enabled: true,
      return_area_enabled: true,
      fixed_pickup_address: "1 Depot Way",
      fixed_return_address: "1 Depot Way",
      pickup_area_radius_km: 40.2,
      return_area_radius_km: 16.1,
      area_delivery_fee: 12,
      area_center_lat: 51.47,
      area_center_lon: -0.45,
      delivery_tiers_enabled: false,
      delivery_distance_tiers: [],
      delivery_max_distance_km: null,
    });
    const km = buildLocationSettingsPayloadV2({ ...saved, areaRadius: 25, returnAreaRadius: 10 }, "km");
    expect([km.pickup_area_radius_km, km.return_area_radius_km]).toEqual([25, 10]);
  });

  it("converts bands and the cap to km, and gives a hidden unusable radius v1's 100", () => {
    const p = buildLocationSettingsPayloadV2(
      {
        ...saved,
        returnAreaEnabled: false,
        returnAreaRadius: 0,
        deliveryTiersEnabled: true,
        tiers: [{ up_to: 20, fee: 5 }, { up_to: null, fee: 40 }],
        maxDeliveryDistance: 50,
      },
      "miles",
    );
    // 20 mi → 32.19 km → 32.2; 50 mi → 80.47 km → 80.5; 100 mi → 160.93 km → 160.9.
    expect(p.delivery_tiers_enabled).toBe(true);
    expect(p.delivery_distance_tiers).toEqual([{ up_to_km: 32.2, fee: 5 }, { up_to_km: null, fee: 40 }]);
    expect(p.delivery_max_distance_km).toBe(80.5);
    expect(p.return_area_radius_km).toBe(160.9);
  });

  it("with no area option on, clears the area columns as v1 does", () => {
    const off = buildLocationSettingsPayloadV2(
      { ...saved, pickupAreaEnabled: false, returnAreaEnabled: false, deliveryTiersEnabled: true, tiers: [{ up_to: 20, fee: 5 }] },
      "miles",
    );
    expect(off).toMatchObject({
      area_around_enabled: false,
      pickup_area_radius_km: null,
      return_area_radius_km: null,
      area_delivery_fee: 0,
      area_center_lat: null,
      area_center_lon: null,
      delivery_tiers_enabled: false,
      delivery_distance_tiers: [],
      delivery_max_distance_km: null,
    });
  });

  it("the location dialog sends is_active only when it changes", () => {
    const draft = { name: "Airport", address: "1 Terminal Rd", description: "", delivery_fee: 10 };
    const existing = location({ id: "a1", is_active: true });
    const fields = { name: "Airport", address: "1 Terminal Rd", description: null, delivery_fee: 10 };
    expect(buildLocationDialogPayload(draft, true, { location: existing, side: "pickup" })).toEqual({ id: "a1", ...fields });
    expect(buildLocationDialogPayload(draft, false, { location: existing, side: "pickup" })).toEqual({
      id: "a1",
      ...fields,
      is_active: false,
    });
    expect(buildLocationDialogPayload(draft, true, { location: null, side: "return" })).toEqual({
      ...fields,
      is_pickup_enabled: false,
      is_return_enabled: true,
    });
    expect(buildLocationDialogPayload(draft, false, { location: null, side: "pickup" })).toEqual({
      ...fields,
      is_pickup_enabled: true,
      is_return_enabled: false,
      is_active: false,
    });
  });

  it("says a location a booking uses can't be deleted, and how to hide it", () => {
    expect(describeLocationDeleteError({ code: "23503", message: "violates foreign key constraint" })).toBe(
      "Bookings still use this location, so it can't be deleted. Turn off Available to customers to hide it instead.",
    );
    expect(describeLocationDeleteError(new Error("Failed to fetch"))).toBe(
      "We couldn't reach the server. Your changes are still here.",
    );
  });
});

describe("address input", () => {
  it("v2 keeps accents and symbols, dropping only control characters", () => {
    expect(sanitizeAddressInputV2("Unit 4/7, Zürich\t#12 & Co\n")).toBe("Unit 4/7, Zürich#12 & Co");
  });

  function Controlled({ v2 }: { v2: boolean }) {
    const [value, setValue] = useState("");
    return <LocationAutocomplete value={value} onChange={(v) => setValue(v)} v2States={v2} />;
  }

  it("v1 still strips them (unchanged); v2 keeps them and says search is unavailable", () => {
    vi.useFakeTimers();
    render(<Controlled v2={false} />);
    let input = container.querySelector("input")!;
    act(() => typeInto(input, "Zürich #4/7 & Co"));
    expect(input.value).toBe("Zrich 47  Co");

    render(<Controlled v2 />);
    input = container.querySelector("input")!;
    act(() => typeInto(input, "Zürich #4/7 & Co"));
    expect(input.value).toBe("Zürich #4/7 & Co");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container.textContent).toContain("Address suggestions aren't available right now. Type the full address.");
  });
});

describe("useImageLoadFailed", () => {
  it("reports a failed image only for the src that failed", () => {
    const created: { onerror: (() => void) | null; onload: (() => void) | null; src: string }[] = [];
    const Original = window.Image;
    (window as any).Image = class {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      constructor() {
        created.push(this);
      }
    };
    function Probe({ src }: { src: string | null }) {
      return <span>{useImageLoadFailed(src) ? "failed" : "ok"}</span>;
    }
    try {
      render(<Probe src="https://cdn.example/logo.png" />);
      expect(container.textContent).toBe("ok");
      act(() => created[0].onerror?.());
      expect(container.textContent).toBe("failed");
      render(<Probe src={null} />);
      expect(container.textContent).toBe("ok");
    } finally {
      (window as any).Image = Original;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* General: regional panel                                                     */
/* -------------------------------------------------------------------------- */

describe("BusinessRegionalPanel", () => {
  const form: GeneralSaveValues = { currency_code: "USD", distance_unit: "miles", privacy_policy_version: "1.0", terms_version: "1.0" };
  const props = (over: Partial<React.ComponentProps<typeof BusinessRegionalPanel>> = {}) => ({
    form,
    onFormChange: vi.fn(),
    savedCurrency: "USD",
    isDirty: false,
    canEdit: true,
    ready: true,
    onRetryLoad: vi.fn(),
    onSave: vi.fn(async () => {}),
    onDiscard: vi.fn(),
    ...over,
  });

  it("shows a skeleton, not the USD/miles placeholder, until the real settings arrive", () => {
    render(<BusinessRegionalPanel {...props({ ready: false })} />);
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Currency");
  });

  it("replaces the form with a retry when the read failed", () => {
    const p = props({ ready: false, loadError: new Error("Failed to fetch") });
    render(<BusinessRegionalPanel {...p} />);
    expect(container.textContent).toContain("Couldn't load your regional settings");
    act(() => buttonByText("Try again", container).click());
    expect(p.onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it("explains a currency the picker doesn't offer", () => {
    render(<BusinessRegionalPanel {...props({ form: { ...form, currency_code: "AED" }, savedCurrency: "AED" })} />);
    expect(container.textContent).toContain("Your currency is AED");
  });

  it("asks before relabelling prices, and saves only after 'Change currency'", async () => {
    const p = props({ form: { ...form, currency_code: "GBP" }, isDirty: true });
    render(<BusinessRegionalPanel {...p} />);
    expect(container.textContent).toContain("Changing currency relabels your prices. It doesn't convert them.");
    await act(async () => buttonByText("Save", container).click());
    expect(document.body.textContent).toContain("Change currency from USD to GBP?");
    expect(p.onSave).not.toHaveBeenCalled();
    await act(async () => buttonByText("Change currency").click());
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed save on screen with the reason, and toasts once", async () => {
    const p = props({
      form: { ...form, distance_unit: "km" },
      isDirty: true,
      onSave: vi.fn(async () => {
        throw new Error("You don't have permission to change these settings.");
      }),
    });
    render(<BusinessRegionalPanel {...p} />);
    await act(async () => buttonByText("Save", container).click());
    const inline = container.querySelector('[data-settings-state="save-error"]');
    expect(inline?.textContent).toContain("Couldn't save.");
    expect(inline?.textContent).toContain("You don't have permission to change these settings.");
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(buttonByText("Save", container).disabled).toBe(false);
  });

  it("does not toast again when the org hook already did", async () => {
    const p = props({
      isDirty: true,
      form: { ...form, distance_unit: "km" },
      onSave: vi.fn(async () => {
        throw Object.assign(new Error("Failed to update settings: 500"), { alreadyToasted: true });
      }),
    });
    render(<BusinessRegionalPanel {...p} />);
    await act(async () => buttonByText("Save", container).click());
    expect(container.querySelector('[data-settings-state="save-error"]')).not.toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("is view-only without edit rights: no Save, pickers disabled", () => {
    render(<BusinessRegionalPanel {...props({ canEdit: false })} />);
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Save")).toBe(false);
    const trigger = container.querySelector("#v2_currency_code") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  describe("inside the page's save bar", () => {
    const lastRegistration = (registerSave: ReturnType<typeof vi.fn>) => {
      const calls = registerSave.mock.calls.filter((call) => call[0] === "general-regional");
      return calls[calls.length - 1] as [string, (() => Promise<unknown>) | null, (() => void) | undefined];
    };

    it("shows no Save and registers nothing while clean", () => {
      const registerSave = vi.fn();
      render(
        <SettingsPageSaveProvider>
          <BusinessRegionalPanel {...props({ registerSave })} />
        </SettingsPageSaveProvider>,
      );
      expect(container.querySelectorAll("button").length).toBe(2); // the two pickers only
      expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Save")).toBe(false);
      expect(lastRegistration(registerSave)).toEqual(["general-regional", null]);
    });

    it("a distance change registers a save and a discard; the save writes without asking", async () => {
      const registerSave = vi.fn();
      const p = props({ form: { ...form, distance_unit: "km" }, isDirty: true, registerSave });
      render(
        <SettingsPageSaveProvider>
          <BusinessRegionalPanel {...p} />
        </SettingsPageSaveProvider>,
      );
      const [, save, discard] = lastRegistration(registerSave);
      await act(async () => {
        await save!();
      });
      expect(p.onSave).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).not.toContain("Change currency from");
      act(() => discard!());
      expect(p.onDiscard).toHaveBeenCalledTimes(1);
    });

    it("a currency change still asks first: the page's save waits for 'Change currency'", async () => {
      const registerSave = vi.fn();
      const p = props({ form: { ...form, currency_code: "GBP" }, isDirty: true, registerSave });
      render(
        <SettingsPageSaveProvider>
          <BusinessRegionalPanel {...p} />
        </SettingsPageSaveProvider>,
      );
      const [, save] = lastRegistration(registerSave);
      let settled = false;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = save!().then(() => (settled = true));
      });
      expect(document.body.textContent).toContain("Change currency from USD to GBP?");
      expect(p.onSave).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      await act(async () => buttonByText("Change currency").click());
      await act(async () => {
        await pending;
      });
      expect(p.onSave).toHaveBeenCalledTimes(1);
      expect(settled).toBe(true);
    });

    it("cancelling the currency confirm rejects the page's save, without a toast of its own", async () => {
      const registerSave = vi.fn();
      const p = props({ form: { ...form, currency_code: "EUR" }, isDirty: true, registerSave });
      render(
        <SettingsPageSaveProvider>
          <BusinessRegionalPanel {...p} />
        </SettingsPageSaveProvider>,
      );
      const [, save] = lastRegistration(registerSave);
      let failure: unknown = null;
      await act(async () => {
        void save!().catch((error) => (failure = error));
      });
      await act(async () => buttonByText("Cancel").click());
      expect((failure as Error).message).toBe("The currency change wasn't confirmed, so it wasn't saved.");
      expect(CURRENCY_NOT_CONFIRMED_MESSAGE).toBe("The currency change wasn't confirmed, so it wasn't saved.");
      expect(isAlreadyToasted(failure)).toBe(true);
      expect(p.onSave).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("a failed page save is said inline, with no toast here (the page toasts) and no button", async () => {
      const registerSave = vi.fn();
      const p = props({
        form: { ...form, distance_unit: "km" },
        isDirty: true,
        registerSave,
        onSave: vi.fn(async () => {
          throw new Error("You don't have permission to change these settings.");
        }),
      });
      render(
        <SettingsPageSaveProvider>
          <BusinessRegionalPanel {...p} />
        </SettingsPageSaveProvider>,
      );
      const [, save] = lastRegistration(registerSave);
      await act(async () => {
        await save!().catch(() => undefined);
      });
      const inline = container.querySelector('[data-settings-state="save-error"]');
      expect(inline?.textContent).toBe("Couldn't save. You don't have permission to change these settings.");
      expect(toastMock).not.toHaveBeenCalled();
      expect(Array.from(container.querySelectorAll("button")).some((b) => /Save|Retry/.test(b.textContent ?? ""))).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Locations: list                                                             */
/* -------------------------------------------------------------------------- */

describe("LocationsListV2", () => {
  const listProps = (over: Partial<React.ComponentProps<typeof LocationsListV2>> = {}) => ({
    side: "pickup" as const,
    locations: [] as any[],
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    onAdd: vi.fn(),
    onOpen: vi.fn(),
    currencyCode: "USD",
    readOnly: false,
    ...over,
  });

  it("loading shows a skeleton instead of 'no locations'", () => {
    render(<LocationsListV2 {...listProps({ isLoading: true })} />);
    expect(container.querySelector('[data-settings-state="loading"]')?.textContent).toContain("Loading delivery locations");
    expect(container.textContent).not.toContain("No delivery locations yet");
  });

  it("a failed read is not an empty list", () => {
    const p = listProps({ error: new Error("Failed to fetch") });
    render(<LocationsListV2 {...p} />);
    expect(container.textContent).toContain("Couldn't load your delivery locations");
    expect(container.textContent).not.toContain("Add location");
    act(() => buttonByText("Try again", container).click());
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it("empty says what a location is and offers Add location (not to viewers)", () => {
    const p = listProps();
    render(<LocationsListV2 {...p} />);
    expect(container.textContent).toContain("No delivery locations yet.");
    act(() => buttonByText("Add location", container).click());
    expect(p.onAdd).toHaveBeenCalledTimes(1);

    render(<LocationsListV2 {...listProps({ side: "return", readOnly: true })} />);
    expect(container.textContent).toContain("No collection locations yet.");
    expect(container.textContent).not.toContain("Add location");
  });

  it("counts, searches past 8 rows, echoes a query with no match, and clears it", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      location({ id: `l${i}`, name: `Stop ${i}`, description: null, is_active: i !== 0 }),
    );
    render(<LocationsListV2 {...listProps({ locations: many })} />);
    expect(container.textContent).toContain("9 locations · 8 active");
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => typeInto(search, "zzz"));
    expect(container.querySelector('[data-settings-state="no-match"]')?.textContent).toContain("“zzz”");
    act(() => buttonByText("Clear search", container).click());
    expect(container.querySelectorAll("li")).toHaveLength(9);
  });

  it("each location is ONE row: name, address, fee and a muted Off; pressing it opens the location", () => {
    const rows = [
      location({ id: "a", name: "Free spot", address: "2 Quay St", delivery_fee: 0, is_active: false }),
      location({ id: "b", name: "Airport", delivery_fee: 12.5 }),
    ];
    const p = listProps({ locations: rows });
    render(<LocationsListV2 {...p} />);
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toBe("Free spot2 Quay StNo feeOff");
    expect(items[1].textContent).toContain("$12.50");
    expect(items[1].textContent).not.toContain("Off");
    items.forEach((item) => {
      expect(item.querySelectorAll("button")).toHaveLength(1);
      expect(item.querySelector('[role="switch"]')).toBeNull();
      expect(item.querySelector("svg")).toBeNull();
    });
    act(() => (items[1].querySelector("button") as HTMLButtonElement).click());
    expect(p.onOpen).toHaveBeenCalledWith(rows[1]);
  });

  it("view-only: the same rows, with nothing to press and no Add location", () => {
    render(<LocationsListV2 {...listProps({ locations: [location()], readOnly: true })} />);
    expect(container.querySelector("li")?.textContent).toContain("Heathrow Terminal 5");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).not.toContain("Add location");
  });
});

/* -------------------------------------------------------------------------- */
/* Locations: the page component, v2 vs v1                                     */
/* -------------------------------------------------------------------------- */

/**
 * The settings page's part in a save, as `settings/page.tsx` wires it: sections
 * register a save and a discard, one sticky bar runs them (Save changes / Reset)
 * and says why a save failed.
 */
function PageSaveHarness({ children }: { children: (register: RegisterSectionSave) => React.ReactNode }) {
  const saves = useRef<Record<string, () => Promise<unknown>>>({});
  const discards = useRef<Record<string, () => void>>({});
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const register = useCallback<RegisterSectionSave>((key, save, discard) => {
    if (save) saves.current[key] = save;
    else delete saves.current[key];
    if (save && discard) discards.current[key] = discard;
    else delete discards.current[key];
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
        onReset={() => {
          setError(null);
          Object.values(discards.current).forEach((discard) => discard());
        }}
      />
    </SettingsPageSaveProvider>
  );
}

describe("LocationSettings", () => {
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
    updateLocation: vi.fn(async () => ({})),
    isUpdating: false,
    deleteLocation: vi.fn(async () => ({})),
    isDeleting: false,
    ...over,
  });

  const renderV2 = (extra: Record<string, unknown> = {}) => render(
    <V2Provider flags={{ chrome: true }}>
      <LocationSettings {...extra} />
    </V2Provider>,
  );

  /** Renders v2 Locations inside the page's save bar; returns a re-render (a query update). */
  const renderV2Page = (extra: Record<string, unknown> = {}) => {
    const ui = () => (
      <V2Provider flags={{ chrome: true }}>
        <PageSaveHarness>{(register) => <LocationSettings registerSave={register} {...extra} />}</PageSaveHarness>
      </V2Provider>
    );
    render(ui());
    return () => render(ui());
  };

  /** A save that lands: the hook puts the written row in its cache, as `setQueryData` does. */
  const savingHook = (h: ReturnType<typeof hook>, rerender: { current: () => void }) => {
    h.updateSettings = vi.fn(async (patch: Record<string, unknown>) => {
      pickup.value = { ...pickup.value, locationSettings: { ...(pickup.value.locationSettings as object), ...patch } };
      rerender.current();
      return {};
    });
  };

  const saveBar = () => container.querySelector("[data-settings-save-bar]") as HTMLElement;
  const input = (selector: string) => container.querySelector(selector) as HTMLInputElement;

  it("v2: stacked panel skeletons while the settings are still the placeholder", () => {
    pickup.value = hook({ hasSettingsData: false });
    renderV2();
    const loading = Array.from(container.querySelectorAll('[data-settings-state="loading"]')).map((el) => el.textContent);
    expect(loading).toEqual(["Loading pickup options", "Loading return options"]);
    expect(container.querySelector("h2")).toBeNull();
  });

  it("v2: a failed read shows a retry, never the default form", () => {
    const h = hook({ hasSettingsData: false, settingsError: new Error("Failed to fetch") });
    pickup.value = h;
    renderV2();
    expect(container.textContent).toContain("Couldn't load your pickup and return settings");
    expect(container.querySelector('[role="switch"]')).toBeNull();
    act(() => buttonByText("Try again", container).click());
    expect(h.refetchSettings).toHaveBeenCalledTimes(1);
  });

  it("v2: Pickup sits above Return, one switch per option, no icon tiles, pills or row switches", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true, return_multiple_locations_enabled: true }),
      locations: [location({ id: "a", name: "Airport", delivery_fee: 0, is_active: false }), location({ id: "b", name: "Harbour" })],
    });
    renderV2Page();
    const titles = Array.from(container.querySelectorAll("h2"));
    expect(titles.map((h) => h.textContent)).toEqual(["Pickup", "Return"]);
    expect(titles[0].compareDocumentPosition(titles[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.innerHTML).not.toContain("grid-cols-2");
    // Three options a side, each with ONE switch; none inside a location row.
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(6);
    expect(container.querySelectorAll("li")).toHaveLength(4);
    container.querySelectorAll("li").forEach((li) => {
      expect(li.querySelectorAll("button")).toHaveLength(1);
      expect(li.querySelector('[role="switch"]')).toBeNull();
    });
    // No decorative icons: the only one on screen is the tick inside the checkbox.
    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs.every((svg) => svg.closest('button[role="checkbox"]'))).toBe(true);
    // No Free / Paid / Active / Inactive pills; an unavailable location says Off.
    const words = Array.from(container.querySelectorAll("span")).map((el) => el.textContent?.trim() ?? "");
    expect(words.filter((w) => ["Free", "Paid", "Active", "Inactive"].includes(w))).toEqual([]);
    expect(words.filter((w) => w === "Off")).toHaveLength(2);
  });

  it("v2: loaded with no edits is clean, and Locations has no Save of its own", () => {
    pickup.value = hook();
    const onDirtyChangeV2 = vi.fn();
    renderV2Page({ onDirtyChangeV2 });
    const saves = Array.from(container.querySelectorAll("button")).filter((b) => /save/i.test(b.textContent ?? ""));
    expect(saves).toHaveLength(1);
    expect(saves[0].closest("[data-settings-save-bar]")).not.toBeNull();
    expect(saves[0].disabled).toBe(true);
    expect(onDirtyChangeV2).not.toHaveBeenCalledWith(true);
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("v2: the page's save bar writes the pickup and return radii separately, then reads clean", async () => {
    const h = hook({
      locationSettings: settingsRow({
        pickup_area_enabled: true,
        return_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
        area_delivery_fee: 12,
      }),
    });
    const rerender = { current: () => {} };
    savingHook(h, rerender);
    pickup.value = h;
    const onDirtyChangeV2 = vi.fn();
    rerender.current = renderV2Page({ onDirtyChangeV2 });

    // Both stored as 40 km: 40 × 0.621371 = 24.85 → 24.9 mi.
    expect([input("#v2-pickup-area-radius").value, input("#v2-return-area-radius").value]).toEqual(["24.9", "24.9"]);
    act(() => typeInto(input("#v2-pickup-area-radius"), "25"));
    act(() => typeInto(input("#v2-return-area-radius"), "10"));
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(true);
    expect(saveBar().textContent).toContain("Unsaved changes");

    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    // 25 mi ÷ 0.621371 = 40.23 → 40.2 km; 10 mi ÷ 0.621371 = 16.09 → 16.1 km.
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({
      pickup_area_radius_km: 40.2,
      return_area_radius_km: 16.1,
      area_center_lat: 51.47,
      area_center_lon: -0.45,
      area_delivery_fee: 12,
    });
    // The saved row reads back as 25.0 and 10.0 mi, so nothing is unsaved.
    expect([input("#v2-pickup-area-radius").value, input("#v2-return-area-radius").value]).toEqual(["25", "10"]);
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(false);
    expect(buttonByText("Save changes", saveBar()).disabled).toBe(true);
  });

  it("v2: Reset puts the fields back and reads clean", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_area_enabled: true, area_center_lat: 51.47, area_center_lon: -0.45 }),
    });
    const onDirtyChangeV2 = vi.fn();
    renderV2Page({ onDirtyChangeV2 });
    act(() => typeInto(input("#v2-pickup-area-radius"), "30"));
    act(() => (container.querySelector("#v2-pickup-multiple") as HTMLButtonElement).click());
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(true);

    act(() => buttonByText("Reset", saveBar()).click());
    expect(input("#v2-pickup-area-radius").value).toBe("24.9");
    expect(container.querySelector("#v2-pickup-multiple")?.getAttribute("aria-checked")).toBe("false");
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(false);
    expect(buttonByText("Save changes", saveBar()).disabled).toBe(true);
  });

  it("v2: an invalid area blocks Save with inline errors, and nothing is written", async () => {
    const h = hook({ locationSettings: settingsRow({ pickup_area_enabled: true }) });
    pickup.value = h;
    renderV2Page();
    // A fresh area waits for a Save before asking for its center point.
    expect(container.textContent).not.toContain("Pick a center point");
    act(() => typeInto(input("#v2-pickup-area-radius"), "0"));
    expect(container.textContent).toContain("Radius must be at least 1 mi.");

    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(h.updateSettings).not.toHaveBeenCalled();
    const alerts = Array.from(container.querySelectorAll('[role="alert"]')).map((el) => el.textContent);
    expect(alerts).toContain("Pick a center point from the address suggestions.");
    expect(saveBar().textContent).toContain("Pick a center point from the address suggestions.");
  });

  it("v2: a failed write is said in the save bar, and the edit stays unsaved", async () => {
    const h = hook();
    h.updateSettings = vi.fn(async () => {
      throw { message: "permission denied for table tenants", code: "42501" };
    });
    pickup.value = h;
    const onDirtyChangeV2 = vi.fn();
    renderV2Page({ onDirtyChangeV2 });
    act(() => typeInto(input("#v2-pickup-address"), "2 Depot Way"));
    await act(async () => buttonByText("Save changes", saveBar()).click());
    expect(saveBar().textContent).toContain("You don't have permission to change this.");
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(true);
  });

  it("v2: Return has its own radius, and shows the center and prices only while Pickup's area is off", () => {
    pickup.value = hook({
      locationSettings: settingsRow({
        pickup_area_enabled: true,
        return_area_enabled: true,
        area_center_lat: 51.47,
        area_center_lon: -0.45,
      }),
    });
    renderV2Page();
    const returnArea = container.querySelector('[data-location-option="v2-return-area"]') as HTMLElement;
    expect(returnArea.textContent).toContain("Uses the same center point and delivery prices as Pickup.");
    expect(returnArea.querySelector("#v2-return-area-radius")).not.toBeNull();
    expect(returnArea.querySelector("#v2-area-center")).toBeNull();
    expect(container.querySelectorAll("#v2-area-center")).toHaveLength(1);

    act(() => (container.querySelector("#v2-pickup-area") as HTMLButtonElement).click());
    expect(returnArea.querySelector("#v2-area-center")).not.toBeNull();
    expect(returnArea.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(returnArea.textContent).not.toContain("Uses the same center point");
  });

  it("v2: pricing is a two-option control, and the first switch to distance starts two bands", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_area_enabled: true, area_center_lat: 51.47, area_center_lon: -0.45, area_delivery_fee: 12 }),
    });
    renderV2Page();
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.className).toContain("rounded-full");
    const options = Array.from(group.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    expect(options.map((o) => [o.textContent, o.getAttribute("aria-checked")])).toEqual([
      ["One fee", "true"],
      ["Price by distance", "false"],
    ]);
    expect(input("#v2-area-fee").value).toBe("12");

    act(() => options[1].click());
    expect(container.querySelector("#v2-area-fee")).toBeNull();
    const bands = container.querySelector('ul[aria-label="Price bands"]') as HTMLElement;
    expect((bands.querySelector('input[aria-label="Band 1 distance"]') as HTMLInputElement).value).toBe("20");
    // The flat 12 seeds both: up to 20 mi at 12, anywhere further at 12 + 25 = 37.
    const fees = Array.from(bands.querySelectorAll('input[aria-label$=" fee"]')).map((el) => (el as HTMLInputElement).value);
    expect(fees).toEqual(["12", "37"]);
    expect(bands.textContent).toContain("Anywhere further");
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("Price by distance");
  });

  it("v2: warns when Delivery locations is on but none are available", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ is_active: false, is_return_enabled: false })],
    });
    renderV2Page();
    expect(container.textContent).toContain("None of these are available to customers, so they see an empty list.");
  });

  it("v2: a location opens its dialog, which holds Available to customers and Delete with a confirm step", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", is_return_enabled: false })],
    });
    pickup.value = h;
    renderV2Page();
    act(() => (container.querySelector('ul[aria-label="Delivery locations"] button') as HTMLButtonElement).click());
    const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog().querySelector("h2")?.textContent).toBe("Edit delivery location");
    expect(dialog().querySelector("h2 svg")).toBeNull();
    expect(dialog().querySelector("#v2-location-active")?.getAttribute("aria-checked")).toBe("true");

    act(() => buttonByText("Delete location", dialog()).click());
    expect(h.deleteLocation).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Delete “Airport”?");
    act(() => buttonByText("Keep location", dialog()).click());
    expect(dialog().querySelector("#v2-location-active")).not.toBeNull();

    act(() => buttonByText("Delete location", dialog()).click());
    await act(async () => buttonByText("Delete location", dialog()).click());
    expect(h.deleteLocation).toHaveBeenCalledWith("l1");
    expect(h.refetchLocations).toHaveBeenCalledTimes(1);
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("v2: editing a delivery+collection location keeps both flags", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", address: "1 Terminal Rd", description: null, delivery_fee: 10 })],
    });
    pickup.value = h;
    renderV2Page();
    act(() => (container.querySelector('ul[aria-label="Delivery locations"] button') as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    await act(async () => buttonByText("Save", dialog).click());
    expect(h.updateLocation).toHaveBeenCalledWith({
      id: "l1",
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 10,
    });
  });

  it("v2: switching a location off in its dialog is written by the dialog's Save, not the page's", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", address: "1 Terminal Rd", description: null, delivery_fee: 10 })],
    });
    pickup.value = h;
    const onDirtyChangeV2 = vi.fn();
    renderV2Page({ onDirtyChangeV2 });
    act(() => (container.querySelector('ul[aria-label="Delivery locations"] button') as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    act(() => (dialog.querySelector("#v2-location-active") as HTMLButtonElement).click());
    expect(h.updateLocation).not.toHaveBeenCalled();
    expect(onDirtyChangeV2).not.toHaveBeenCalledWith(true);
    await act(async () => buttonByText("Save", dialog).click());
    expect(h.updateLocation).toHaveBeenCalledWith({
      id: "l1",
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 10,
      is_active: false,
    });
  });

  it("v2: reports clean once the page closes", () => {
    pickup.value = hook();
    const onDirtyChangeV2 = vi.fn();
    renderV2Page({ onDirtyChangeV2 });
    act(() => typeInto(input("#v2-pickup-address"), "2 Depot Way"));
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(true);
    render(null);
    expect(onDirtyChangeV2).toHaveBeenLastCalledWith(false);
  });

  it("v2 view-only: controls are locked and nothing registers, but list search and Try again still work", () => {
    perms.edit = false;
    const many = Array.from({ length: 9 }, (_, i) => location({ id: `l${i}`, name: `Stop ${i}`, description: null }));
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true, return_multiple_locations_enabled: true }),
      locations: many,
      settingsError: new Error("Failed to fetch"),
    });
    pickup.value = h;
    const registerSave = vi.fn();
    renderV2({ registerSave });
    const search = container.querySelector('input[aria-label="Search delivery locations"]') as HTMLInputElement;
    expect(search.disabled).toBe(false);
    const retry = container.querySelector('[aria-label="Try loading your pickup and return settings again"]') as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    act(() => retry.click());
    expect(h.refetchSettings).toHaveBeenCalledTimes(1);
    expect(input("#v2-pickup-address").disabled).toBe(true);
    const switches = Array.from(container.querySelectorAll('[role="switch"]')) as HTMLButtonElement[];
    expect(switches).toHaveLength(6);
    expect(switches.every((el) => el.disabled)).toBe(true);
    expect(container.querySelectorAll("li button")).toHaveLength(0);
    expect(container.textContent).not.toContain("Add location");
    expect(registerSave).not.toHaveBeenCalledWith("locations", expect.any(Function), expect.anything());

    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locationsError: new Error("Failed to fetch"),
    });
    renderV2();
    const listRetry = container.querySelector('[aria-label="Try loading your delivery locations again"]') as HTMLButtonElement;
    expect(listRetry.disabled).toBe(false);
  });

  it("v1 (flag off): renders the original controls and none of the v2 states", () => {
    pickup.value = hook({ locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }) });
    const onDirtyChange = vi.fn();
    render(<LocationSettings onDirtyChange={onDirtyChange} />);
    expect(container.querySelector("[data-settings-state]")).toBeNull();
    expect(container.textContent).toContain("No locations added");
    expect(buttonByText("Save Changes", container)).toBeTruthy();
  });
});
