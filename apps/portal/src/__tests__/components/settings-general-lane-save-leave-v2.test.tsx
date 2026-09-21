/**
 * v2 Settings, General lane (team lead review, Sep 19 2026): the page save bar
 * and the leave dialog across General's two tabs. Both tabs stay mounted, so
 * an edit made on one is still saved, reset or asked about from the other.
 * (Lockbox and Tax and deposit, the pages that came out of General, are
 * covered the same way in settings-general-lane-v2-save-bar.test.tsx.)
 *
 * The settings page is too large to mount, so this harness wires the parts
 * the way `settings/page.tsx` does: the same register function
 * (`registerV2SectionSave`), `SettingsPageSaveProvider`, the end-of-row
 * provider, `SettingsStickySaveBar`, `useLeaveGuardV2` and `LeaveDialogV2`.
 * The sections under test are the real ones (RequirementsPageV2,
 * BusinessRegionalPanel) inside the real `SettingsTabs`.
 *
 * Every expected value is written out by hand.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));

import {
  SettingsPageSaveProvider,
  SettingsRowAlignProvider,
  SettingsStickySaveBar,
  SettingsTabPanel,
  SettingsTabs,
} from "@/components/settings-v2/settings-kit";
import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";
import { RequirementsPageV2 } from "@/components/settings-v2/business-rules-pages";
import { savedFieldsFor } from "@/components/settings-v2/business-rules-logic";
import { BusinessRegionalPanel, type GeneralSaveValues } from "@/components/settings-v2/business-settings-states";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { useLeaveGuardV2 } from "@/hooks/use-leave-guard-v2";

const SetupResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
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

const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const saveChanges = () => buttonNamed("Save changes")!;
const leaveDialog = () => document.querySelector('[data-leave-dialog="v2"]');

/**
 * The settings page's wiring, trimmed to what the save bar and the leave
 * guard use. `register` is `registerV2SectionSave` line for line.
 */
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
      <SettingsPageSaveProvider enabled>
        <SettingsRowAlignProvider align="end">{children(register)}</SettingsRowAlignProvider>
      </SettingsPageSaveProvider>
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

/* -------------------------------------------------------------------------- */
/* General: an edit on one tab survives a switch to the other                  */
/* -------------------------------------------------------------------------- */

describe("General's tabs: one save bar covers both", () => {
  const REQ_SAVED = { minimum_rental_age: 21, verification_document_type: "driving_license" };
  const GENERAL: GeneralSaveValues = { currency_code: "USD", distance_unit: "miles", privacy_policy_version: "1.0", terms_version: "1.0" };

  function General({
    register,
    onRequirementsSave,
    onRegionalSave,
  }: {
    register: RegisterSectionSave;
    onRequirementsSave: (values: unknown) => void;
    onRegionalSave: () => void;
  }) {
    const [tab, setTab] = useState("regional");
    const [general, setGeneral] = useState<GeneralSaveValues>(GENERAL);
    const [saved, setSaved] = useState<Record<string, any>>(REQ_SAVED);
    const [form, setForm] = useState<Record<string, any>>(() => savedFieldsFor("requirements", REQ_SAVED));
    return (
      <SettingsTabs
        label="General"
        tabs={[
          { value: "regional", label: "Regional" },
          { value: "driver-requirements", label: "Driver requirements" },
        ]}
        value={tab}
        onValueChange={setTab}
      >
        <SettingsTabPanel value="regional">
          <BusinessRegionalPanel
            form={general}
            onFormChange={(patch) => setGeneral((prev) => ({ ...prev, ...patch }))}
            savedCurrency="USD"
            isDirty={general.distance_unit !== GENERAL.distance_unit}
            canEdit
            ready
            onRetryLoad={vi.fn()}
            onSave={async () => onRegionalSave()}
            onDiscard={() => setGeneral(GENERAL)}
            registerSave={register}
          />
        </SettingsTabPanel>
        <SettingsTabPanel value="driver-requirements">
          <RequirementsPageV2
            form={form}
            setForm={setForm as any}
            saved={saved}
            canEdit
            onSave={async (values: Record<string, any>) => {
              onRequirementsSave(values);
              setSaved((prev) => ({ ...prev, ...values }));
            }}
            registerSave={register}
            idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: vi.fn() }}
          />
        </SettingsTabPanel>
      </SettingsTabs>
    );
  }

  const mount = () => {
    const onRequirementsSave = vi.fn();
    const onRegionalSave = vi.fn();
    render(
      <PageHarness>
        {(register) => <General register={register} onRequirementsSave={onRequirementsSave} onRegionalSave={onRegionalSave} />}
      </PageHarness>,
    );
    return { onRequirementsSave, onRegionalSave };
  };
  const age = () => document.getElementById("v2_minimum_rental_age") as HTMLInputElement;
  const openTab = (index: number) => fireEvent.mouseDown(screen.getAllByRole("tab")[index], { button: 0 });

  it("an age typed on Driver requirements is still unsaved on Regional, and Save changes saves it from there", async () => {
    const { onRequirementsSave, onRegionalSave } = mount();
    openTab(1);
    fireEvent.change(age(), { target: { value: "25" } });
    expect(saveChanges().disabled).toBe(false);

    openTab(0);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    // The hidden tab kept the edit and its registered save.
    expect(age().value).toBe("25");
    expect(saveChanges().disabled).toBe(false);

    act(() => saveChanges().click());
    await flush();
    // Hand-written: the age, and the document type as it was saved.
    expect(onRequirementsSave).toHaveBeenCalledTimes(1);
    expect(onRequirementsSave).toHaveBeenCalledWith({ minimum_rental_age: 25, verification_document_type: "driving_license" });
    // Regional had nothing unsaved, so it was not written.
    expect(onRegionalSave).not.toHaveBeenCalled();
    expect(saveChanges().disabled).toBe(true);
  });

  it("Reset on Regional puts back an edit made on Driver requirements", () => {
    mount();
    openTab(1);
    fireEvent.change(age(), { target: { value: "30" } });
    openTab(0);
    act(() => buttonNamed("Reset")!.click());
    expect(age().value).toBe("21");
    expect(saveChanges().disabled).toBe(true);
  });

  it("leaving from Regional with an edit on the other tab still asks", async () => {
    const { onRequirementsSave } = mount();
    openTab(1);
    fireEvent.change(age(), { target: { value: "25" } });
    openTab(0);

    act(() => screen.getByText("Leave for Vehicles").click());
    expect(leaveDialog()).not.toBeNull();
    act(() => buttonNamed("Don't save")!.click());
    await flush();
    expect(nav.push).toHaveBeenCalledWith("/vehicles");
    expect(onRequirementsSave).not.toHaveBeenCalled();
    expect(age().value).toBe("21");
  });
});
