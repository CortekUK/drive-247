/**
 * Notifications v2 (D14): the "Push on this device" setup card and the
 * service-worker registrar's v2 branch.
 *
 * The push hooks and lib/push are mocked: the card reuses them unchanged, so
 * these cases only check which step state and which call the card makes for
 * each thing the hooks report. Expected copy comes from the exported constants
 * or is the behaviour itself (a switch, a disabled button, a tick).
 *
 * HARNESS: `react-dom/client` + `act`, as in settings-messages-v2.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  v2: { on: true },
  tenant: { value: { id: "t1", slug: "northwind", push_notifications_enabled: true } as any },
  push: {} as any,
  pwa: {} as any,
  usePush: { calls: 0 },
  lib: {
    capturePwaInstallPrompt: vi.fn(() => () => undefined),
    registerServiceWorker: vi.fn(async () => null),
    registerServiceWorkerV2: vi.fn(async () => null),
  },
}));

vi.mock("@/lib/v2-context", () => ({
  useV2: () => h.v2.on,
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant.value }) }));
vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => {
    h.usePush.calls += 1;
    return h.push;
  },
  usePushLog: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-pwa-install", () => ({ usePwaInstall: () => h.pwa }));
vi.mock("@/lib/push", () => ({
  capturePwaInstallPrompt: h.lib.capturePwaInstallPrompt,
  registerServiceWorker: h.lib.registerServiceWorker,
  registerServiceWorkerV2: h.lib.registerServiceWorkerV2,
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));

import {
  PUSH_SETUP_OFF_COPY,
  PUSH_SETUP_TEST_MESSAGE,
  PUSH_SUPPORT_HREF,
  PushSetupV2,
  pushSetupPlatform,
  pushSetupState,
} from "@/components/settings-v2/notifications-v2/push-setup-v2";
import { ServiceWorkerRegistrar } from "@/components/push/service-worker-registrar";

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container;
}

const text = () => container.textContent ?? "";
const step = (id: string) => container.querySelector(`[data-step="${id}"]`) as HTMLElement;
const switchEl = () => container.querySelector('[role="switch"]') as HTMLButtonElement | null;

function buttonByText(name: string): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll("button"));
  const hit = all.find((b) => b.textContent?.trim() === name);
  if (!hit) throw new Error(`No button "${name}" in: ${all.map((b) => b.textContent?.trim()).join(" | ")}`);
  return hit;
}

async function clickAsync(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

function resetPush(overrides: Record<string, unknown> = {}) {
  h.push = {
    isSupported: true,
    needsInstall: false,
    isEnabledForTenant: true,
    permission: "default",
    isSubscribed: false,
    isLoading: false,
    isBusy: false,
    error: null,
    capability: { supported: true, needsInstall: false, platform: "android", standalone: false },
    enable: vi.fn(async () => true),
    disable: vi.fn(async () => true),
    sendPush: { isPending: false, mutateAsync: vi.fn(async () => ({ success: true, sent: 1, failed: 0, expired: 0 })) },
    ...overrides,
  };
}

function resetPwa(overrides: Record<string, unknown> = {}) {
  h.pwa = {
    isInstalled: false,
    canPrompt: false,
    needsManualInstall: false,
    install: vi.fn(async () => true),
    ...overrides,
  };
}

/** An iPhone in a Safari tab: no push APIs until it is installed. */
function iphoneInSafari() {
  resetPush({
    isSupported: false,
    needsInstall: true,
    permission: "unsupported",
    capability: { supported: false, needsInstall: true, platform: "ios", standalone: false },
  });
  resetPwa({ needsManualInstall: true });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.v2.on = true;
  h.tenant.value = { id: "t1", slug: "northwind", push_notifications_enabled: true };
  h.usePush.calls = 0;
  h.lib.capturePwaInstallPrompt.mockClear();
  h.lib.registerServiceWorker.mockClear();
  h.lib.registerServiceWorkerV2.mockClear();
  resetPush();
  resetPwa();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Registrar                                                                   */
/* -------------------------------------------------------------------------- */

describe("ServiceWorkerRegistrar: v2 script only for v2", () => {
  it("v2 chrome with push on: registers the v2 worker after the delay, never the v1 one", () => {
    vi.useFakeTimers();
    render(<ServiceWorkerRegistrar />);
    expect(h.lib.capturePwaInstallPrompt).toHaveBeenCalledTimes(1);
    expect(h.lib.registerServiceWorkerV2).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(h.lib.registerServiceWorkerV2).toHaveBeenCalledTimes(1);
    expect(h.lib.registerServiceWorker).not.toHaveBeenCalled();
  });

  it("every other tenant: the v1 worker, exactly as before", () => {
    vi.useFakeTimers();
    h.v2.on = false;
    render(<ServiceWorkerRegistrar />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(h.lib.capturePwaInstallPrompt).toHaveBeenCalledTimes(1);
    expect(h.lib.registerServiceWorker).toHaveBeenCalledTimes(1);
    expect(h.lib.registerServiceWorkerV2).not.toHaveBeenCalled();
  });

  it("push off for the tenant: registers nothing, v2 or not", () => {
    vi.useFakeTimers();
    h.tenant.value = { id: "t1", slug: "northwind", push_notifications_enabled: false };
    render(<ServiceWorkerRegistrar />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(h.lib.capturePwaInstallPrompt).not.toHaveBeenCalled();
    expect(h.lib.registerServiceWorker).not.toHaveBeenCalled();
    expect(h.lib.registerServiceWorkerV2).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Pure state                                                                  */
/* -------------------------------------------------------------------------- */

describe("pushSetupState", () => {
  const base = {
    platform: "other" as const,
    installed: false,
    needsInstall: false,
    supported: true,
    permission: "default" as NotificationPermission,
    subscribed: false,
    loading: false,
  };

  it("iPhone in a Safari tab: install is needed and step 2 waits for it (never 'unsupported')", () => {
    expect(pushSetupState({ ...base, platform: "iphone", needsInstall: true, supported: false, permission: "unsupported" as any })).toEqual({
      install: "required",
      allow: "needs-install",
      canTest: false,
    });
  });

  it("Android/computer: install is recommended, not required", () => {
    expect(pushSetupState(base)).toEqual({ install: "recommended", allow: "off", canTest: false });
  });

  it("installed and enrolled: everything but the test is done, and the test can run", () => {
    expect(pushSetupState({ ...base, installed: true, subscribed: true, permission: "granted" })).toEqual({
      install: "done",
      allow: "on",
      canTest: true,
    });
  });

  it("blocked wins over a stale subscription", () => {
    expect(pushSetupState({ ...base, subscribed: true, permission: "denied" }).allow).toBe("blocked");
  });

  it("a browser without push, not an uninstalled iPhone, is unsupported", () => {
    expect(pushSetupState({ ...base, supported: false, permission: "unsupported" as any }).allow).toBe("unsupported");
  });

  it("maps the detected platform", () => {
    expect(pushSetupPlatform("ios")).toBe("iphone");
    expect(pushSetupPlatform("android")).toBe("other");
    expect(pushSetupPlatform("desktop")).toBe("other");
    expect(pushSetupPlatform("unknown")).toBe("other");
  });
});

/* -------------------------------------------------------------------------- */
/* The card                                                                    */
/* -------------------------------------------------------------------------- */

describe("PushSetupV2: gates", () => {
  it("tenant not loaded yet: a loading skeleton, and the push hook isn't mounted", () => {
    h.tenant.value = null;
    render(<PushSetupV2 />);
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    expect(h.usePush.calls).toBe(0);
  });

  it("push off for the account: the calm state with the support link, and no worker or hook", () => {
    h.tenant.value = { id: "t1", slug: "northwind", push_notifications_enabled: false };
    render(<PushSetupV2 />);
    expect(text()).toContain(PUSH_SETUP_OFF_COPY.headline);
    expect(text()).toContain(PUSH_SETUP_OFF_COPY.body);
    const link = container.querySelector(`a[href="${PUSH_SUPPORT_HREF}"]`);
    expect(link?.textContent).toBe(PUSH_SETUP_OFF_COPY.action);
    expect(switchEl()).toBeNull();
    expect(h.usePush.calls).toBe(0);
    expect(h.lib.registerServiceWorkerV2).not.toHaveBeenCalled();
  });

  it("push on: registers the v2 worker itself, before the hook can register v1", () => {
    render(<PushSetupV2 />);
    expect(h.lib.registerServiceWorkerV2).toHaveBeenCalledTimes(1);
    expect(h.lib.registerServiceWorker).not.toHaveBeenCalled();
  });

  it("rendered outside v2 chrome: never registers the v2 worker", () => {
    h.v2.on = false;
    render(<PushSetupV2 />);
    expect(h.lib.registerServiceWorkerV2).not.toHaveBeenCalled();
  });
});

describe("PushSetupV2: install step", () => {
  it("iPhone in Safari: the Home Screen steps, step 2 waits, and the Android steps stay behind a toggle", async () => {
    iphoneInSafari();
    render(<PushSetupV2 />);
    const install = step("install");
    expect(install.querySelector('[data-install-steps="iphone"]')).not.toBeNull();
    expect(install.textContent).toContain("Add to Home Screen");
    expect(install.querySelector('[data-install-steps="other"]')).toBeNull();

    expect(step("allow").querySelector('[data-allow-state="needs-install"]')).not.toBeNull();
    expect(switchEl()).toBeNull();
    expect(buttonByText("Send a test").disabled).toBe(true);

    const toggle = buttonByText("On Android or a computer? Show those steps");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await clickAsync(toggle);
    expect(install.querySelector('[data-install-steps="other"]')).not.toBeNull();
    expect(buttonByText("Hide Android and computer steps").getAttribute("aria-expanded")).toBe("true");
  });

  it("Android with an install prompt: an Install button that runs the prompt", async () => {
    resetPwa({ canPrompt: true });
    render(<PushSetupV2 />);
    const install = step("install");
    expect(install.querySelector('[data-install-steps="iphone"]')).toBeNull();
    await clickAsync(buttonByText("Install"));
    expect(h.pwa.install).toHaveBeenCalledTimes(1);
    expect(install.querySelector('[role="status"]')).not.toBeNull();
  });

  it("Android without a prompt: points at the browser menu instead of a dead button", () => {
    render(<PushSetupV2 />);
    const install = step("install");
    expect(install.querySelector('[data-install-steps="other"]')).not.toBeNull();
    expect(Array.from(install.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Install")).toBe(false);
    expect(install.textContent).toContain("Install app");
  });

  it("installed (standalone): ticked, with no instructions", () => {
    resetPush({ capability: { supported: true, needsInstall: false, platform: "ios", standalone: true } });
    render(<PushSetupV2 />);
    const install = step("install");
    expect(install.getAttribute("data-done")).toBe("true");
    expect(install.querySelector("[data-install-steps]")).toBeNull();
  });

  it("installing is not gated by edit rights", () => {
    resetPwa({ canPrompt: true });
    render(<PushSetupV2 canEdit={false} />);
    expect(buttonByText("Install").disabled).toBe(false);
  });
});

describe("PushSetupV2: allow step", () => {
  it("unsupported browser: says so, no switch, no test", () => {
    resetPush({
      isSupported: false,
      permission: "unsupported",
      capability: { supported: false, needsInstall: false, platform: "desktop", standalone: false },
    });
    render(<PushSetupV2 />);
    expect(step("allow").querySelector('[data-allow-state="unsupported"]')).not.toBeNull();
    expect(switchEl()).toBeNull();
    expect(buttonByText("Send a test").disabled).toBe(true);
  });

  it("blocked: the switch is locked and the page says how to unblock on this platform", () => {
    resetPush({ permission: "denied" });
    render(<PushSetupV2 />);
    const blocked = step("allow").querySelector('[data-allow-state="blocked"]')!;
    expect(blocked).not.toBeNull();
    expect(blocked.textContent).toContain("site settings");
    expect(switchEl()!.disabled).toBe(true);
  });

  it("blocked on an installed iPhone: the iPhone Settings route", () => {
    resetPush({ permission: "denied", capability: { supported: true, needsInstall: false, platform: "ios", standalone: true } });
    render(<PushSetupV2 />);
    expect(step("allow").querySelector('[data-allow-state="blocked"]')!.textContent).toContain("Allow Notifications");
  });

  it("off: the switch turns push on for this device", async () => {
    render(<PushSetupV2 />);
    expect(switchEl()!.getAttribute("aria-checked")).toBe("false");
    await clickAsync(switchEl()!);
    expect(h.push.enable).toHaveBeenCalledTimes(1);
    expect(h.push.disable).not.toHaveBeenCalled();
  });

  it("on: ticked, and the switch turns it off", async () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    render(<PushSetupV2 />);
    expect(step("allow").getAttribute("data-done")).toBe("true");
    expect(switchEl()!.getAttribute("aria-checked")).toBe("true");
    await clickAsync(switchEl()!);
    expect(h.push.disable).toHaveBeenCalledTimes(1);
  });

  it("view only: the switch and the test are locked, as on the existing push screen", () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    render(<PushSetupV2 canEdit={false} />);
    expect(switchEl()!.disabled).toBe(true);
    expect(buttonByText("Send a test").disabled).toBe(true);
  });

  it("an enrol failure from the hook is shown under the step", () => {
    resetPush({ error: "Could not save subscription" });
    render(<PushSetupV2 />);
    expect(step("allow").querySelector('[role="alert"]')!.textContent).toBe("Could not save subscription");
  });
});

describe("PushSetupV2: test step", () => {
  it("sends the test to 'Just my devices' through the existing hook, then asks if it arrived", async () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    render(<PushSetupV2 />);
    await clickAsync(buttonByText("Send a test"));
    expect(h.push.sendPush.mutateAsync).toHaveBeenCalledWith({ target: "self", ...PUSH_SETUP_TEST_MESSAGE });

    const result = step("test").querySelector('[data-test-result="sent"]')!;
    expect(result.textContent).toContain("Sent to 1 of your device.");
    expect(step("test").getAttribute("data-done")).toBeNull();

    await clickAsync(buttonByText("Yes"));
    expect(step("test").getAttribute("data-done")).toBe("true");
    expect(step("test").querySelector('[data-arrived="yes"]')).not.toBeNull();
  });

  it("'No, it didn't arrive' lists what to check, with the iPhone-only item only on iPhone", async () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    render(<PushSetupV2 />);
    await clickAsync(buttonByText("Send a test"));
    await clickAsync(buttonByText("No"));
    const tips = step("test").querySelector('[data-arrived="no"]')!;
    expect(tips.querySelectorAll("li")).toHaveLength(3);
    expect(tips.textContent).not.toContain("Home Screen");
  });

  it("nothing to send to: says so plainly, not as an error", async () => {
    resetPush({
      isSubscribed: true,
      permission: "granted",
      sendPush: { isPending: false, mutateAsync: vi.fn(async () => ({ success: true, sent: 0, failed: 0, expired: 0 })) },
    });
    render(<PushSetupV2 />);
    await clickAsync(buttonByText("Send a test"));
    expect(step("test").querySelector('[data-test-result="none"]')).not.toBeNull();
    expect(step("test").querySelector('[role="alert"]')).toBeNull();
  });

  it("a failed send shows the reason inline", async () => {
    resetPush({
      isSubscribed: true,
      permission: "granted",
      sendPush: {
        isPending: false,
        mutateAsync: vi.fn(async () => {
          throw new Error("Your role cannot send notifications");
        }),
      },
    });
    render(<PushSetupV2 />);
    await clickAsync(buttonByText("Send a test"));
    const error = step("test").querySelector('[data-test-result="error"]')!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("Your role cannot send notifications");
  });

  it("onSendTest replaces the default send, and its result is shown", async () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    const onSendTest = vi.fn(async () => ({ success: true, sent: 2, failed: 1 }));
    render(<PushSetupV2 onSendTest={onSendTest} />);
    await clickAsync(buttonByText("Send a test"));
    expect(onSendTest).toHaveBeenCalledTimes(1);
    expect(h.push.sendPush.mutateAsync).not.toHaveBeenCalled();
    expect(step("test").querySelector('[data-test-result="sent"]')!.textContent).toContain("Sent to 2 of your devices");
  });

  it("onSendTest reporting a failure shows its error", async () => {
    resetPush({ isSubscribed: true, permission: "granted" });
    render(<PushSetupV2 onSendTest={async () => ({ success: false, error: "Too many tests this hour." })} />);
    await clickAsync(buttonByText("Send a test"));
    expect(step("test").querySelector('[data-test-result="error"]')!.textContent).toContain("Too many tests this hour.");
  });

  it("not enrolled yet: the test waits for step 2", () => {
    render(<PushSetupV2 />);
    expect(buttonByText("Send a test").disabled).toBe(true);
    expect(step("test").textContent).toContain("step 2");
  });
});
