/**
 * v2 Settings › Key handover › Lockbox messages
 * (`components/settings-v2/lockbox-templates-v2.tsx`): every state of the
 * editor that carries the lockbox code to the customer.
 *
 * HARNESS: `react-dom/client` + `act`, like the other settings state tests.
 * Tenant, rental settings, templates, permissions and toast are mocked, so
 * nothing here touches Supabase. Expected counts are worked out by hand in the
 * comments beside them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const DEFAULT_SMS = "Your vehicle {{vehicle_reg}} has been delivered. Lockbox code: {{lockbox_code}}. Ref: {{booking_ref}}";
const DEFAULTS = {
  instructions: "1. Go to the car",
  email: { subject: "Your Vehicle Keys - Lockbox Code", body: "Code: {{lockbox_code}}" },
  sms: { body: DEFAULT_SMS },
};

const state = vi.hoisted(() => ({
  tenant: { id: "t1", integration_twilio_sms: false } as Record<string, unknown> | null,
  rental: {} as Record<string, any>,
  templates: {} as Record<string, any>,
  canEdit: true,
}));

vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: state.tenant }) }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => state.rental }));
vi.mock("@/hooks/use-lockbox-templates", () => ({ useLockboxTemplates: () => state.templates }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => state.canEdit, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LockboxTemplatesSectionV2 } from "@/components/settings-v2/lockbox-templates-v2";

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

function mount(registerSave?: any) {
  act(() =>
    root.render(
      <LockboxTemplatesSectionV2 defaults={DEFAULTS} variables={[{ key: "{{lockbox_code}}", desc: "The code" }]} registerSave={registerSave} />,
    ),
  );
}

function setTextarea(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const sms = () => container.querySelector<HTMLTextAreaElement>("#v2-lockbox-sms")!;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.tenant = { id: "t1", integration_twilio_sms: false };
  state.canEdit = true;
  state.rental = {
    settings: { lockbox_enabled: true, lockbox_code_length: 6, lockbox_default_instructions: "Box by the gate" },
    hasLoaded: true,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    updateSettings: vi.fn().mockResolvedValue({}),
  };
  state.templates = {
    templates: [],
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    getEmailTemplate: () => DEFAULTS.email,
    getSmsTemplate: () => DEFAULTS.sms,
    saveTemplate: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LockboxTemplatesSectionV2 load states", () => {
  it("shows a skeleton, not 'Lockbox handover is off', while the rental settings are still placeholder defaults", () => {
    // The hook's placeholder row says lockbox is off; only hasLoaded tells it apart.
    state.rental = { ...state.rental, settings: { lockbox_enabled: false }, hasLoaded: false };
    mount();
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(text()).not.toContain("Lockbox handover is off");
  });

  it("shows the load error with a working retry when the first read failed", () => {
    state.rental = { ...state.rental, settings: { lockbox_enabled: false }, hasLoaded: false, error: new Error("Failed to fetch") };
    mount();
    expect(text()).toContain("Couldn't load lockbox settings");
    expect(text()).toContain("We couldn't reach the server. Check your connection and try again.");
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Try loading lockbox settings again"]')!;
    act(() => retry.click());
    expect(state.rental.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor when a refresh fails over loaded settings", () => {
    state.rental = { ...state.rental, error: new Error("Failed to fetch") };
    mount();
    expect(sms()).not.toBeNull();
    expect(text()).not.toContain("Couldn't load lockbox settings");
  });

  it("says lockbox handover is off without waiting for the templates", () => {
    state.rental = { ...state.rental, settings: { lockbox_enabled: false } };
    state.templates = { ...state.templates, templates: undefined };
    mount();
    expect(text()).toContain("Lockbox handover is off");
  });

  it("waits for the templates, then shows their load error with a retry", () => {
    state.templates = { ...state.templates, templates: undefined };
    mount();
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();

    state.templates = { ...state.templates, templates: undefined, error: new Error("boom") };
    mount();
    expect(text()).toContain("Couldn't load lockbox message templates");
    expect(sms()).toBeNull();
  });
});

describe("LockboxTemplatesSectionV2 text message", () => {
  it("counts the message as sent, with example details and the tenant's 6-digit code", () => {
    mount();
    // "Your vehicle " 13 + "ABC-1234" 8 + " has been delivered. Lockbox code: " 35
    // + "123456" 6 + ". Ref: " 7 + "BK-104233" 9 = 78 (the raw template is 101).
    expect(text()).toContain("78 / 160");
    expect(text()).not.toContain("101 / 160");
    expect(text()).toContain("Counted with example details filled in");
  });

  it("warns that a long message goes out as 2 texts", () => {
    mount();
    // 154 letters + 1 space + a 6-digit code = 161 > 160, and ceil(161 / 153) = 2.
    setTextarea(sms(), `${"a".repeat(154)} {{lockbox_code}}`);
    expect(text()).toContain("161 / 160 · 2 texts");
    expect(text()).toContain("Likely sent as 2 texts: with the details filled in it comes to about 161 characters");
  });

  it("says texts aren't sent until Twilio is connected, with the link", () => {
    mount();
    expect(text()).toContain("Text messages aren't set up, so this message isn't sent yet.");
    expect(container.querySelector('a[href="/integrations?open=Twilio%20Messages"]')?.textContent).toBe("Connect Twilio");
  });

  it("drops the Twilio note once Twilio is connected", () => {
    state.tenant = { id: "t1", integration_twilio_sms: true };
    mount();
    expect(text()).not.toContain("Text messages aren't set up");
  });
});

describe("LockboxTemplatesSectionV2 leaving with unsaved messages", () => {
  const registered = (registerSave: ReturnType<typeof vi.fn>) =>
    registerSave.mock.calls.filter(([k]) => k === "lockbox-messages").at(-1)?.[1];

  it("registers a save only while a message is edited, and Save & Leave writes it", async () => {
    const registerSave = vi.fn();
    mount(registerSave);
    expect(registered(registerSave)).toBeNull();

    setTextarea(sms(), "Code {{lockbox_code}} for {{vehicle_reg}}");
    const leave = registered(registerSave);
    expect(typeof leave).toBe("function");
    await act(async () => {
      await leave();
    });
    expect(state.templates.saveTemplate.mutateAsync).toHaveBeenCalledWith({ channel: "sms", body: "Code {{lockbox_code}} for {{vehicle_reg}}" });
  });

  it("refuses to leave-and-save a text without the code", async () => {
    const registerSave = vi.fn();
    mount(registerSave);
    setTextarea(sms(), "Your car is ready");
    let rejection: unknown = null;
    await act(async () => {
      await registered(registerSave)().catch((e: unknown) => (rejection = e));
    });
    expect((rejection as Error)?.message).toBe("The lockbox text message doesn't include {{lockbox_code}}. Save it on the page first.");
    expect(state.templates.saveTemplate.mutateAsync).not.toHaveBeenCalled();
  });

  it("view-only: disabled editor and nothing registered", () => {
    state.canEdit = false;
    const registerSave = vi.fn();
    mount(registerSave);
    expect(sms().matches(":disabled")).toBe(true);
    expect(registerSave).not.toHaveBeenCalled();
  });
});

describe("LockboxTemplatesSectionV2 fix pass", () => {
  const mountWith = (props: Record<string, unknown>) =>
    act(() =>
      root.render(
        <LockboxTemplatesSectionV2 defaults={DEFAULTS} variables={[{ key: "{{lockbox_code}}", desc: "The code" }]} {...props} />,
      ),
    );

  it("view-only: shows its own View only notice unless the page already does", () => {
    state.canEdit = false;
    mountWith({});
    expect(text()).toContain("View only");
    mountWith({ readOnlyNotice: false });
    expect(text()).not.toContain("View only");
  });

  it("gives every field a dark-mode fill (bg-input/50 is invalid under .dark .v2-theme)", () => {
    mountWith({});
    for (const id of ["#v2-lockbox-instructions", "#v2-lockbox-email-subject", "#v2-lockbox-email-body", "#v2-lockbox-sms"]) {
      expect(container.querySelector(id)?.className).toContain("dark:bg-muted");
    }
  });

  it("frames each message block like the settings panel above it", () => {
    mountWith({});
    const block = sms().closest(".rounded-xl");
    expect(block?.className).toContain("border");
    expect(block?.className).toContain("bg-card");
  });

  const openReset = async () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Reset all messages to default"]')!;
    await act(async () => trigger.click());
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Reset all")!;
    await act(async () => {
      confirm.click();
    });
  };

  it("Reset all writes the email and text first and the instructions last, then says it's done", async () => {
    const { toast } = await import("@/hooks/use-toast");
    const order: string[] = [];
    state.templates.saveTemplate.mutateAsync = vi.fn(async ({ channel }: { channel: string }) => void order.push(channel));
    state.rental.updateSettings = vi.fn(async () => void order.push("instructions"));
    mountWith({});
    await openReset();
    // Instructions last: the rental-settings hook's own "Settings Updated" toast
    // is then replaced in the same tick by "Lockbox messages reset".
    expect(order).toEqual(["email", "sms", "instructions"]);
    expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toMatchObject({ title: "Lockbox messages reset" });
  });

  it("a partial Reset all says what was reset and why, without 'Your changes are still here'", async () => {
    const { toast } = await import("@/hooks/use-toast");
    state.rental.updateSettings = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mountWith({});
    await openReset();
    const last = vi.mocked(toast).mock.calls.at(-1)?.[0] as { title: string; description: string };
    expect(last.title).toBe("Couldn't reset everything");
    expect(last.description).toBe("Reset: email, text message. We couldn't reach the server.");
  });

  it("a Reset all that fails first says nothing was reset", async () => {
    const { toast } = await import("@/hooks/use-toast");
    state.templates.saveTemplate.mutateAsync = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mountWith({});
    await openReset();
    const last = vi.mocked(toast).mock.calls.at(-1)?.[0] as { description: string };
    expect(last.description).toBe("Nothing was reset. We couldn't reach the server.");
    expect(state.rental.updateSettings).not.toHaveBeenCalled();
  });
});
