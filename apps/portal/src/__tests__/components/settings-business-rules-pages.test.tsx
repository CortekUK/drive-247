/**
 * v2 Settings, Business rules pages (`components/settings-v2/business-rules-pages.tsx`):
 * the load gate, validation instead of silent clamps, per-section save state,
 * view-only, the email-only Key handover, and the v2 controls.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks `@testing-library/dom`),
 * the same approach as `settings-section-states.test.tsx`. The rental-settings
 * hook and permissions are mocked, so nothing here touches Supabase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const rental = vi.hoisted(() => ({
  state: { hasLoaded: true, error: null as unknown, isFetching: false, refetch: (() => undefined) as () => unknown },
}));

vi.mock("@/hooks/use-rental-settings", () => ({
  useRentalSettings: () => rental.state,
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

import {
  BusinessRentalGate,
  DurationPageV2,
  LockboxPageV2,
  RequirementsPageV2,
  ReturnReminderPanelV2,
  makeBusinessSave,
} from "@/components/settings-v2/business-rules-pages";
import { savedFieldsFor, type BusinessPage } from "@/components/settings-v2/business-rules-logic";
import { SettingsPageSaveProvider } from "@/components/settings-v2/settings-kit";

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container;
}

function button(name: string): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll("button"));
  const hit = all.find((b) => b.textContent?.trim() === name);
  if (!hit) throw new Error(`No button "${name}" in: ${all.map((b) => b.textContent).join(" | ")}`);
  return hit;
}

function input(selector: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`No input ${selector}`);
  return el;
}

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

const text = () => container.textContent ?? "";

/** Holds the page form in state, like settings/page.tsx does with `rentalForm`. */
function Harness({
  page,
  saved,
  render: renderPage,
}: {
  page: BusinessPage;
  saved: Record<string, any>;
  render: (props: { form: any; setForm: any }) => React.ReactNode;
}) {
  const [form, setForm] = useState<Record<string, any>>(() => savedFieldsFor(page, saved));
  return <>{renderPage({ form, setForm })}</>;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rental.state = { hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BusinessRentalGate", () => {
  it("shows a skeleton, not the form, while the placeholder defaults are showing", () => {
    rental.state = { ...rental.state, hasLoaded: false };
    render(
      <BusinessRentalGate thing="your booking rules">
        <p>FORM</p>
      </BusinessRentalGate>,
    );
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(text()).not.toContain("FORM");
  });

  it("shows the load error with a retry, never the form, when the first read failed", () => {
    const refetch = vi.fn();
    rental.state = { hasLoaded: false, error: new Error("Failed to fetch"), isFetching: false, refetch };
    render(
      <BusinessRentalGate thing="your booking rules">
        <p>FORM</p>
      </BusinessRentalGate>,
    );
    expect(text()).toContain("Couldn't load your booking rules");
    expect(text()).not.toContain("FORM");
    act(() => button("Try again").click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the last loaded form with a one-line notice when a refresh fails", () => {
    rental.state = { ...rental.state, hasLoaded: true, error: new Error("timeout") };
    render(
      <BusinessRentalGate thing="your booking rules">
        <p>FORM</p>
      </BusinessRentalGate>,
    );
    expect(text()).toContain("FORM");
    expect(text()).toContain("Couldn't refresh your booking rules.");
  });

  it("re-enables pointer events so a viewer can still press Try again", () => {
    render(
      <BusinessRentalGate thing="x">
        <p>FORM</p>
      </BusinessRentalGate>,
    );
    expect(container.firstElementChild?.className).toContain("pointer-events-auto");
  });
});

describe("makeBusinessSave", () => {
  it("rejects when the write fails", async () => {
    const save = makeBusinessSave(vi.fn().mockRejectedValue(new Error("nope")), vi.fn());
    await expect(save({ a: 1 })).rejects.toThrow("nope");
  });

  it("does not report a failed context refresh as a failed save", async () => {
    const refetchTenant = vi.fn().mockRejectedValue(new Error("offline"));
    const update = vi.fn().mockResolvedValue({});
    await expect(makeBusinessSave(update, refetchTenant)({ a: 1 }, true)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({ a: 1 });
    expect(refetchTenant).toHaveBeenCalledTimes(1);
  });

  it("only refreshes the context when asked", async () => {
    const refetchTenant = vi.fn();
    await makeBusinessSave(vi.fn().mockResolvedValue({}), refetchTenant)({ a: 1 });
    expect(refetchTenant).not.toHaveBeenCalled();
  });
});

describe("RequirementsPageV2", () => {
  const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
  const waiver = { enabled: false, canChange: true, saving: false, onToggle: () => undefined };

  const mount = (onSave: any, canEdit = true, savedRow: Record<string, any> = saved) =>
    render(
      <Harness
        page="requirements"
        saved={savedRow}
        render={({ form, setForm }) => (
          <RequirementsPageV2 form={form} setForm={setForm} saved={savedRow} canEdit={canEdit} onSave={onSave} idWaiver={waiver} />
        )}
      />,
    );

  it("keeps Save disabled until something changes", () => {
    mount(vi.fn());
    expect(button("Save").disabled).toBe(true);
  });

  it("explains an out-of-range age and blocks Save", () => {
    mount(vi.fn());
    typeInto(input("#v2_minimum_rental_age"), "15");
    expect(text()).toContain("Enter an age between 16 and 99, or leave it blank to use the booking site's default of 21.");
    expect(button("Save").disabled).toBe(true);
  });

  it("says what a blank age means", () => {
    mount(vi.fn());
    typeInto(input("#v2_minimum_rental_age"), "");
    // Not "no minimum": the booking form falls back to 21.
    expect(text()).toContain("No age is set, so your booking site uses its default: drivers must be at least 21.");
    expect(text()).not.toContain("any licensed driver");
  });

  it("saves only this page's fields", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave);
    typeInto(input("#v2_minimum_rental_age"), "25");
    expect(text()).toContain("Unsaved changes");
    await act(async () => button("Save").click());
    expect(onSave).toHaveBeenCalledWith({ minimum_rental_age: 25, verification_document_type: "passport" });
  });

  it("shows a failed save inline and keeps the edit, so Save still works", async () => {
    const onSave = vi.fn().mockRejectedValue({ code: "42501", message: "permission denied for table tenants" });
    mount(onSave);
    typeInto(input("#v2_minimum_rental_age"), "25");
    await act(async () => button("Save").click());
    expect(text()).toContain("Couldn't save.");
    expect(text()).toContain("You don't have permission to change this. Ask an admin.");
    expect(input("#v2_minimum_rental_age").value).toBe("25");
    expect(button("Save").disabled).toBe(false);
  });

  it("ignores a second click while a save is in flight", async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    mount(onSave);
    typeInto(input("#v2_minimum_rental_age"), "30");
    await act(async () => button("Save").click());
    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Save"))!;
    expect(saveButton.disabled).toBe(true);
    await act(async () => saveButton.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("view-only: no Save, and the controls are disabled for keyboard users too", () => {
    mount(vi.fn(), false);
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Save")).toBe(false);
    const age = input("#v2_minimum_rental_age");
    expect(age.closest("fieldset")?.disabled).toBe(true);
    expect(age.matches(":disabled")).toBe(true);
  });
});

describe("DurationPageV2", () => {
  const saved = {
    booking_lead_time_hours: 24,
    booking_lead_time_unit: "hours",
    min_rental_days: 0,
    min_rental_hours: 4,
    max_rental_days: 90,
    buffer_time_minutes: 0,
  };

  const mount = (onSave: any, savedRow: Record<string, any> = saved) =>
    render(
      <Harness
        page="duration"
        saved={savedRow}
        render={({ form, setForm }) => (
          <DurationPageV2 form={form} setForm={setForm} saved={savedRow} canEdit onSave={onSave} />
        )}
      />,
    );

  it("summarises the bookable range", () => {
    mount(vi.fn());
    expect(text()).toContain("Customers can book from 4 hours up to 90 days.");
  });

  it("a blank maximum asks for a value instead of saving 90", () => {
    mount(vi.fn());
    typeInto(input('input[aria-label="Longest rental days"]'), "");
    expect(text()).toContain("Enter the longest rental, in days.");
    expect(button("Save").disabled).toBe(true);
  });

  it("explains hours over 23 and a buffer over 3 days instead of clamping", () => {
    mount(vi.fn());
    typeInto(input('input[aria-label="Shortest rental hours"]'), "30");
    expect(text()).toContain("Hours must be 0–23. Put whole days in the days box.");
    expect(input('input[aria-label="Shortest rental hours"]').value).toBe("30");
    typeInto(input('input[aria-label="Time between rentals in minutes"]'), "5000");
    expect(text()).toContain("Keep this to 4,320 minutes (3 days) or less.");
    expect(button("Save").disabled).toBe(true);
  });

  it("shows a 36-hour notice stored in days as 36 hours, without marking it unsaved", () => {
    mount(vi.fn(), { ...saved, booking_lead_time_hours: 36, booking_lead_time_unit: "days" });
    expect(input('input[aria-label="Advance notice"]').value).toBe("36");
    expect(text()).toContain("(= 1.5 days)");
    expect(button("Save").disabled).toBe(true);
    expect(text()).not.toContain("Unsaved changes");
  });

  it("saves hours as the stored truth and refreshes the tenant", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave);
    typeInto(input('input[aria-label="Advance notice"]'), "48");
    await act(async () => button("Save").click());
    expect(onSave).toHaveBeenCalledWith(
      {
        booking_lead_time_hours: 48,
        booking_lead_time_unit: "hours",
        min_rental_days: 0,
        min_rental_hours: 4,
        max_rental_days: 90,
        buffer_time_minutes: 0,
      },
      true,
    );
  });
});

const TEMPLATES_HREF = "/settings?tab=templates#settings-lockbox-messages";

describe("LockboxPageV2", () => {
  const base = {
    lockbox_enabled: true,
    lockbox_code_length: 6,
    lockbox_notification_methods: ["email"],
    lockbox_send_offset_minutes: 45,
  };

  const mount = (savedRow: Record<string, any>, onSave: any = vi.fn(), canEdit = true) =>
    render(
      <Harness
        page="lockbox"
        saved={savedRow}
        render={({ form, setForm }) => (
          <LockboxPageV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit={canEdit}
            onSave={onSave}
            vehiclesHref="/vehicles"
            templatesHref={TEMPLATES_HREF}
          />
        )}
      />,
    );

  it("sends the code by email only: no text message or WhatsApp choice, and no Twilio notice", () => {
    mount({ ...base, lockbox_notification_methods: ["sms"] });
    const method = container.querySelector("[data-lockbox-method]");
    expect(method?.getAttribute("data-lockbox-method")).toBe("email");
    expect(method?.textContent).toBe("Email");
    expect(container.querySelector('[role="radio"]')).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(text()).not.toContain("Text message");
    expect(text()).not.toContain("WhatsApp");
    expect(text()).not.toContain("Twilio");
  });

  it("refuses a code length of 0", () => {
    mount(base);
    typeInto(input("#v2_lockbox_code_length"), "0");
    expect(text()).toContain("Enter 1–20 digits, or leave it blank for any length.");
    expect(button("Save").disabled).toBe(true);
  });

  it("when off, says where codes are set and where the email is edited, with no messages editor on the page", () => {
    mount({ ...base, lockbox_enabled: false });
    expect(container.querySelector('a[href="/vehicles"]')?.textContent).toBe("vehicle page");
    expect(container.querySelector(`a[href="${TEMPLATES_HREF}"]`)?.textContent).toBe("Customer messages");
    expect(container.querySelector('[data-settings-section="lockbox-messages"]')).toBeNull();
    // Only the switch row: code length, method, timing and Templates wait for it.
    expect(container.querySelector("#v2_lockbox_code_length")).toBeNull();
    expect(container.querySelector("[data-lockbox-method]")).toBeNull();
  });

  it("Templates opens the lockbox message on Customer messages, as a link a view-only user can still follow", () => {
    mount(base, vi.fn(), false);
    const templates = container.querySelector<HTMLAnchorElement>(`a[href="${TEMPLATES_HREF}"]`);
    expect(templates?.textContent).toBe("Templates");
    expect(templates?.closest("fieldset")?.disabled).toBe(true);
    // A disabled fieldset disables buttons, never links.
    expect(templates?.matches(":disabled")).toBe(false);
  });

  it("a text-message method saved before is not an unsaved edit on its own", () => {
    mount({ ...base, lockbox_notification_methods: ["sms"] });
    expect(button("Save").disabled).toBe(true);
    expect(text()).not.toContain("Unsaved changes");
  });

  it("saving writes email, replacing a text-message method saved before", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount({ ...base, lockbox_notification_methods: ["sms"] }, onSave);
    typeInto(input("#v2_lockbox_code_length"), "8");
    expect(text()).toContain("Unsaved changes");
    await act(async () => button("Save").click());
    expect(onSave).toHaveBeenCalledWith({
      lockbox_enabled: true,
      lockbox_code_length: 8,
      lockbox_notification_methods: ["email"],
      lockbox_send_offset_minutes: 45,
    });
  });
});

describe("ReturnReminderPanelV2", () => {
  const saved = { return_reminder_enabled: true, return_reminder_hours: 24 };

  const mount = (smsReady: boolean) =>
    render(
      <Harness
        page="return-reminder"
        saved={saved}
        render={({ form, setForm }) => (
          <ReturnReminderPanelV2
            form={form}
            setForm={setForm}
            saved={saved}
            canEdit
            onSave={vi.fn()}
            smsReady={smsReady}
            emailTemplateHref="/settings/email-templates/rental_reminder"
            integrationsHref="/integrations?open=Twilio%20Messages"
          />
        )}
      />,
    );

  it("says it is email only when Twilio isn't connected", () => {
    mount(false);
    expect(text()).toContain("Email only for now.");
    expect(container.querySelector('a[href="/integrations?open=Twilio%20Messages"]')?.textContent).toBe("Connect Twilio");
  });

  it("says it is also texted when Twilio is connected", () => {
    mount(true);
    expect(text()).toContain("Also sent as a text message, because Twilio is connected.");
  });

  it("lets the box be cleared while typing, then keeps the last value on blur", () => {
    mount(true);
    const hours = input('input[aria-label="Hours before return"]');
    typeInto(hours, "");
    expect(hours.value).toBe("");
    blur(hours);
    expect(hours.value).toBe("24");
    expect(text()).toContain("Enter 1–168 hours. Kept 24 hours.");
  });

  it("clamps 200 to 168 on blur, says so, and marks it unsaved", () => {
    mount(true);
    const hours = input('input[aria-label="Hours before return"]');
    typeInto(hours, "200");
    blur(hours);
    expect(hours.value).toBe("168");
    expect(text()).toContain("so this is now 168.");
    expect(text()).toContain("Emailed 7 days before the car is due back.");
    expect(button("Save").disabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Finish pass: leaving with unsaved edits, and the lockbox switch note        */
/* -------------------------------------------------------------------------- */

/** Like Harness, but the page can be closed while the form (the settings page's state) lives on. */
function ClosableHarness({
  page,
  saved,
  open,
  render: renderPage,
}: {
  page: BusinessPage;
  saved: Record<string, any>;
  open: boolean;
  render: (props: { form: any; setForm: any }) => React.ReactNode;
}) {
  const [form, setForm] = useState<Record<string, any>>(() => savedFieldsFor(page, saved));
  return (
    <>
      <output data-testid="form">{JSON.stringify(form)}</output>
      {open && renderPage({ form, setForm })}
    </>
  );
}

const formState = () => JSON.parse(container.querySelector('[data-testid="form"]')!.textContent!);

describe("leaving a business page with unsaved edits", () => {
  const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
  const waiver = { enabled: false, canChange: true, saving: false, onToggle: () => undefined };

  const mountRequirements = (onSave: any, registerSave: any, open = true) =>
    render(
      <ClosableHarness
        page="requirements"
        saved={saved}
        open={open}
        render={({ form, setForm }) => (
          <RequirementsPageV2
            form={form}
            setForm={setForm}
            saved={saved}
            canEdit
            onSave={onSave}
            registerSave={registerSave}
            idWaiver={waiver}
          />
        )}
      />,
    );

  const lastRegistration = (registerSave: ReturnType<typeof vi.fn>, key: string) =>
    registerSave.mock.calls.filter(([k]) => k === key).at(-1)?.[1];

  it("registers a save with the page only while dirty, so leaving warns", () => {
    const registerSave = vi.fn();
    mountRequirements(vi.fn(), registerSave);
    expect(lastRegistration(registerSave, "business-requirements")).toBeNull();
    typeInto(input("#v2_minimum_rental_age"), "25");
    expect(typeof lastRegistration(registerSave, "business-requirements")).toBe("function");
    typeInto(input("#v2_minimum_rental_age"), "21");
    expect(lastRegistration(registerSave, "business-requirements")).toBeNull();
  });

  it("Save & Leave saves this page's fields, and refuses while a field is invalid", async () => {
    const registerSave = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    mountRequirements(onSave, registerSave);
    typeInto(input("#v2_minimum_rental_age"), "25");
    const leave = lastRegistration(registerSave, "business-requirements");
    await act(async () => {
      await leave();
    });
    expect(onSave).toHaveBeenCalledWith({ minimum_rental_age: 25, verification_document_type: "passport" });

    // Still the same registered function (dirty never flipped), now reading the invalid age.
    typeInto(input("#v2_minimum_rental_age"), "15");
    let rejection: unknown = null;
    await act(async () => {
      await leave().catch((e: unknown) => (rejection = e));
    });
    expect((rejection as Error)?.message).toBe("Enter an age between 16 and 99, or leave it blank to use the booking site's default of 21.");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Save & Leave rejects when the write fails, and the error stays inline", async () => {
    const registerSave = vi.fn();
    mountRequirements(vi.fn().mockRejectedValue(new Error("Failed to fetch")), registerSave);
    typeInto(input("#v2_minimum_rental_age"), "25");
    let rejection: unknown = null;
    await act(async () => {
      await lastRegistration(registerSave, "business-requirements")().catch((e: unknown) => (rejection = e));
    });
    expect((rejection as Error)?.message).toBe("Couldn't save your driver requirements.");
    expect(text()).toContain("We couldn't reach the server. Your changes are still here.");
  });

  it("Don't Save: closing the page puts its fields back and unregisters it", () => {
    const registerSave = vi.fn();
    mountRequirements(vi.fn(), registerSave);
    typeInto(input("#v2_minimum_rental_age"), "30");
    expect(formState().minimum_rental_age).toBe(30);
    mountRequirements(vi.fn(), registerSave, false);
    expect(formState()).toEqual({ minimum_rental_age: 21, verification_document_type: "passport" });
    expect(lastRegistration(registerSave, "business-requirements")).toBeNull();
  });

  it("closing a clean page leaves the form alone", () => {
    const registerSave = vi.fn();
    mountRequirements(vi.fn(), registerSave);
    mountRequirements(vi.fn(), registerSave, false);
    expect(formState()).toEqual({ minimum_rental_age: 21, verification_document_type: "passport" });
  });

  it("registers Booking rules under its own key, including an advance-notice-only edit", () => {
    const registerSave = vi.fn();
    const durationSaved = {
      booking_lead_time_hours: 24,
      booking_lead_time_unit: "hours",
      min_rental_days: 0,
      min_rental_hours: 4,
      max_rental_days: 90,
      buffer_time_minutes: 0,
    };
    render(
      <Harness
        page="duration"
        saved={durationSaved}
        render={({ form, setForm }) => (
          <DurationPageV2 form={form} setForm={setForm} saved={durationSaved} canEdit onSave={vi.fn()} registerSave={registerSave} />
        )}
      />,
    );
    typeInto(input('input[aria-label="Advance notice"]'), "48");
    expect(typeof lastRegistration(registerSave, "business-duration")).toBe("function");
  });

  it("view-only never registers a save", () => {
    const registerSave = vi.fn();
    render(
      <Harness
        page="requirements"
        saved={saved}
        render={({ form, setForm }) => (
          <RequirementsPageV2 form={form} setForm={setForm} saved={saved} canEdit={false} onSave={vi.fn()} registerSave={registerSave} idWaiver={waiver} />
        )}
      />,
    );
    expect(registerSave).not.toHaveBeenCalledWith("business-requirements", expect.any(Function));
  });
});

describe("LockboxPageV2 switch", () => {
  const off = { lockbox_enabled: false, lockbox_code_length: null, lockbox_notification_methods: ["email"], lockbox_send_offset_minutes: null };

  it("says the switch needs Save while it differs from what is saved", () => {
    render(
      <Harness
        page="lockbox"
        saved={off}
        render={({ form, setForm }) => (
          <LockboxPageV2
            form={form}
            setForm={setForm}
            saved={off}
            canEdit
            onSave={vi.fn()}
            vehiclesHref="/vehicles"
            templatesHref={TEMPLATES_HREF}
          />
        )}
      />,
    );
    expect(text()).not.toContain("Not applied yet.");
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Enable lockbox handover"]')!;
    act(() => toggle.click());
    expect(text()).toContain("Not applied yet. Press Save to turn lockbox handover on.");
    act(() => toggle.click());
    expect(text()).not.toContain("Not applied yet.");
  });
});

/* -------------------------------------------------------------------------- */
/* Fix pass: extreme stored values, the method radio, viewer copy              */
/* -------------------------------------------------------------------------- */

describe("business pages with extreme stored values", () => {
  it("Requirements: a stored custom document type is named in full, on the box and below it", () => {
    const savedRow = { minimum_rental_age: 25, verification_document_type: "residence_permit_with_biometric_chip_issued_abroad" };
    render(
      <Harness
        page="requirements"
        saved={savedRow}
        render={({ form, setForm }) => (
          <RequirementsPageV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit
            onSave={vi.fn()}
            idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: () => undefined }}
          />
        )}
      />,
    );
    expect(container.querySelector("#v2_verification_document_type")?.getAttribute("title")).toBe(
      "Residence permit with biometric chip issued abroad (current)",
    );
    expect(text()).toContain("Saved as “Residence permit with biometric chip issued abroad”, which isn't one of the standard choices.");
  });

  it("Requirements: a standard document type adds no note", () => {
    const savedRow = { minimum_rental_age: 25, verification_document_type: "passport" };
    render(
      <Harness
        page="requirements"
        saved={savedRow}
        render={({ form, setForm }) => (
          <RequirementsPageV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit
            onSave={vi.fn()}
            idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: () => undefined }}
          />
        )}
      />,
    );
    expect(text()).not.toContain("isn't one of the standard choices");
  });

  it("Booking rules: 7-digit stored values get a box wide enough, and an invalid buffer drops the 'booked again straight away' copy", () => {
    const savedRow = {
      booking_lead_time_hours: 9999999,
      booking_lead_time_unit: "hours",
      min_rental_days: 0,
      min_rental_hours: 4,
      max_rental_days: 9999999,
      buffer_time_minutes: 9999999,
    };
    render(
      <Harness
        page="duration"
        saved={savedRow}
        render={({ form, setForm }) => <DurationPageV2 form={form} setForm={setForm} saved={savedRow} canEdit onSave={vi.fn()} />}
      />,
    );
    expect(input('input[aria-label="Advance notice"]').className).toContain("w-32");
    expect(input('input[aria-label="Longest rental days"]').className).toContain("w-32");
    expect(input('input[aria-label="Time between rentals in minutes"]').className).toContain("w-32");
    expect(input('input[aria-label="Shortest rental hours"]').className).toContain("w-16");
    expect(text()).toContain("Keep this to 4,320 minutes (3 days) or less.");
    expect(text()).not.toContain("A car can be booked again as soon as a rental ends.");
    expect(text()).toContain("How long a car stays off the booking site after a rental ends, so you can clean and check it.");
  });

  it("Customer messages: a stored 9,999-hour reminder is flagged on load, before any blur", () => {
    const savedRow = { return_reminder_enabled: true, return_reminder_hours: 9999 };
    render(
      <Harness
        page="return-reminder"
        saved={savedRow}
        render={({ form, setForm }) => (
          <ReturnReminderPanelV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit
            onSave={vi.fn()}
            smsReady
            emailTemplateHref="/settings/email-templates/rental_reminder"
            integrationsHref="/integrations?open=Twilio%20Messages"
          />
        )}
      />,
    );
    expect(text()).toContain("The saved value, 9,999 hours, is outside the allowed 1–168 hours (7 days). Enter a value in that range and save.");
    expect(text()).not.toContain("Between 1 and 168 hours (7 days).");
    // Nothing was changed for them: no unsaved edit, Save stays off.
    expect(button("Save").disabled).toBe(true);
  });

  it("Customer messages: a viewer is offered to view the email, not edit it", () => {
    const savedRow = { return_reminder_enabled: true, return_reminder_hours: 24 };
    render(
      <Harness
        page="return-reminder"
        saved={savedRow}
        render={({ form, setForm }) => (
          <ReturnReminderPanelV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit={false}
            onSave={vi.fn()}
            smsReady
            emailTemplateHref="/settings/email-templates/rental_reminder"
            integrationsHref="/integrations?open=Twilio%20Messages"
          />
        )}
      />,
    );
    expect(container.querySelector('a[href="/settings/email-templates/rental_reminder"]')?.textContent).toBe("View the email");
  });
});

describe("Key handover: links", () => {
  it("inline links lighten in dark mode", () => {
    const savedRow = { lockbox_enabled: false, lockbox_code_length: 6, lockbox_notification_methods: ["email"], lockbox_send_offset_minutes: 45 };
    render(
      <Harness
        page="lockbox"
        saved={savedRow}
        render={({ form, setForm }) => (
          <LockboxPageV2
            form={form}
            setForm={setForm}
            saved={savedRow}
            canEdit
            onSave={vi.fn()}
            vehiclesHref="/vehicles"
            templatesHref={TEMPLATES_HREF}
          />
        )}
      />,
    );
    expect(container.querySelector('a[href="/vehicles"]')?.className).toContain("dark:text-[hsl(var(--v2-link,var(--primary)))]");
    expect(container.querySelector(`a[href="${TEMPLATES_HREF}"]`)?.className).toContain("dark:text-[hsl(var(--v2-link,var(--primary)))]");
  });
});

describe("inside the page's one save bar (SettingsPageSaveProvider)", () => {
  /** The last registration under `key` that carried a save. */
  const registered = (registerSave: ReturnType<typeof vi.fn>, key: string) => {
    const calls = registerSave.mock.calls.filter((call) => call[0] === key && call[1]);
    return calls[calls.length - 1] as [string, () => Promise<unknown>, () => void] | undefined;
  };

  it("Driver requirements shows no Save; it registers a save and a discard the page runs", async () => {
    const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const registerSave = vi.fn();
    render(
      <SettingsPageSaveProvider>
        <Harness
          page="requirements"
          saved={saved}
          render={({ form, setForm }) => (
            <RequirementsPageV2
              form={form}
              setForm={setForm}
              saved={saved}
              canEdit
              onSave={onSave}
              registerSave={registerSave}
              idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: () => undefined }}
            />
          )}
        />
      </SettingsPageSaveProvider>,
    );
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim())).not.toContain("Save");
    expect(registered(registerSave, "business-requirements")).toBeUndefined();

    typeInto(input("#v2_minimum_rental_age"), "25");
    expect(text()).not.toContain("Unsaved changes");
    const [, save, discard] = registered(registerSave, "business-requirements")!;
    expect(typeof discard).toBe("function");

    // The page's Save changes: this page's two fields only.
    await act(async () => {
      await save();
    });
    expect(onSave).toHaveBeenCalledWith({ minimum_rental_age: 25, verification_document_type: "passport" });

    // The page's Reset: back to the saved 21.
    act(() => discard());
    expect(input("#v2_minimum_rental_age").value).toBe("21");
  });

  it("a failed save still says why inline, with no button", async () => {
    const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
    const onSave = vi.fn().mockRejectedValue({ code: "42501", message: "permission denied for table tenants" });
    const registerSave = vi.fn();
    render(
      <SettingsPageSaveProvider>
        <Harness
          page="requirements"
          saved={saved}
          render={({ form, setForm }) => (
            <RequirementsPageV2
              form={form}
              setForm={setForm}
              saved={saved}
              canEdit
              onSave={onSave}
              registerSave={registerSave}
              idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: () => undefined }}
            />
          )}
        />
      </SettingsPageSaveProvider>,
    );
    typeInto(input("#v2_minimum_rental_age"), "25");
    const [, save] = registered(registerSave, "business-requirements")!;
    await act(async () => {
      await save().catch(() => undefined);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save. You don't have permission to change this. Ask an admin.",
    );
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Retry"))).toBe(false);
  });

  it("Key handover's 'not applied yet' note points at Save changes", () => {
    const saved = { lockbox_enabled: false, lockbox_code_length: null, lockbox_notification_methods: ["email"], lockbox_send_offset_minutes: null };
    render(
      <SettingsPageSaveProvider>
        <Harness
          page="lockbox"
          saved={saved}
          render={({ form, setForm }) => (
            <LockboxPageV2
              form={form}
              setForm={setForm}
              saved={saved}
              canEdit
              onSave={vi.fn()}
              vehiclesHref="/vehicles"
              templatesHref={TEMPLATES_HREF}
            />
          )}
        />
      </SettingsPageSaveProvider>,
    );
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Enable lockbox handover"]')!;
    act(() => toggle.click());
    expect(text()).toContain("Not applied yet. Press Save changes to turn lockbox handover on.");
  });
});

describe("row spacing", () => {
  it("Shortest rental keeps each unit beside its own box: [days box] days, then [hours box] hours", () => {
    const saved = { booking_lead_time_hours: 24, min_rental_days: 1, min_rental_hours: 4, max_rental_days: 90, buffer_time_minutes: 0 };
    render(
      <Harness
        page="duration"
        saved={saved}
        render={({ form, setForm }) => <DurationPageV2 form={form} setForm={setForm} saved={saved} canEdit onSave={vi.fn()} />}
      />,
    );
    const days = input('input[aria-label="Shortest rental days"]');
    const hours = input('input[aria-label="Shortest rental hours"]');
    expect(days.parentElement!.textContent).toBe("days");
    expect(hours.parentElement!.textContent).toBe("hours");
    expect(days.parentElement!.className).toContain("gap-1.5");
    expect(days.parentElement!.parentElement).toBe(hours.parentElement!.parentElement);
    expect(days.parentElement!.parentElement!.className).toContain("gap-x-4");
  });

  it("the return reminder switch carries no extra left margin on top of the row gap", () => {
    const saved = { return_reminder_enabled: true, return_reminder_hours: 24 };
    render(
      <Harness
        page="return-reminder"
        saved={saved}
        render={({ form, setForm }) => (
          <ReturnReminderPanelV2
            form={form}
            setForm={setForm}
            saved={saved}
            canEdit
            onSave={vi.fn()}
            smsReady
            emailTemplateHref="/settings/email-templates/rental_reminder"
            integrationsHref="/integrations"
          />
        )}
      />,
    );
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Send return reminders"]')!;
    expect(toggle.className.split(/\s+/)).not.toContain("ml-2");
    expect(input('input[aria-label="Hours before return"]').parentElement!.textContent).toBe("hours before");
  });

  it("the ID waiver's two notes are spaced apart", () => {
    const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
    render(
      <Harness
        page="requirements"
        saved={saved}
        render={({ form, setForm }) => (
          <RequirementsPageV2
            form={form}
            setForm={setForm}
            saved={saved}
            canEdit
            onSave={vi.fn()}
            idWaiver={{ enabled: true, canChange: true, saving: false, onToggle: () => undefined }}
          />
        )}
      />,
    );
    const note = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === "Saves as soon as you switch it.")!;
    expect(note.parentElement!.className).toBe("space-y-1");
    expect(note.parentElement!.children).toHaveLength(2);
  });
});

describe("v2 controls (ui-v2 Select, Input and Switch)", () => {
  it("Driver requirements: the ID document is the v2 dropdown, the age box and the waiver switch are v2", () => {
    const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
    render(
      <Harness
        page="requirements"
        saved={saved}
        render={({ form, setForm }) => (
          <RequirementsPageV2
            form={form}
            setForm={setForm}
            saved={saved}
            canEdit
            onSave={vi.fn()}
            idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: () => undefined }}
          />
        )}
      />,
    );
    expect(container.querySelector("#v2_verification_document_type")?.getAttribute("data-slot")).toBe("select-trigger");
    expect(input("#v2_minimum_rental_age").getAttribute("data-slot")).toBe("input");
    expect(container.querySelector('[aria-label="Allow rentals without ID verification"]')?.getAttribute("data-slot")).toBe("switch");
  });

  it("Booking rules: the advance notice unit is the v2 dropdown", () => {
    const saved = { booking_lead_time_hours: 24, booking_lead_time_unit: "hours", min_rental_days: 0, min_rental_hours: 4, max_rental_days: 90, buffer_time_minutes: 0 };
    render(
      <Harness
        page="duration"
        saved={saved}
        render={({ form, setForm }) => <DurationPageV2 form={form} setForm={setForm} saved={saved} canEdit onSave={vi.fn()} />}
      />,
    );
    expect(container.querySelector('[aria-label="Advance notice unit"]')?.getAttribute("data-slot")).toBe("select-trigger");
  });

  it("Key handover: Send it automatically is the v2 dropdown, and the switch is v2", () => {
    const saved = { lockbox_enabled: true, lockbox_code_length: 6, lockbox_notification_methods: ["email"], lockbox_send_offset_minutes: 45 };
    render(
      <Harness
        page="lockbox"
        saved={saved}
        render={({ form, setForm }) => (
          <LockboxPageV2 form={form} setForm={setForm} saved={saved} canEdit onSave={vi.fn()} vehiclesHref="/vehicles" templatesHref={TEMPLATES_HREF} />
        )}
      />,
    );
    expect(container.querySelector("#v2_lockbox_send_offset")?.getAttribute("data-slot")).toBe("select-trigger");
    expect(container.querySelector('[aria-label="Enable lockbox handover"]')?.getAttribute("data-slot")).toBe("switch");
  });
});

describe("settings page wiring for the Business-rules pages (v2 branch)", () => {
  // Read as text: the page is too large to mount here. Behaviour of the helper is
  // covered in settings-business-rules-logic.test.ts.
  const source = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../../app/(dashboard)/settings/page.tsx"),
    "utf8",
  ) as string;

  it("offers Save when every unsaved rental edit belongs to a registered section (Business rules, fees, deposit, monthly rate)", () => {
    expect(source).toContain(
      "!rentalEditsCoveredBySections(rentalForm, lastSyncedRentalForm.current, rentalSettings, v2DirtySections);",
    );
    expect(source).toContain("const v2CanSaveEdits = canSaveV2Edits({");
    expect(source).toContain("canSave: v2CanSaveEdits,");
    // The old business-only check is gone from the page.
    expect(source).not.toContain("canSaveAllDirty(");
  });

  it("has no 'Unsaved changes' chip row under the header: one save bar at the end of the page says it", () => {
    expect(source).not.toContain("V2_PAGES_WITH_OWN_SAVE_STATUS");
    // The Business-rules pages, Booking site, Tax and fees and Security deposit
    // are sections of General, so they save through General's bar.
    expect(source).toContain("const V2_PAGES_WITH_SAVE_BAR = new Set(['general', 'templates', 'pricing', 'locations']);");
    expect(source).toContain("<SettingsPageSaveProvider enabled={v2PageHasSaveBar}>");
    expect(source).toContain("{canEditPage && v2PageHasSaveBar && (\n                  <SettingsStickySaveBar");
  });

  it("says why Save & Leave failed in v2, and keeps the v1 wording for everyone else", () => {
    expect(source).toContain("description: v2Chrome ? describeSaveError(err) : 'Failed to save some settings. Please try again.',");
  });
});
