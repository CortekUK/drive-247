/**
 * v2 Settings → Business (General, Locations, Appearance) states.
 *
 * Pins the rules the northwind pages rely on, with hand-worked expectations:
 *   - a placeholder read is never the tenant's configuration,
 *   - a zero-row or failed tenants write is never a save,
 *   - editing a location never moves it between the delivery/collection lists,
 *   - radius / fee / name limits, and the "nothing active" dependency,
 *   - the Locations page does not report unsaved changes on mount (the v1 bug),
 *     and v1 renders exactly as before when the chrome flag is off.
 *
 * HARNESS: `react-dom/client` + `act`, same as settings-section-states.test.tsx
 * (the repo lacks @testing-library/dom).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useState } from "react";
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
import { SettingsPageSaveProvider } from "@/components/settings-v2/settings-kit";

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
      "Add at least one price band, or turn off tiered pricing.",
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
    onEdit: vi.fn(),
    onConfirmDelete: vi.fn(),
    onToggleActive: vi.fn(),
    isUpdating: false,
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

  it("empty explains what a location is and offers the first one (not to viewers)", () => {
    const p = listProps();
    render(<LocationsListV2 {...p} />);
    expect(container.textContent).toContain("No delivery locations yet");
    act(() => buttonByText("Add your first location", container).click());
    expect(p.onAdd).toHaveBeenCalledTimes(1);

    render(<LocationsListV2 {...listProps({ side: "return", readOnly: true })} />);
    expect(container.textContent).toContain("No collection locations yet");
    expect(container.textContent).not.toContain("Add your first location");
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

  it("shows a 0 fee as Free, money in the tenant currency, and row actions", () => {
    const rows = [location({ id: "a", name: "Free spot", delivery_fee: 0 }), location({ id: "b", name: "Airport", delivery_fee: 12.5 })];
    const p = listProps({ locations: rows });
    render(<LocationsListV2 {...p} />);
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("Free");
    expect(items[1].textContent).toContain("12.50");
    act(() => (container.querySelector('[aria-label="Edit Airport"]') as HTMLButtonElement).click());
    expect(p.onEdit).toHaveBeenCalledWith(rows[1]);
    act(() => (container.querySelector('[aria-label="Delete Airport"]') as HTMLButtonElement).click());
    expect(p.onConfirmDelete).toHaveBeenCalledWith("b", "Airport");
  });

  it("a row being deleted says so and offers no actions", () => {
    const rows = [location({ id: "a", name: "Airport" }), location({ id: "b", name: "Harbour" })];
    render(<LocationsListV2 {...listProps({ locations: rows, pendingDeleteId: "a" })} />);
    const items = container.querySelectorAll("li");
    expect(items[0].getAttribute("aria-busy")).toBe("true");
    expect(items[0].textContent).toContain("Deleting…");
    expect(container.querySelector('[aria-label="Delete Airport"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Harbour"]')).not.toBeNull();
  });

  it("view-only: no add, edit or delete, and the active switch is disabled", () => {
    render(<LocationsListV2 {...listProps({ locations: [location()], readOnly: true })} />);
    expect(container.querySelector('[aria-label^="Edit"]')).toBeNull();
    expect(container.textContent).not.toContain("Add location");
    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Locations: the page component, v2 vs v1                                     */
/* -------------------------------------------------------------------------- */

describe("LocationSettings", () => {
  const hook = (over: Record<string, unknown> = {}) => ({
    locationSettings: settingsRow(),
    isLoadingSettings: false,
    hasSettingsData: true,
    settingsError: null,
    refetchSettings: vi.fn(),
    isFetchingSettings: false,
    settingsUpdateError: null,
    updateSettings: vi.fn(async () => ({})),
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

  it("v2: a skeleton while the settings are still the placeholder", () => {
    pickup.value = hook({ hasSettingsData: false });
    renderV2();
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Pickup Options");
  });

  it("v2: a failed read shows a retry, never the default form", () => {
    const h = hook({ hasSettingsData: false, settingsError: new Error("Failed to fetch") });
    pickup.value = h;
    renderV2();
    expect(container.textContent).toContain("Couldn't load your pickup and return settings");
    expect(container.textContent).not.toContain("Save changes");
    act(() => buttonByText("Try again", container).click());
    expect(h.refetchSettings).toHaveBeenCalledTimes(1);
  });

  it("v2: loaded with no edits is clean (Save disabled, not reported dirty)", () => {
    pickup.value = hook();
    const onDirtyChangeV2 = vi.fn();
    renderV2({ onDirtyChangeV2 });
    expect(buttonByText("Save changes", container).disabled).toBe(true);
    expect(onDirtyChangeV2).not.toHaveBeenCalledWith(true);
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("v2: warns when Delivery Locations is on but none are active", () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ is_active: false, is_return_enabled: false })],
    });
    renderV2();
    expect(container.textContent).toContain("No active delivery locations");
  });

  it("v2: editing a delivery+collection location keeps both flags", async () => {
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ name: "Airport", address: "1 Terminal Rd", description: null, delivery_fee: 10 })],
    });
    pickup.value = h;
    renderV2();
    act(() => (container.querySelector('[aria-label="Edit Airport"]') as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    await act(async () => buttonByText("Save Changes", dialog).click());
    expect(h.updateLocation).toHaveBeenCalledWith({
      id: "l1",
      name: "Airport",
      address: "1 Terminal Rd",
      description: null,
      delivery_fee: 10,
    });
  });

  it("v2 view-only: controls are locked, but list search and Try again still work", () => {
    perms.edit = false;
    const many = Array.from({ length: 9 }, (_, i) => location({ id: `l${i}`, name: `Stop ${i}`, description: null }));
    const h = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true, return_multiple_locations_enabled: true }),
      locations: many,
      settingsError: new Error("Failed to fetch"),
    });
    pickup.value = h;
    renderV2();
    const disabledBy = (el: Element) => (el as HTMLInputElement).disabled || !!el.closest("fieldset:disabled");
    const search = container.querySelector('input[aria-label="Search delivery locations"]') as HTMLInputElement;
    expect(disabledBy(search)).toBe(false);
    const retry = container.querySelector('[aria-label="Try loading your pickup and return settings again"]')!;
    expect(disabledBy(retry)).toBe(false);
    act(() => (retry as HTMLButtonElement).click());
    expect(h.refetchSettings).toHaveBeenCalledTimes(1);
    const address = container.querySelector('input[placeholder="Enter your pickup address..."]')!;
    expect(disabledBy(address)).toBe(true);
    const optionSwitches = Array.from(container.querySelectorAll('[role="switch"]')).filter((el) => !el.closest("ul"));
    expect(optionSwitches.length).toBe(6);
    expect(optionSwitches.every(disabledBy)).toBe(true);
    expect(container.textContent).not.toContain("Save changes");

    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locationsError: new Error("Failed to fetch"),
    });
    renderV2();
    const listRetry = container.querySelector('[aria-label="Try loading your delivery locations again"]')!;
    expect(disabledBy(listRetry)).toBe(false);
  });

  it("v2: a validation message beside Save offers no Retry (it would only fail again)", async () => {
    pickup.value = hook({
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [location({ is_active: false, is_return_enabled: false })],
    });
    renderV2();
    const address = container.querySelector('input[placeholder="Enter your pickup address..."]') as HTMLInputElement;
    act(() => typeInto(address, "1 Depot Way, Unit 2"));
    await act(async () => buttonByText("Save changes", container).click());
    const status = container.querySelector('[data-settings-state="save-error"]');
    expect(status?.textContent).toContain("Delivery locations is on but none are active.");
    expect(status?.textContent).not.toContain("Retry");
  });

  it("v2: a failed write keeps Retry", () => {
    pickup.value = hook({ settingsUpdateError: { message: "permission denied for table tenants", code: "42501" } });
    renderV2();
    const status = container.querySelector('[data-settings-state="save-error"]');
    expect(status?.textContent).toContain("You don't have permission to change this.");
    expect(status?.textContent).toContain("Retry");
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
