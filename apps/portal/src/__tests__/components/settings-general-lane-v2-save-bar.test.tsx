/**
 * v2 Settings, team lead review of Sep 19 2026: Lockbox and Tax and deposit
 * left General for pages of their own. Each must still save through the
 * page's ONE floating save bar and ask "Save your changes?" when it is left
 * with edits, exactly as General did.
 *
 * The settings page is too large to mount, so this wires each page's sections
 * to the same registry (`registerV2SectionSave`), save bar, v2 leave guard and
 * leave dialog the page uses, with the same props `settings/page.tsx` passes
 * (Lockbox: `makeBusinessSave(updateRentalSettings, refetchTenant)`; Tax and
 * deposit: `(values) => updateRentalSettings(values)` for each half). That
 * the page lists both in V2_PAGES_WITH_SAVE_BAR is pinned in
 * settings-v2-structure.test.tsx.
 *
 * Every expected payload is written out by hand from the saved row and the
 * one field edited.
 *
 * HARNESS: `react-dom/client` + `act`, as installment-settings-v2-states does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useCallback, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/hooks/use-rental-settings", () => ({
  useRentalSettings: () => ({ hasLoaded: true, error: null, isFetching: false, refetch: () => undefined }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { LockboxPageV2, makeBusinessSave } from "@/components/settings-v2/business-rules-pages";
import { savedFieldsFor } from "@/components/settings-v2/business-rules-logic";
import { DepositSettingsV2, FeesSettingsV2 } from "@/components/settings-v2/fees-deposit-v2";
import { savedDepositValues, savedFeesValues } from "@/components/settings-v2/pricing-money-logic";
import type { RegisterSectionSave, SettingsReadState } from "@/components/settings-v2/pricing-money-parts";
import {
  SettingsPageSaveProvider,
  SettingsRowAlignProvider,
  SettingsSection,
  SettingsStickySaveBar,
} from "@/components/settings-v2/settings-kit";
import { BusinessRegionalPanel } from "@/components/settings-v2/business-settings-states";
import { SETTINGS_INDEX_SECTIONS } from "@/components/settings-v2/settings-index";
import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";
import { useLeaveGuardV2 } from "@/hooks/use-leave-guard-v2";
import { runThroughLeaveGuard } from "@/lib/leave-guard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  nav.push.mockReset();
  nav.replace.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * The settings page's wiring around a v2 page, in miniature: the registry,
 * the one save bar, the leave guard and its dialog, and a link to another
 * screen. `children` gets the registry the page passes as `registerSave`.
 */
function PageHarness({ children }: { children: (register: RegisterSectionSave) => ReactNode }) {
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
        <SettingsRowAlignProvider align="end">{children(register)}</SettingsRowAlignProvider>
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

const bodyText = () => document.body.textContent ?? "";
const barText = () => container.querySelector("[data-settings-save-bar]")?.textContent ?? "";
const barButton = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("[data-settings-save-bar] button")).find(
    (b) => b.textContent?.trim() === label,
  );
const dialogButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
    (b) => b.textContent?.trim() === label,
  );

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/* -------------------------------------------------------------------------- */
/* Lockbox                                                                     */
/* -------------------------------------------------------------------------- */

const TEMPLATES_HREF = "/settings?tab=templates#settings-lockbox-messages";
const lockboxSaved = {
  lockbox_enabled: true,
  lockbox_code_length: 4,
  lockbox_notification_methods: ["email"],
  lockbox_send_offset_minutes: null,
};

function LockboxPage({ update }: { update: (values: unknown) => Promise<unknown> }) {
  const [form, setForm] = useState<Record<string, any>>(() => savedFieldsFor("lockbox", lockboxSaved));
  return (
    <PageHarness>
      {(register) => (
        <LockboxPageV2
          form={form}
          setForm={setForm}
          saved={lockboxSaved}
          canEdit
          onSave={makeBusinessSave(update, vi.fn())}
          registerSave={register}
          vehiclesHref="/vehicles"
          templatesHref={TEMPLATES_HREF}
        />
      )}
    </PageHarness>
  );
}

describe("Lockbox page: the floating save bar and the leave dialog", () => {
  const codeLength = () => container.querySelector<HTMLInputElement>("#v2_lockbox_code_length")!;
  // Saved: on, 4 digits, email, sent by hand. Edited: 6 digits. Nothing else moves.
  const sixDigits = {
    lockbox_enabled: true,
    lockbox_code_length: 6,
    lockbox_notification_methods: ["email"],
    lockbox_send_offset_minutes: null,
  };

  it("with nothing changed, the bar has nothing to save and leaving asks nothing", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<LockboxPage update={update} />));
    expect(barButton("Save changes")!.disabled).toBe(true);
    // No Save of the page's own inside the panel: the bar is the only one.
    expect(Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Save")).toHaveLength(0);
    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toContain("Save your changes?");
  });

  it("an edit lights the bar; its Save changes writes the lockbox fields, and only them", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<LockboxPage update={update} />));
    typeInto(codeLength(), "6");
    expect(barText()).toContain("Unsaved changes");
    expect(barButton("Save changes")!.disabled).toBe(false);

    await act(async () => barButton("Save changes")!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(sixDigits);
  });

  it("Templates with an edit asks first (it opens another page); Save writes the edit, then goes to the lockbox message", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<LockboxPage update={update} />));
    typeInto(codeLength(), "6");

    act(() => container.querySelector<HTMLAnchorElement>(`a[href="${TEMPLATES_HREF}"]`)!.click());
    expect(bodyText()).toContain("Save your changes?");
    expect(nav.push).not.toHaveBeenCalled();

    await act(async () => dialogButton("Save")!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(sixDigits);
    expect(nav.push).toHaveBeenCalledWith(TEMPLATES_HREF);
  });

  it("leaving by a link with an edit asks; Don't save puts the code length back and leaves without writing", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<LockboxPage update={update} />));
    typeInto(codeLength(), "6");

    act(() => container.querySelector<HTMLAnchorElement>('a[href="/rentals"]')!.click());
    expect(bodyText()).toContain("Save your changes?");

    act(() => dialogButton("Don't save")!.click());
    expect(codeLength().value).toBe("4");
    expect(update).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/rentals");
  });

  it("the bar's Reset puts the edit back and the bar goes quiet", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<LockboxPage update={update} />));
    typeInto(codeLength(), "6");
    act(() => barButton("Reset")!.click());
    expect(codeLength().value).toBe("4");
    expect(barButton("Save changes")!.disabled).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* The index: Branding's wording matches the Branding page                     */
/* -------------------------------------------------------------------------- */

describe("the index: Branding names what the Branding page names", () => {
  it("square icon and full logo, never 'favicon', in 95 to 120 characters", () => {
    const branding = SETTINGS_INDEX_SECTIONS.flatMap((s) => s.items).find((item) => item.title === "Branding")!;
    expect(branding.description).toBe(
      "Your portal name, square icon, full logo and brand colour, shown in this portal and on your customer booking site.",
    );
    expect(branding.description.length).toBe(114);
    expect(branding.description.toLowerCase()).not.toContain("favicon");
  });
});

/* -------------------------------------------------------------------------- */
/* Regional: a saved currency the list doesn't offer                           */
/* -------------------------------------------------------------------------- */

describe("Regional: the note under a saved currency the list doesn't offer", () => {
  it("says it stays unless US dollar is picked (it is listed and pickable now, so no 'isn't one of the options')", () => {
    act(() =>
      root.render(
        <BusinessRegionalPanel
          form={{ currency_code: "AED", distance_unit: "km", privacy_policy_version: "1.0", terms_version: "1.0" }}
          onFormChange={vi.fn()}
          savedCurrency="AED"
          isDirty={false}
          canEdit
          ready
          onRetryLoad={vi.fn()}
          onSave={vi.fn(async () => {})}
          onDiscard={vi.fn()}
        />,
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Your currency is AED. It stays as it is unless you pick US dollar. Contact support for any other currency.");
    expect(text).not.toContain("isn't one of the options");
  });
});

/* -------------------------------------------------------------------------- */
/* Tax and deposit                                                             */
/* -------------------------------------------------------------------------- */

const taxDepositSaved = {
  tax_enabled: true,
  tax_percentage: 8,
  service_fee_enabled: false,
  service_fee_type: "fixed_amount",
  service_fee_value: 0,
  service_fee_amount: 0,
  security_deposit_enabled: true,
  deposit_charge_enabled: false,
  deposit_mode: "global",
  global_deposit_amount: 200,
  // A usable Stripe Connect account, so no "Connect Stripe" notice.
  stripe_account_id: "acct_test",
  stripe_onboarding_complete: true,
  stripe_account_status: "active",
};

const loaded: SettingsReadState = {
  hasData: true,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: async () => undefined,
};

/** The Tax and deposit page as settings/page.tsx renders it: two sections, each saving its own half. */
function TaxAndDepositPage({ update }: { update: (values: unknown) => Promise<unknown> }) {
  const [form, setForm] = useState<Record<string, any>>(() => ({
    ...savedFeesValues(taxDepositSaved),
    ...savedDepositValues(taxDepositSaved),
  }));
  return (
    <PageHarness>
      {(register) => (
        <div className="space-y-8">
          <SettingsSection anchor="tax-and-fees" title="Tax and fees">
            <FeesSettingsV2
              form={form as any}
              setForm={setForm}
              saved={taxDepositSaved}
              read={loaded}
              canEdit
              currencyCode="USD"
              onSave={(values) => update(values)}
              registerSave={register}
            />
          </SettingsSection>
          <SettingsSection anchor="security-deposit" title="Security deposit">
            <DepositSettingsV2
              form={form as any}
              setForm={setForm}
              saved={taxDepositSaved as any}
              read={loaded}
              holds={loaded}
              liveHoldCount={0}
              canEdit
              currencyCode="USD"
              paymentProvider="stripe"
              connectHref="/integrations"
              onRequestCharge={vi.fn()}
              onSave={(values) => update(values)}
              registerSave={register}
            />
          </SettingsSection>
        </div>
      )}
    </PageHarness>
  );
}

describe("Tax and deposit page: the floating save bar and the leave dialog", () => {
  const taxRate = () => container.querySelector<HTMLInputElement>('input[aria-label="Tax rate"]')!;
  const depositAmount = () => container.querySelector<HTMLInputElement>('input[aria-label="Deposit amount in USD"]')!;
  // Saved tax 8% -> 9.5%; the service fee stays off at 0, fixed amount.
  const feesAt95 = {
    tax_enabled: true,
    tax_percentage: 9.5,
    service_fee_enabled: false,
    service_fee_amount: 0,
    service_fee_type: "fixed_amount",
    service_fee_value: 0,
  };
  // Saved deposit 200 held on every online booking -> 350, still a hold.
  const depositAt350 = {
    security_deposit_enabled: true,
    deposit_charge_enabled: false,
    deposit_mode: "global",
    global_deposit_amount: 350,
  };

  it("both halves sit on one page, in order, with no Save of their own", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<TaxAndDepositPage update={update} />));
    const sections = Array.from(container.querySelectorAll("[data-settings-section]")).map((s) =>
      s.getAttribute("data-settings-section"),
    );
    expect(sections).toEqual(["tax-and-fees", "security-deposit"]);
    expect(container.querySelector("#settings-security-deposit")).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Save")).toHaveLength(0);
    expect(barButton("Save changes")!.disabled).toBe(true);
  });

  it("an edit to each half: one Save changes writes both, each with its own fields", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<TaxAndDepositPage update={update} />));
    typeInto(taxRate(), "9.5");
    blur(taxRate());
    typeInto(depositAmount(), "350");
    expect(barText()).toContain("Unsaved changes");

    await act(async () => barButton("Save changes")!.click());
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(feesAt95);
    expect(update).toHaveBeenCalledWith(depositAt350);
  });

  it("an edit to one half writes that half only", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<TaxAndDepositPage update={update} />));
    typeInto(depositAmount(), "350");

    await act(async () => barButton("Save changes")!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(depositAt350);
  });

  it("leaving with an edit asks; Save in the dialog writes it, then leaves", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<TaxAndDepositPage update={update} />));
    typeInto(taxRate(), "9.5");
    blur(taxRate());

    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    expect(bodyText()).toContain("Save your changes?");
    expect(proceed).not.toHaveBeenCalled();

    await act(async () => dialogButton("Save")!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(feesAt95);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("leaving by a link with edits asks; Don't save puts both halves back and leaves without writing", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<TaxAndDepositPage update={update} />));
    typeInto(taxRate(), "9.5");
    blur(taxRate());
    typeInto(depositAmount(), "350");

    act(() => container.querySelector<HTMLAnchorElement>('a[href="/rentals"]')!.click());
    expect(bodyText()).toContain("Save your changes?");
    expect(nav.push).not.toHaveBeenCalled();

    act(() => dialogButton("Don't save")!.click());
    expect(taxRate().value).toBe("8");
    expect(depositAmount().value).toBe("200");
    expect(update).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/rentals");
  });

  it("a failed save keeps the dialog open, the page and the edit", async () => {
    const update = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    act(() => root.render(<TaxAndDepositPage update={update} />));
    typeInto(depositAmount(), "350");

    const proceed = vi.fn();
    act(() => runThroughLeaveGuard("/rentals", proceed));
    await act(async () => dialogButton("Save")!.click());
    expect(proceed).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Save your changes?");
    expect(depositAmount().value).toBe("350");
  });
});
