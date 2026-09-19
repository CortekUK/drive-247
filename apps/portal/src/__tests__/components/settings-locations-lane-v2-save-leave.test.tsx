/**
 * v2 Settings → Locations (team lead review, Sep 19 2026): the page save bar
 * and the leave dialog still cover the restyled page. The area's price now
 * edits through a dialog whose Done only changes the form, so this checks that
 * an edit made there, and one made in a row, are both saved by the bar or the
 * leave dialog's Save, dropped by "Don't save", and held when invalid.
 *
 * The settings page is too large to mount, so the harness wires the parts the
 * way `settings/page.tsx` does (the same shape as
 * settings-general-lane-save-leave-v2.test.tsx): `registerV2SectionSave`,
 * `SettingsPageSaveProvider`, `SettingsStickySaveBar`, `useLeaveGuardV2` and
 * `LeaveDialogV2`, around the real `LocationSettings`.
 *
 * Every expected value is worked out by hand beside it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());
const pickup = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const tenantState = vi.hoisted(() => ({ unit: "miles" as "km" | "miles" }));

vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
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
import { SettingsPageSaveProvider, SettingsStickySaveBar } from "@/components/settings-v2/settings-kit";
import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { useLeaveGuardV2 } from "@/hooks/use-leave-guard-v2";
import { V2Provider } from "@/lib/v2-context";

const SetupResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  toastMock.mockReset();
  tenantState.unit = "miles";
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

const buttonNamed = (name: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const saveChanges = () => buttonNamed("Save changes")!;
const leaveDialog = () => document.querySelector('[data-leave-dialog="v2"]') as HTMLElement | null;
const priceDialog = () => document.querySelector('[role="dialog"]:not([data-leave-dialog])') as HTMLElement | null;
const radius = () => document.getElementById("v2-pickup-area-radius") as HTMLInputElement;
const summary = () => document.querySelector("[data-area-price-summary]")?.textContent;

/** `registerV2SectionSave`, the save bar and the leave guard, as the settings page wires them. */
function PageHarness({ children }: { children: (register: RegisterSectionSave) => ReactNode }) {
  const saves = useRef<Record<string, () => Promise<unknown>>>({});
  const discards = useRef<Record<string, () => void>>({});
  const [dirtySections, setDirtySections] = useState<string[]>([]);
  const register = useCallback<RegisterSectionSave>((key, save, discard) => {
    if (save) saves.current[key] = save;
    else delete saves.current[key];
    if (save && discard) discards.current[key] = discard;
    else delete discards.current[key];
    setDirtySections((prev) => (prev.includes(key) === !!save ? prev : save ? [...prev, key] : prev.filter((k) => k !== key)));
  }, []);
  const saveAll = async () => {
    const results = await Promise.allSettled(Object.values(saves.current).map((save) => Promise.resolve(save())));
    return !results.some((result) => result.status === "rejected");
  };
  const reset = () => Object.values(discards.current).forEach((discard) => discard());
  const dirty = dirtySections.length > 0;
  const guard = useLeaveGuardV2({ enabled: true, isDirty: dirty, canSave: true, onSave: saveAll, onDiscard: reset });
  return (
    <>
      <SettingsPageSaveProvider enabled>{children(register)}</SettingsPageSaveProvider>
      <SettingsStickySaveBar dirty={dirty} saving={false} onSave={() => void saveAll()} onReset={reset} />
      <LeaveDialogV2
        open={guard.open}
        canSave={guard.canSave}
        saving={guard.saving}
        onSave={() => void guard.save()}
        onDiscard={guard.discard}
        onCancel={guard.cancel}
      />
      <a href="/vehicles">Leave for Vehicles</a>
    </>
  );
}

/** Stored in km: a 40 km radius, a 12 flat fee, a center point, pickup area on. */
const settingsRow = (over: Record<string, unknown> = {}) =>
  ({
    pickup_location_mode: "custom",
    return_location_mode: "custom",
    fixed_pickup_address: "1 Depot Way",
    fixed_return_address: null,
    pickup_area_radius_km: 40,
    return_area_radius_km: 40,
    area_center_lat: 51.47,
    area_center_lon: -0.45,
    fixed_address_enabled: true,
    multiple_locations_enabled: false,
    area_around_enabled: true,
    area_delivery_fee: 12,
    delivery_tiers_enabled: false,
    delivery_distance_tiers: [],
    delivery_max_distance_km: null,
    pickup_fixed_enabled: true,
    return_fixed_enabled: true,
    pickup_multiple_locations_enabled: false,
    return_multiple_locations_enabled: false,
    pickup_area_enabled: true,
    return_area_enabled: false,
    ...over,
  }) as any;

const hook = () => ({
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
});

const mount = () => {
  const h = hook();
  pickup.value = h;
  render(
    <V2Provider flags={{ chrome: true }}>
      <PageHarness>{(register) => <LocationSettings registerSave={register} />}</PageHarness>
    </V2Provider>,
  );
  return h;
};

/** One fee: open the price dialog from the row's Edit, type a fee, press Done. */
const setOneFee = (fee: string) => {
  act(() => (document.querySelector('button[aria-label="Edit delivery price"]') as HTMLButtonElement).click());
  fireEvent.change(document.getElementById("v2-area-fee") as HTMLInputElement, { target: { value: fee } });
  act(() => buttonNamed("Done", priceDialog()!)!.click());
};

describe("v2 Locations: save bar and leave dialog after the review", () => {
  it("a fee set in the price dialog is only unsaved until the leave dialog's Save writes it, then the page is left", async () => {
    const h = mount();
    // Stored 40 km at 0.621371 = 24.85484 -> 24.9 mi.
    expect(radius().value).toBe("24.9");
    expect(saveChanges().disabled).toBe(true);

    setOneFee("30");
    // Done wrote nothing; the bar now holds the edit.
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(summary()).toBe("One fee: $30.00");
    expect(saveChanges().disabled).toBe(false);

    act(() => screen.getByText("Leave for Vehicles").click());
    expect(leaveDialog()).not.toBeNull();
    act(() => buttonNamed("Save", leaveDialog()!)!.click());
    await flush();

    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    // The fee as typed. The radius was not touched: it still shows 24.9 mi,
    // which is what the stored 40 km shows as, so the stored 40 km goes back
    // exactly. (Converting 24.9 mi would give 24.9 / 0.621371 = 40.0727
    // -> 40.1 km: a 0.1 km drift on every save.)
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({
      area_delivery_fee: 30,
      delivery_tiers_enabled: false,
      pickup_area_radius_km: 40,
      area_center_lat: 51.47,
      area_center_lon: -0.45,
    });
    expect(nav.push).toHaveBeenCalledWith("/vehicles");
  });

  it("km tenant: a radius typed in the row is saved by the bar in km as typed (60 km -> 60)", async () => {
    tenantState.unit = "km";
    const h = mount();
    expect(radius().value).toBe("40");
    fireEvent.change(radius(), { target: { value: "60" } });
    expect(saveChanges().disabled).toBe(false);

    act(() => saveChanges().click());
    await flush();
    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    expect(h.updateSettings.mock.calls[0][0]).toMatchObject({
      pickup_area_radius_km: 60,
      // Return's area is off, but a used area writes both radii: its stored 40 km unchanged.
      return_area_radius_km: 40,
      area_delivery_fee: 12,
    });
  });

  it("Don't save drops a price-dialog edit and a row edit, writes nothing, and leaves", async () => {
    tenantState.unit = "km";
    const h = mount();
    setOneFee("30");
    fireEvent.change(radius(), { target: { value: "75" } });
    expect(summary()).toBe("One fee: $30.00");

    act(() => screen.getByText("Leave for Vehicles").click());
    act(() => buttonNamed("Don't save", leaveDialog()!)!.click());
    await flush();

    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/vehicles");
    // Both back to what is stored: a 12 fee and 40 km.
    expect(summary()).toBe("One fee: $12.00");
    expect(radius().value).toBe("40");
  });

  it("an invalid radius keeps the leave dialog open, writes nothing and stays on the page", async () => {
    const h = mount();
    fireEvent.change(radius(), { target: { value: "0" } });
    expect(document.body.textContent).toContain("Radius must be at least 1 mi.");

    act(() => screen.getByText("Leave for Vehicles").click());
    act(() => buttonNamed("Save", leaveDialog()!)!.click());
    await flush();

    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(leaveDialog()).not.toBeNull();
  });
});

describe("v1 (flag off) keeps its own page", () => {
  it("the original cards, copy and toast, none of the review's layout", () => {
    // Only the address option on, on both sides.
    const h = { ...hook(), locationSettings: settingsRow({ pickup_area_enabled: false, area_around_enabled: false }) };
    pickup.value = h;
    const onDirtyChange = vi.fn();
    render(<LocationSettings onDirtyChange={onDirtyChange} />);
    const headings = Array.from(document.querySelectorAll("h2")).map((el) => el.textContent);
    expect(headings).toContain("Pickup Options");
    expect(document.body.textContent).toContain("How customers receive vehicles");
    expect(document.body.textContent).not.toContain("Pickup and delivery");
    expect(document.querySelector("[data-location-section]")).toBeNull();
    expect(document.querySelector("[data-location-notice]")).toBeNull();
    expect(document.querySelector("[data-area-price-summary]")).toBeNull();

    // v1 still toasts when the last pickup option is switched off, and keeps it on.
    const first = document.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(first.getAttribute("aria-checked")).toBe("true");
    act(() => first.click());
    expect(toastMock).toHaveBeenCalledWith({
      title: "Required",
      description: "At least one pickup option must be enabled.",
      variant: "destructive",
    });
    expect(first.getAttribute("aria-checked")).toBe("true");
    expect(h.updateSettings).not.toHaveBeenCalled();
  });
});

describe("v2 Locations: Delete stays in the toned-down red", () => {
  it("the row's Delete and its confirm button both use the contrast-corrected ink, and nothing is deleted until confirmed", async () => {
    const h = {
      ...hook(),
      locationSettings: settingsRow({ pickup_multiple_locations_enabled: true }),
      locations: [
        {
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
        },
      ],
    };
    pickup.value = h;
    render(
      <V2Provider flags={{ chrome: true }}>
        <PageHarness>{(register) => <LocationSettings registerSave={register} />}</PageHarness>
      </V2Provider>,
    );
    const rowDelete = document.querySelector('button[aria-label="Delete Airport"]') as HTMLButtonElement;
    expect(rowDelete.className.split(/\s+/)).toContain("panel-ink-danger");
    act(() => rowDelete.click());
    expect(h.deleteLocation).not.toHaveBeenCalled();
    const confirm = buttonNamed("Delete location", priceDialog()!)!;
    expect(confirm.className.split(/\s+/)).toEqual(expect.arrayContaining(["panel-ink-danger", "bg-destructive/10"]));
    await act(async () => confirm.click());
    expect(h.deleteLocation).toHaveBeenCalledWith("l1");
  });
});
