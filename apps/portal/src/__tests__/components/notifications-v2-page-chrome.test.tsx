/**
 * Notifications v2 page (notifications-page-v2.tsx): the full-screen view's
 * chrome, found by the N8 QA pass (2026-11-08).
 *
 *   N8.2   a visible way back on a desktop: "← Settings" at the top of the
 *          list, an ordinary link to /settings (Esc still works too).
 *   N8.11  the D18 notice — what is saved here is kept and used by Send test,
 *          live messages still go out as they do today — is on the page: at
 *          the foot of the list on a desktop, under the header on a phone. It
 *          is NOT repeated while storage is off, when the main pane's own
 *          storage-off notice already says so.
 *
 * The data hooks are mocked; the catalog, the page model and the rail are the
 * real modules. The view portals to <body>, so queries go through document.
 * Expected copy comes from the exported COPY, never from the component.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  settings: null as any,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("tab=notifications"),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children) };
});
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t-1", slug: "northwind", company_name: "Northwind Rentals", currency_code: "USD" } }),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuth: () => ({ appUser: { id: "u-1", email: "admin@northwind.test", role: "admin" }, user: null }),
}));
vi.mock("@/hooks/use-notification-settings-v2", () => ({ useNotificationSettingsV2: () => h.settings }));
vi.mock("@/hooks/use-email-sender-v2", () => ({ EMAIL_SENDER_NAME_MAX: 100, useEmailSenderV2: () => ({ sender: null, isLoading: false, error: null }) }));
vi.mock("@/hooks/use-email-notification-prefs", () => ({ useEmailNotificationPrefs: () => ({ prefs: null, isLoading: false }) }));
vi.mock("@/hooks/use-email-branding-v2", () => ({
  useEmailBrandingV2: () => ({
    brand: { companyName: "Northwind Rentals", logoUrl: null, primaryColor: "#112233", accentColor: "#c5a572" },
    slug: "northwind",
    companyName: "Northwind Rentals",
    iconUrl: null,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-notification-test-v2", () => ({ useNotificationTestV2: () => ({ sendTest: vi.fn(), isSending: false }) }));
vi.mock("@/components/settings-v2/notifications-v2/push-setup-v2", async () => {
  const React = await import("react");
  const actual = await vi.importActual<any>("@/components/settings-v2/notifications-v2/push-setup-v2");
  return { ...actual, PushSetupV2: () => React.createElement("div", { "data-push-setup-stub": "" }) };
});
vi.mock("@/components/settings-v2/notifications-v2/email-sender-settings-v2", async () => {
  const React = await import("react");
  const actual = await vi.importActual<any>("@/components/settings-v2/notifications-v2/email-sender-settings-v2");
  return { ...actual, EmailSenderSettingsV2: () => React.createElement("div", { "data-sender-stub": "" }) };
});
vi.mock("@/components/settings-v2/notifications-v2/push-install-guide", async () => {
  const React = await import("react");
  return { PushInstallGuide: () => React.createElement("div", { "data-install-guide-stub": "" }) };
});
vi.mock("@/components/settings-v2/notifications-v2/trax-notification-chat", async () => {
  const React = await import("react");
  return { TraxNotificationChat: () => React.createElement("div", { "data-trax-stub": "" }) };
});
vi.mock("@/components/settings-v2/notification-states-v2", async () => {
  const React = await import("react");
  const actual = await vi.importActual<any>("@/components/settings-v2/notification-states-v2");
  return { ...actual, EmailNotificationSettingsV2: () => React.createElement("div", { "data-categories-stub": "" }) };
});
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return { default: () => (props: any) => React.createElement("textarea", { "data-editor-stub": "", value: props.value ?? "", readOnly: true }) };
});

import { NotificationsPageV2 } from "@/components/settings-v2/notifications-v2/notifications-page-v2";
import { NOTIFICATIONS_PAGE_COPY as COPY } from "@/components/settings-v2/notifications-v2/notifications-page-model";
import { useNotificationsSelection } from "@/components/settings-v2/notifications-v2/notifications-selection-store";

let container: HTMLDivElement;
let root: Root;

const page = () => {
  const el = document.body.querySelector<HTMLElement>("[data-notifications-page]");
  if (!el) throw new Error("the Notifications view is not on the page");
  return el;
};
const one = <T extends Element = HTMLElement>(selector: string) => {
  const el = page().querySelector<T>(selector);
  if (!el) throw new Error(`Nothing matches ${selector}`);
  return el;
};
const render = (node: React.ReactNode) => act(() => root.render(node));
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// The previews size themselves with `new ResizeObserver(...)`; the global setup's
// stand-in is a plain function, which cannot be constructed.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  h.settings = { rows: [], isLoading: false, isFetching: false, error: null, tableMissing: false, saveRows: vi.fn(), resetRows: vi.fn(), refetch: vi.fn() };
  useNotificationsSelection.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("a way back (N8.2)", () => {
  it("shows a Settings link at the top of the list, above the search box, pointing at /settings", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const back = one<HTMLAnchorElement>("[data-notifications-back]");
    expect(back.tagName).toBe("A");
    expect(back.getAttribute("href")).toBe("/settings");
    expect(back.textContent?.trim()).toBe("Settings");
    const search = one("input[type=search]");
    expect(before(back, search)).toBe(true);
    // The phone's own back arrow is still there (hidden by CSS on a desktop).
    expect(one('a[aria-label="Back to settings"]').getAttribute("href")).toBe("/settings");
  });
});

describe("the D18 notice (N8.11)", () => {
  it("says what is saved here is kept and used by Send test, and that live sending is unchanged — on a desktop and on a phone", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const desktop = one('[data-notifications-notice="sending-unchanged"]');
    const phone = one('[data-notifications-notice="sending-unchanged-phone"]');
    expect(desktop.textContent).toBe(COPY.notice);
    expect(phone.textContent).toBe(COPY.notice);
    expect(desktop.getAttribute("role")).toBe("note");
    expect(COPY.notice).toMatch(/Send test/);
    expect(COPY.notice).toMatch(/Live messages still go out as they do today/);
    expect(COPY.notice).toMatch(/until sending switches over/);
    // The desktop one sits at the foot of the list: after every row.
    const rows = Array.from(page().querySelectorAll("[data-rail-item]"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => before(row, desktop))).toBe(true);
  });

  it("is also there for a view-only user: it describes sending, not permission", () => {
    render(<NotificationsPageV2 canEdit={false} />);
    expect(one('[data-notifications-notice="sending-unchanged"]').textContent).toBe(COPY.notice);
    expect(one("[data-notifications-back]").getAttribute("href")).toBe("/settings");
  });

  it("is not repeated while storage is off, when the storage-off notice already says so", () => {
    h.settings = { ...h.settings, tableMissing: true };
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(page().querySelector('[data-notifications-notice="sending-unchanged"]')).toBeNull();
    expect(page().querySelector('[data-notifications-notice="sending-unchanged-phone"]')).toBeNull();
    const off = one('[data-notifications-notice="storage-off"]');
    expect(off.textContent).toContain(COPY.storageOff);
    expect(off.textContent).toContain(COPY.storageOffDetail);
  });
});
