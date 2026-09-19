/**
 * InstallmentSettings, v2 (northwind) states, and v1 untouched.
 *
 * "Save changes" writes the whole installment_config, so a form over
 * placeholder defaults or a failed read would overwrite plan minimums, limits
 * and the retry policy. These tests pin: skeleton / error instead of that form,
 * the dirty + save-error state, the no-plan and no-provider notices, the saved
 * minimum days, read-only, and that a v1 tenant sees none of it.
 *
 * Since Sep 19 2026 the v2 page is one form saved by the settings page's save
 * bar: the checkout switch and the plans are a draft, the page gets the save
 * and discard, and leaving with edits asks "Save your changes?". The settings
 * page is too large to mount, so the last block wires the section to the same
 * registry, save bar, leave guard and dialog the page uses.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
const flags = vi.hoisted(() => ({ v2: true, edit: true }));
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => flags.v2,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => flags.edit, canViewSettings: () => true }),
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: toastSpy, useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/components/installments/InstallmentCalendar", () => ({ InstallmentCalendar: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { useCallback, useRef, useState } from "react";
import { InstallmentSettings } from "@/components/settings/InstallmentSettings";
import { SettingsPageSaveProvider, SettingsStickySaveBar } from "@/components/settings-v2/settings-kit";
import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";
import { useLeaveGuardV2 } from "@/hooks/use-leave-guard-v2";
import { runThroughLeaveGuard } from "@/lib/leave-guard";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";

let container: HTMLDivElement;
let root: Root;

const savedConfig = {
  weekly_enabled: false,
  weekly_payments_per_unit: 1,
  monthly_enabled: false,
  monthly_payments_per_unit: 1,
  minimum_days_weekly: 14,
  minimum_days_monthly: 45,
  weekly_installments_limit: 4,
  grace_period_days: 3,
};

function api(overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    settings: { installments_enabled: true, installment_config: savedConfig, ...settings },
    hasLoaded: true,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({}),
    isUpdating: false,
    ...overrides,
  };
}

function render(props: Record<string, unknown> = {}) {
  act(() => root.render(<InstallmentSettings {...props} />));
}
const text = () => container.textContent ?? "";
const saveButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Save changes") as
    | HTMLButtonElement
    | undefined;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  flags.v2 = true;
  flags.edit = true;
  toastSpy.mockClear();
  nav.push.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("InstallmentSettings v2 states", () => {
  it("shows a skeleton, with no Save and no switch, until the real row arrives", () => {
    rs.current = api({ hasLoaded: false });
    render();
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(saveButton()).toBeUndefined();
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("shows the load error instead of a default form after a failed read", () => {
    rs.current = api({ hasLoaded: false, error: new Error("Failed to fetch") });
    render();
    expect(text()).toContain("Couldn't load installment settings");
    expect(saveButton()).toBeUndefined();
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"))!;
    act(() => retry.click());
    expect(rs.current.refetch).toHaveBeenCalledTimes(1);
  });

  it("warns that no plan is on, that no provider is connected, and shows the minimum days checkout applies", () => {
    rs.current = api();
    render();
    expect(text()).toContain("Installments is on, but no plan is enabled");
    expect(text()).toContain("No payment provider is connected");
    // Cadence shape: New Rental and checkout use 7 / 30 days. Checkout's section
    // gate is min(14, 45) = 14, which only moves the weekly plan (online).
    expect(text()).toContain("Available for rentals 7+ days (14+ when booked online)");
    expect(text()).toContain("Available for rentals 30+ days");
    expect(text()).not.toContain("45+");
    // Nothing changed yet, so nothing to save.
    expect(saveButton()!.disabled).toBe(true);
  });

  it("drops the provider notice once Stripe is usable", () => {
    rs.current = api({}, { own_stripe_account_id: "acct_1" });
    render();
    expect(text()).not.toContain("No payment provider is connected");
  });

  it("marks a plan toggle as unsaved, saves the merged config, and keeps it dirty with the error on failure", async () => {
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
    render();
    const weekly = container.querySelector<HTMLButtonElement>("#weekly-enabled")!;
    act(() => weekly.click());
    expect(text()).toContain("Unsaved changes");
    expect(saveButton()!.disabled).toBe(false);

    await act(async () => saveButton()!.click());
    // Every saved key the section does not own is carried through unchanged.
    expect(rs.current.updateSettings).toHaveBeenCalledWith({
      installment_config: { ...savedConfig, weekly_enabled: true },
    });
    expect(text()).toContain("Couldn't save.");
    expect(saveButton()!.disabled).toBe(false);
  });

  it("disables the controls and hides Save for a read-only user", () => {
    flags.edit = false;
    rs.current = api();
    render();
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    expect(container.querySelector("fieldset[data-read-only]")).not.toBeNull();
    expect(saveButton()).toBeUndefined();
  });

  it("keeps See example usable for a read-only user while every plan control is disabled", () => {
    flags.edit = false;
    rs.current = api({}, { installment_config: { ...savedConfig, weekly_enabled: true, monthly_enabled: true } });
    render();
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    expect(switches).toHaveLength(3);
    expect(switches.every((s) => s.disabled)).toBe(true);
    const pills = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) => /^\d×/.test(b.textContent ?? ""));
    expect(pills.length).toBe(5);
    expect(pills.every((b) => b.disabled)).toBe(true);
    const examples = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent?.includes("See example"));
    expect(examples).toHaveLength(2);
    // Not disabled, and not inside a disabled fieldset either.
    expect(examples.every((b) => !b.matches(":disabled"))).toBe(true);
  });

  it("registers unsaved plans with the page's leave guard, and the leave save rejects when the write fails", async () => {
    const registerSave = vi.fn();
    const failure = new Error("Failed to fetch");
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(failure) });
    render({ registerSave });
    expect(registerSave).toHaveBeenLastCalledWith("installments", null);
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    const [key, leaveSave] = registerSave.mock.calls[registerSave.mock.calls.length - 1];
    expect(key).toBe("installments");
    expect(typeof leaveSave).toBe("function");
    let rejected: unknown = null;
    await act(async () => {
      await (leaveSave as () => Promise<void>)().catch((err) => {
        rejected = err;
      });
    });
    expect(rejected).toBe(failure);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ installment_config: { ...savedConfig, weekly_enabled: true } });
    expect(text()).toContain("Couldn't save.");
  });

  it("does not register a view-only user's plans with the leave guard", () => {
    flags.edit = false;
    const registerSave = vi.fn();
    rs.current = api();
    render({ registerSave });
    expect(registerSave.mock.calls.every(([, save]) => save === null)).toBe(true);
  });
});

/** The five plan pills when both plans are on: weekly 1× 2×, monthly 1× 2× 4×. */
const pillButtons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) => /^\d×/.test(b.textContent ?? ""));
const bothPlansOn = { installment_config: { ...savedConfig, weekly_enabled: true, monthly_enabled: true } };

describe("InstallmentSettings plan pills", () => {
  it("v2: every pill is rounded-full, and an unselected pill hovers with the purple pair", () => {
    rs.current = api({}, bothPlansOn);
    render();
    const pills = pillButtons();
    expect(pills.map((b) => b.textContent)).toEqual(["1×", "2× (twice weekly)", "1×", "2×", "4×"]);
    for (const pill of pills) {
      expect(pill.classList.contains("rounded-full")).toBe(true);
      expect(pill.classList.contains("rounded-md")).toBe(false);
    }
    // Saved per-unit is 1 for both plans, so pills 1 and 3 are selected.
    for (const i of [1, 3, 4]) {
      expect(pills[i].classList.contains("hover:bg-primary/10")).toBe(true);
      expect(pills[i].classList.contains("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]")).toBe(true);
      expect(pills[i].classList.contains("hover:bg-muted/40")).toBe(false);
    }
  });

  it("v2: the chosen pill is in the brand colour (light in dark mode), not a fixed indigo, and says it is chosen", () => {
    rs.current = api({}, bothPlansOn);
    render();
    const pills = pillButtons();
    // Saved per-unit is 1 for both plans: pills 0 ("1×" weekly) and 2 ("1×" monthly).
    expect(pills.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "true", "false", "false"]);
    for (const i of [0, 2]) {
      const cls = pills[i].className.split(/\s+/);
      expect(cls).toContain("text-primary");
      expect(cls).toContain("dark:text-[hsl(var(--v2-link,var(--primary)))]");
      expect(cls.some((c) => c.includes("indigo"))).toBe(false);
    }
  });

  it("v1: the pills keep v1's exact class lists", () => {
    flags.v2 = false;
    rs.current = api({}, bothPlansOn);
    render();
    const pills = pillButtons();
    expect(pills).toHaveLength(5);
    const selected = "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors bg-primary/15 border-indigo-500/50 text-indigo-700 dark:text-indigo-300";
    const unselected = "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors bg-card border-border text-muted-foreground hover:bg-muted/40";
    expect(pills.map((b) => b.className)).toEqual([selected, unselected, selected, unselected, unselected]);
  });
});

describe("InstallmentSettings v1 is unchanged", () => {
  it("renders the v1 form over defaults with none of the v2 states", () => {
    flags.v2 = false;
    rs.current = api({ hasLoaded: false }, { installments_enabled: false, installment_config: null });
    render();
    expect(text()).toContain("Enable Installments");
    expect(text()).toContain("Available for rentals 7+ days");
    expect(container.querySelector("[data-settings-state]")).toBeNull();
    expect(container.querySelector("fieldset[data-read-only]")).toBeNull();
    expect(saveButton()!.disabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* v2: one form, saved by the page's save bar                                  */
/* -------------------------------------------------------------------------- */

const masterSwitch = () =>
  container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Offer installments at checkout"]')!;
/** The last registration under "installments" that carried a save: [key, save, discard]. */
const lastRegistration = (registerSave: ReturnType<typeof vi.fn>) => {
  const calls = registerSave.mock.calls.filter((call) => call[0] === "installments" && call[1]);
  return calls[calls.length - 1] as [string, () => Promise<unknown>, () => void] | undefined;
};

describe("InstallmentSettings v2 inside the page's save bar", () => {
  function renderInPage(registerSave: ReturnType<typeof vi.fn>) {
    act(() =>
      root.render(
        <SettingsPageSaveProvider>
          <InstallmentSettings registerSave={registerSave as unknown as RegisterSectionSave} />
        </SettingsPageSaveProvider>,
      ),
    );
  }

  it("shows no Save of its own, and the checkout switch is a draft, not an instant write", () => {
    const registerSave = vi.fn();
    rs.current = api({}, { installments_enabled: false });
    renderInPage(registerSave);
    expect(saveButton()).toBeUndefined();
    expect(registerSave).toHaveBeenLastCalledWith("installments", null);

    act(() => masterSwitch().click());
    expect(masterSwitch().getAttribute("aria-checked")).toBe("true");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    expect(lastRegistration(registerSave)).toBeDefined();
    // Still no Save, and no "Unsaved changes" chip: the page's bar says it.
    expect(saveButton()).toBeUndefined();
    expect(text()).not.toContain("Unsaved changes");
  });

  it("the page's save writes the switch and the plans in ONE update, keeping every other saved key", async () => {
    const registerSave = vi.fn();
    rs.current = api({}, { installments_enabled: false });
    renderInPage(registerSave);
    act(() => masterSwitch().click());
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    const [, save] = lastRegistration(registerSave)!;
    await act(async () => {
      await save();
    });
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({
      installments_enabled: true,
      installment_config: {
        weekly_enabled: true,
        weekly_payments_per_unit: 1,
        monthly_enabled: false,
        monthly_payments_per_unit: 1,
        minimum_days_weekly: 14,
        minimum_days_monthly: 45,
        weekly_installments_limit: 4,
        grace_period_days: 3,
      },
    });
  });

  it("the page's Reset puts the switch and the plans back and tells the page it is clean", () => {
    const registerSave = vi.fn();
    rs.current = api({}, { installments_enabled: true });
    renderInPage(registerSave);
    act(() => container.querySelector<HTMLButtonElement>("#monthly-enabled")!.click());
    act(() => masterSwitch().click());
    expect(masterSwitch().getAttribute("aria-checked")).toBe("false");
    const [, , discard] = lastRegistration(registerSave)!;
    act(() => discard());
    expect(masterSwitch().getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("#monthly-enabled")!.getAttribute("aria-checked")).toBe("false");
    expect(registerSave).toHaveBeenLastCalledWith("installments", null);
  });

  it("a failed save rejects for the page, and says why beside the form without a Retry of its own", async () => {
    const registerSave = vi.fn();
    const failure = { code: "42501", message: "permission denied for table tenants" };
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(failure) });
    renderInPage(registerSave);
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    const [, save] = lastRegistration(registerSave)!;
    let rejected: unknown = null;
    await act(async () => {
      await save().catch((err) => {
        rejected = err;
      });
    });
    expect(rejected).toBe(failure);
    expect(container.querySelector('[data-settings-state="save-error"]')?.textContent).toBe(
      "Couldn't save. You don't have permission to change this. Ask an admin.",
    );
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Retry"))).toBe(false);
  });
});

/**
 * The settings page's wiring around a section, in miniature: the registry
 * (`registerV2SectionSave`), the one save bar, the v2 leave guard and its
 * dialog, and a link to another screen.
 */
function PageHarness() {
  const saves = useRef<Record<string, () => Promise<unknown>>>({});
  const discards = useRef<Record<string, () => void>>({});
  const [dirty, setDirty] = useState<string[]>([]);
  const register = useCallback<RegisterSectionSave>((key, save, discard) => {
    if (save) saves.current[key] = save;
    else delete saves.current[key];
    if (save && discard) discards.current[key] = discard;
    else delete discards.current[key];
    setDirty((prev) => (prev.includes(key) === !!save ? prev : save ? [...prev, key] : prev.filter((k) => k !== key)));
  }, []);
  const saveAll = async () => {
    const results = await Promise.allSettled(Object.values(saves.current).map((save) => save()));
    return results.every((result) => result.status === "fulfilled");
  };
  const reset = () => Object.values(discards.current).forEach((discard) => discard());
  const guard = useLeaveGuardV2({ enabled: true, isDirty: dirty.length > 0, canSave: true, onSave: saveAll, onDiscard: reset });
  return (
    <>
      <a href="/rentals">Rentals</a>
      <SettingsPageSaveProvider>
        <InstallmentSettings registerSave={register} />
      </SettingsPageSaveProvider>
      <SettingsStickySaveBar dirty={dirty.length > 0} saving={guard.saving} onSave={() => void saveAll()} onReset={reset} />
      <LeaveDialogV2
        open={guard.open}
        canSave={guard.canSave}
        saving={guard.saving}
        onSave={() => void guard.save()}
        onDiscard={guard.discard}
        onCancel={guard.cancel}
      />
    </>
  );
}

describe("InstallmentSettings v2 with the page's save bar and leave dialog", () => {
  const bodyText = () => document.body.textContent ?? "";
  const dialogButton = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
      (b) => b.textContent?.trim() === label,
    );
  const barButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-settings-save-bar] button')).find(
      (b) => b.textContent?.trim() === label,
    );
  const renderPage = () => act(() => root.render(<PageHarness />));

  it("with nothing changed, leaving asks nothing and the bar has nothing to save", () => {
    rs.current = api();
    renderPage();
    expect(barButton("Save changes")!.disabled).toBe(true);
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toContain("Save your changes?");
  });

  it("an edit lights the bar; its Save changes writes the plans", async () => {
    rs.current = api();
    renderPage();
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    expect(container.querySelector("[data-settings-save-bar]")!.textContent).toContain("Unsaved changes");
    await act(async () => barButton("Save changes")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ installment_config: { ...savedConfig, weekly_enabled: true } });
  });

  it("leaving by a link with an edit asks; Don't save puts the plans back and leaves", () => {
    rs.current = api();
    renderPage();
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    act(() => container.querySelector<HTMLAnchorElement>('a[href="/rentals"]')!.click());
    expect(bodyText()).toContain("Save your changes?");
    expect(nav.push).not.toHaveBeenCalled();

    act(() => dialogButton("Don't save")!.click());
    expect(container.querySelector("#weekly-enabled")!.getAttribute("aria-checked")).toBe("false");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/rentals");
  });

  it("Save in the dialog writes the edit, then leaves", async () => {
    rs.current = api();
    renderPage();
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(bodyText()).toContain("Save your changes?");
    expect(proceed).not.toHaveBeenCalled();

    await act(async () => dialogButton("Save")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ installment_config: { ...savedConfig, weekly_enabled: true } });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("a failed save in the dialog keeps the page and the edit", async () => {
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
    renderPage();
    act(() => container.querySelector<HTMLButtonElement>("#weekly-enabled")!.click());
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    await act(async () => dialogButton("Save")!.click());
    expect(proceed).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Save your changes?");
    expect(container.querySelector("#weekly-enabled")!.getAttribute("aria-checked")).toBe("true");
  });
});
