/**
 * SetupReminderDialog — v1 keeps it, v2 never sees it.
 *
 * "Finish setting up your portal" (Bonzah insurance / Upload your logo /
 * Connect Stripe) is going away on v2: the same nudge comes back as a system
 * announcement, which is switched on and off from the announcements admin
 * rather than opening itself. Until then the dialog must simply not be there
 * for a v2 tenant — and must be EXACTLY what it is today for the other ~56.
 *
 * The strong half of this file is the second assertion. The component is
 * mounted unconditionally by `(dashboard)/layout.tsx`, so the gate lives inside
 * the component, and "not shown" has to mean "nothing ran": no `setup-reminder`
 * query, no subscription or migration read, and no touching that tenant's
 * `setup-reminder-dismissed-*` / `-snoozed-*` keys. A gate that merely returned
 * null after the hooks would pass a "renders nothing" test while still issuing
 * three reads per v2 tenant and while a later un-gating found its snooze key
 * already written by a dialog that was never on screen.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `connect-stripe-required-dialog.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SetupReminderDialog } from "@/components/dashboard/setup-reminder-dialog";
import { V2Provider } from "@/lib/v2-context";

const TENANT_ID = "tenant-1";

/* Every hook the dialog's body calls, counted rather than merely stubbed — the
   counts are what prove a v2 tenant runs none of them. */
const useSetupReminder = vi.fn(() => ({
  needsLogo: true,
  needsStripe: true,
  needsBonzah: true,
  allDone: false,
  isReady: true,
  isLoading: false,
}));
const useTenantSubscription = vi.fn(() => ({
  isSubscribed: true,
  hasExpiredSubscription: false,
  isResolved: true,
}));
const useMigrationStatus = vi.fn(() => ({
  migrationPromptShowing: false,
  hideStripeTask: false,
  isLoading: false,
}));

vi.mock("@/hooks/use-setup-reminder", () => ({
  useSetupReminder: (...args: unknown[]) => (useSetupReminder as any)(...args),
}));
vi.mock("@/hooks/use-tenant-subscription", () => ({
  useTenantSubscription: (...args: unknown[]) => (useTenantSubscription as any)(...args),
}));
vi.mock("@/hooks/use-migration-status", () => ({
  useMigrationStatus: (...args: unknown[]) => (useMigrationStatus as any)(...args),
}));

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: TENANT_ID }, refetchTenant: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
// No system announcement is due in this file, so the dialog is free to show —
// which is what makes "nothing on screen" on v2 mean the v2 gate and not the
// announcement interlock.
vi.mock("@/lib/announcements/system-priority", () => ({
  useYieldToSystemAnnouncements: (wants: boolean) => ({
    show: wants,
    engaged: false,
    engage: vi.fn(),
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let readKeys: string[];
let writtenKeys: string[];
const originals = new Map<string, PropertyDescriptor | undefined>();

/**
 * A recording Storage, installed the same way `__tests__/setup.ts` installs its
 * in-memory one.
 *
 * NOT `vi.spyOn(window.sessionStorage, 'getItem')`: jsdom's Storage is a Proxy
 * whose traps turn a defined property into an ITEM, so the spy is stored under
 * the key "getItem" and the real method keeps answering. The spy then records
 * nothing and the assertion below passes no matter what the component does.
 */
function installRecordingStorage(name: "localStorage" | "sessionStorage") {
  const storage: Storage = {
    length: 0,
    key: () => null,
    getItem: (key: string) => {
      readKeys.push(key);
      return null;
    },
    setItem: (key: string) => {
      writtenKeys.push(key);
    },
    removeItem: () => {},
    clear: () => {},
  };
  for (const target of [window, globalThis] as any[]) {
    const key = `${name}:${target === window ? "window" : "globalThis"}`;
    if (!originals.has(key)) {
      originals.set(key, Object.getOwnPropertyDescriptor(target, name));
    }
    Object.defineProperty(target, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  readKeys = [];
  writtenKeys = [];
  installRecordingStorage("localStorage");
  installRecordingStorage("sessionStorage");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  for (const [key, descriptor] of originals) {
    const [name, scope] = key.split(":");
    const target: any = scope === "window" ? window : globalThis;
    if (descriptor) Object.defineProperty(target, name, descriptor);
  }
  originals.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Radix portals the dialog to document.body, so query the whole document. */
const dialogText = () =>
  document.querySelector('[role="dialog"]')?.textContent ?? "";

const paint = async (chrome: boolean) => {
  await act(async () => {
    root.render(
      <V2Provider flags={chrome ? { chrome: true } : {}}>
        <SetupReminderDialog />
      </V2Provider>,
    );
  });
};

describe("SetupReminderDialog — v2 gate", () => {
  it("still opens for a v1 tenant with outstanding setup tasks", async () => {
    await paint(false);

    expect(dialogText()).toContain("Finish setting up your portal");
    // The three task rows, unchanged.
    expect(dialogText()).toContain("Bonzah insurance");
    expect(dialogText()).toContain("Upload your logo");
    expect(dialogText()).toContain("Connect Stripe");
    expect(dialogText()).toContain("Don't show me again");

    // Positive control for the assertion below: v1 DOES run these.
    expect(useSetupReminder).toHaveBeenCalled();
    expect(useTenantSubscription).toHaveBeenCalled();
    expect(useMigrationStatus).toHaveBeenCalled();
    expect(readKeys).toContain(`setup-reminder-dismissed-${TENANT_ID}`);
    expect(readKeys).toContain(`setup-reminder-snoozed-${TENANT_ID}`);
  });

  it("renders nothing for a v2 tenant", async () => {
    await paint(true);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("runs no query and touches no storage key for a v2 tenant", async () => {
    await paint(true);

    expect(useSetupReminder).not.toHaveBeenCalled();
    expect(useTenantSubscription).not.toHaveBeenCalled();
    expect(useMigrationStatus).not.toHaveBeenCalled();
    expect(readKeys).toEqual([]);
    expect(writtenKeys).toEqual([]);
  });
});
