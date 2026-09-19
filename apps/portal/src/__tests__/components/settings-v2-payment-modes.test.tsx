/**
 * v2 Pay As You Go and Auto-extension pages (`settings-v2/payment-modes-v2`).
 *
 * Both pages are forms that save through the settings page's one save bar
 * (Sep 19 2026; they used to write each control the moment it changed). The
 * states that matter are the ones that could write a wrong value: no switch
 * over placeholder defaults or after a failed read, a change is a draft until
 * saved and only changed keys are written, a failed save keeps the edit and
 * says why, read-only users cannot operate anything, and a bad number is never
 * saved. Inside the page's save bar the form shows no Save of its own and
 * hands the page its save and discard.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
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

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { useCallback, useRef, useState } from "react";
import { AutoExtendSettingsV2, PayAsYouGoSettingsV2 } from "@/components/settings-v2/payment-modes-v2";
import { SettingsPageSaveProvider, SettingsStickySaveBar } from "@/components/settings-v2/settings-kit";
import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";
import { useLeaveGuardV2 } from "@/hooks/use-leave-guard-v2";
import { runThroughLeaveGuard } from "@/lib/leave-guard";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";

let container: HTMLDivElement;
let root: Root;

function api(overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    settings: {
      pay_as_you_go_enabled: false,
      payg_upfront_required: false,
      payg_auto_reminders_enabled: true,
      auto_extend_enabled: false,
      auto_extend_default_charge_mode: "pay_link",
      auto_extend_default_lead_hours: 0,
      auto_extend_grace_hours: 48,
      auto_extend_max_retries: 3,
      ...settings,
    },
    hasLoaded: true,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({}),
    isUpdating: false,
    ...overrides,
  };
}

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const switches = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
const text = () => container.textContent ?? "";
const buttonByText = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
/** The last registration under `key` that carried a save: [key, save, discard]. */
const registered = (registerSave: ReturnType<typeof vi.fn>, key: string) => {
  const calls = registerSave.mock.calls.filter((call) => call[0] === key && call[1]);
  return calls[calls.length - 1] as [string, () => Promise<unknown>, () => void] | undefined;
};

function deferred() {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PayAsYouGoSettingsV2", () => {
  it("shows a skeleton, not a writable switch, until the real settings arrive", () => {
    rs.current = api({ hasLoaded: false });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(switches()).toHaveLength(0);
  });

  it("shows the load error with a retry after a failed first read, never the default switch", () => {
    rs.current = api({ hasLoaded: false, error: new Error("Failed to fetch") });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Couldn't load pay as you go settings");
    expect(switches()).toHaveLength(0);
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"))!;
    act(() => retry.click());
    expect(rs.current.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the controls when a refresh fails over loaded settings, with the inline error above", () => {
    rs.current = api({ error: new Error("timeout") });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Couldn't refresh pay as you go settings.");
    expect(switches()).toHaveLength(1);
  });

  it("explains the off state and shows the two follow-up switches only when on", () => {
    rs.current = api();
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Off for new rentals");
    expect(switches()).toHaveLength(1);

    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(switches()).toHaveLength(3);
    expect(text()).not.toContain("Off for new rentals");
  });

  it("a flip is an unsaved change, not a write; Save writes only that key, and a failed save keeps the flip and says why", async () => {
    const write = deferred();
    rs.current = api({ updateSettings: vi.fn(() => write.promise) });
    render(<PayAsYouGoSettingsV2 canEdit />);

    act(() => switches()[0].click());
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    // The follow-up switches show for the draft at once.
    expect(switches()).toHaveLength(3);
    expect(text()).toContain("Unsaved changes");

    await act(async () => buttonByText("Save")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ pay_as_you_go_enabled: true });
    expect(text()).toContain("Saving…");
    expect(switches()[0].disabled).toBe(true);

    await act(async () => {
      write.reject(new Error("permission denied"));
      await write.promise.catch(() => undefined);
    });
    // The edit is kept, so Retry (or Save) writes it again.
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    expect(switches()[0].disabled).toBe(false);
    expect(text()).toContain("Couldn't save.");
    expect(text()).toContain("You don't have permission to change this. Ask an admin.");

    rs.current.updateSettings.mockResolvedValueOnce({});
    await act(async () => buttonByText("Retry")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(2);
    expect(rs.current.updateSettings).toHaveBeenLastCalledWith({ pay_as_you_go_enabled: true });
    expect(text()).not.toContain("Couldn't save.");
  });

  it("flipping back to the saved value is no change: nothing to save", () => {
    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(<PayAsYouGoSettingsV2 canEdit />);
    act(() => switches()[1].click());
    expect(text()).toContain("Unsaved changes");
    act(() => switches()[1].click());
    expect(text()).not.toContain("Unsaved changes");
    expect(buttonByText("Save")!.disabled).toBe(true);
  });

  it("inside the page's save bar: no Save of its own; the page gets a save that writes only the changed keys, and a discard", async () => {
    const registerSave = vi.fn();
    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(
      <SettingsPageSaveProvider>
        <PayAsYouGoSettingsV2 canEdit registerSave={registerSave} />
      </SettingsPageSaveProvider>,
    );
    expect(buttonByText("Save")).toBeUndefined();
    expect(registerSave).toHaveBeenLastCalledWith("payg", null);

    // Upfront on (saved off), reminders off (saved on).
    act(() => switches()[1].click());
    act(() => switches()[2].click());
    const [, save, discard] = registered(registerSave, "payg")!;
    await act(async () => {
      await save();
    });
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ payg_upfront_required: true, payg_auto_reminders_enabled: false });

    // Reset: the draft goes, the saved values show, and the page is told it is clean.
    act(() => switches()[1].click());
    expect(switches()[1].getAttribute("aria-checked")).toBe("true");
    act(() => registered(registerSave, "payg")![2]());
    expect(switches()[1].getAttribute("aria-checked")).toBe("false");
    expect(registerSave).toHaveBeenLastCalledWith("payg", null);
    expect(typeof discard).toBe("function");
  });

  it("inside the page's save bar, a failed save rejects for the page and says why beside the form", async () => {
    const registerSave = vi.fn();
    const failure = new Error("Failed to fetch");
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(failure) });
    render(
      <SettingsPageSaveProvider>
        <PayAsYouGoSettingsV2 canEdit registerSave={registerSave} />
      </SettingsPageSaveProvider>,
    );
    act(() => switches()[0].click());
    const [, save] = registered(registerSave, "payg")!;
    let rejected: unknown = null;
    await act(async () => {
      await save().catch((err) => {
        rejected = err;
      });
    });
    expect(rejected).toBe(failure);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("We couldn't reach the server. Your changes are still here.");
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("disables every control for a read-only user, keyboard included (native fieldset), with no Save and no registration", () => {
    const registerSave = vi.fn();
    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(<PayAsYouGoSettingsV2 canEdit={false} registerSave={registerSave} />);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(switches().every((s) => s.disabled)).toBe(true);
    expect(buttonByText("Save")).toBeUndefined();
    expect(registerSave.mock.calls.every(([, save]) => save === undefined || save === null)).toBe(true);
  });
});

describe("AutoExtendSettingsV2", () => {
  const inputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));

  it("refuses empty, decimal and out-of-range numbers as they are typed, never saves them, and a typed-back value is no change", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const [lead, grace, retries] = inputs();
    expect([lead.value, grace.value, retries.value]).toEqual(["0", "48", "3"]);

    typeInto(grace, "");
    expect(text()).toContain("Grace window: Enter 0–720 hours");
    expect(grace.getAttribute("aria-invalid")).toBe("true");

    typeInto(lead, "1.5");
    expect(text()).toContain("Charge lead time: Enter 0–168 hours");

    typeInto(retries, "25");
    expect(text()).toContain("Retries: Enter 0–20 retries");
    // Save waits while a field is invalid.
    expect(buttonByText("Save")!.disabled).toBe(true);

    typeInto(grace, "48"); // back to the saved value
    expect(text()).not.toContain("Grace window:");

    typeInto(lead, "0"); // back to the saved value
    typeInto(retries, "3"); // back to the saved value
    expect(text()).not.toContain("Unsaved changes");
    expect(buttonByText("Save")!.disabled).toBe(true);
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
  });

  it("the page's save refuses an invalid number with the field's own words, and writes nothing", async () => {
    const registerSave = vi.fn();
    rs.current = api({}, { auto_extend_enabled: true });
    render(
      <SettingsPageSaveProvider>
        <AutoExtendSettingsV2 canEdit registerSave={registerSave} />
      </SettingsPageSaveProvider>,
    );
    typeInto(inputs()[2], "25");
    const [, save] = registered(registerSave, "auto-extend")!;
    let rejected: unknown = null;
    await act(async () => {
      await save().catch((err) => {
        rejected = err;
      });
    });
    expect((rejected as Error).message).toBe("Retries: Enter 0–20 retries.");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
  });

  it("explains a value already saved out of range, never corrects it, and widens the field for every digit", async () => {
    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_lead_hours: 9999999, auto_extend_max_retries: -3 });
    render(<AutoExtendSettingsV2 canEdit />);
    const [lead, grace, retries] = inputs();
    expect([lead.value, grace.value, retries.value]).toEqual(["9999999", "48", "-3"]);
    expect(text()).toContain("Charge lead time: The saved value 9,999,999 is outside 0–168 hours. Enter a new value.");
    expect(text()).toContain("Retries: The saved value -3 is outside 0–20 retries. Enter a new value.");
    expect(lead.getAttribute("aria-invalid")).toBe("true");
    expect(grace.getAttribute("aria-invalid")).toBeNull();
    expect(lead.style.minWidth).toBe("calc(7ch + 1.75rem)");
    // Not edited, so not a change: nothing to save.
    expect(text()).not.toContain("Unsaved changes");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();

    typeInto(lead, "24");
    await act(async () => buttonByText("Save")!.click());
    // Only the edited field: the out-of-range retries are left as saved.
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_default_lead_hours: 24 });
    expect(text()).toContain("Retries: The saved value -3");
  });

  it("saves a valid changed number as a number, under its own key, with the other changes in one write", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const grace = inputs()[1];
    typeInto(grace, "72");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    await act(async () => buttonByText("Save")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_grace_hours: 72 });
  });

  it("turning it off hides the numbers, and saving then writes just the switch, even over a half-typed number", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    typeInto(inputs()[1], "");
    act(() => switches()[0].click());
    expect(inputs()).toHaveLength(0);
    expect(text()).toContain("Off for new rentals");
    await act(async () => buttonByText("Save")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_enabled: false });
  });

  it("hands the page a save and a discard under 'auto-extend' while it holds a change", () => {
    const registerSave = vi.fn();
    rs.current = api({}, { auto_extend_enabled: true });
    render(
      <SettingsPageSaveProvider>
        <AutoExtendSettingsV2 canEdit registerSave={registerSave} />
      </SettingsPageSaveProvider>,
    );
    expect(buttonByText("Save")).toBeUndefined();
    expect(registerSave).toHaveBeenLastCalledWith("auto-extend", null);
    typeInto(inputs()[0], "12");
    const [key, , discard] = registered(registerSave, "auto-extend")!;
    expect(key).toBe("auto-extend");
    act(() => discard());
    expect(inputs()[0].value).toBe("0");
    expect(registerSave).toHaveBeenLastCalledWith("auto-extend", null);
  });

  it("warns when auto-charge is the default but no payment provider is connected", () => {
    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "auto_charge" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).toContain("No payment provider is connected");
    expect(container.querySelector('a[href="/integrations"]')).not.toBeNull();

    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "auto_charge", own_stripe_account_id: "acct_1" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).not.toContain("No payment provider is connected");

    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "pay_link" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).not.toContain("No payment provider is connected");
  });

  it("hides the billing rows and explains the off state", () => {
    rs.current = api();
    render(<AutoExtendSettingsV2 canEdit />);
    expect(inputs()).toHaveLength(0);
    expect(text()).toContain("Off for new rentals");
  });

  it("'How to take payment' is the v2 dropdown", () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const trigger = container.querySelector('[aria-label="How to take payment"]')!;
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
    expect(trigger.className).toContain("rounded-3xl");
  });
});

/* -------------------------------------------------------------------------- */
/* Through the page's save bar and leave dialog                                */
/* -------------------------------------------------------------------------- */

/**
 * The settings page's wiring around a form, in miniature (the page is too
 * large to mount): the registry (`registerV2SectionSave`), the one save bar,
 * the v2 leave guard and its "Save your changes?" dialog.
 */
function PageHarness({ form }: { form: (register: RegisterSectionSave) => React.ReactNode }) {
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
      <SettingsPageSaveProvider>{form(register)}</SettingsPageSaveProvider>
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

describe("Pay as you go and Auto-extension with the page's save bar and leave dialog", () => {
  const barButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("[data-settings-save-bar] button")).find(
      (b) => b.textContent?.trim() === label,
    );
  const dialogButton = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
      (b) => b.textContent?.trim() === label,
    );
  const bodyText = () => document.body.textContent ?? "";
  const numberInputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));

  beforeEach(() => {
    nav.push.mockReset();
  });

  it("Pay as you go: clean, leaving asks nothing; a flip lights the bar and its Save writes only that key", async () => {
    rs.current = api();
    render(<PageHarness form={(register) => <PayAsYouGoSettingsV2 canEdit registerSave={register} />} />);
    expect(barButton("Save changes")!.disabled).toBe(true);
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toContain("Save your changes?");

    act(() => switches()[0].click());
    expect(container.querySelector("[data-settings-save-bar]")!.textContent).toContain("Unsaved changes");
    await act(async () => barButton("Save changes")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ pay_as_you_go_enabled: true });
  });

  it("Pay as you go: the bar's Reset puts the switch back and writes nothing", () => {
    rs.current = api();
    render(<PageHarness form={(register) => <PayAsYouGoSettingsV2 canEdit registerSave={register} />} />);
    act(() => switches()[0].click());
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    act(() => barButton("Reset")!.click());
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(barButton("Save changes")!.disabled).toBe(true);
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
  });

  it("Auto-extension: leaving with an edit asks; Save writes the typed number, then leaves", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<PageHarness form={(register) => <AutoExtendSettingsV2 canEdit registerSave={register} />} />);
    typeInto(numberInputs()[1], "72"); // grace, saved 48
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(bodyText()).toContain("Save your changes?");
    expect(proceed).not.toHaveBeenCalled();

    await act(async () => dialogButton("Save")!.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_grace_hours: 72 });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("Auto-extension: Don't save puts the number back, writes nothing and leaves", () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<PageHarness form={(register) => <AutoExtendSettingsV2 canEdit registerSave={register} />} />);
    typeInto(numberInputs()[0], "12"); // lead, saved 0
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    act(() => dialogButton("Don't save")!.click());
    expect(numberInputs()[0].value).toBe("0");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("Auto-extension: an invalid number keeps the page on Save and writes nothing", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<PageHarness form={(register) => <AutoExtendSettingsV2 canEdit registerSave={register} />} />);
    typeInto(numberInputs()[2], "25"); // retries, 0–20
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    await act(async () => dialogButton("Save")!.click());
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Save your changes?");
  });
});
