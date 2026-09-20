/** PROBE — temporary. Notifications v2 page surfaces, headings, alignment. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  tenant: null as any,
  appUser: null as any,
  settings: null as any,
  sender: null as any,
  prefs: null as any,
  sendTest: null as any,
}));

vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant }) }));
vi.mock("@/stores/auth-store", () => ({ useAuth: () => ({ appUser: h.appUser, user: null }) }));
vi.mock("@/hooks/use-notification-settings-v2", () => ({ useNotificationSettingsV2: () => h.settings }));
vi.mock("@/hooks/use-email-sender-v2", () => ({ EMAIL_SENDER_NAME_MAX: 100, useEmailSenderV2: () => h.sender }));
vi.mock("@/hooks/use-email-notification-prefs", async () => {
  const actual = await vi.importActual<any>("@/hooks/use-email-notification-prefs");
  return { ...actual, useEmailNotificationPrefs: () => h.prefs };
});
vi.mock("@/components/settings-v2/notifications-v2/push-setup-v2", async () => {
  const React = await import("react");
  const actual = await vi.importActual<any>("@/components/settings-v2/notifications-v2/push-setup-v2");
  return { ...actual, PushSetupV2: () => React.createElement("div", { "data-push-setup-stub": "" }, "Push on this device") };
});
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-email-branding-v2", () => ({
  useEmailBrandingV2: () => ({
    brand: { companyName: "Northwind Rentals", logoUrl: null, primaryColor: "#112233", accentColor: "#c5a572" },
    slug: "northwind",
    companyName: "Northwind Rentals",
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-notification-test-v2", () => ({
  useNotificationTestV2: () => ({ sendTest: h.sendTest, isSending: false }),
}));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  const EditorStub = (props: any) =>
    React.createElement("textarea", {
      "data-editor-stub": "",
      "aria-label": props.ariaLabel,
      value: props.value,
      readOnly: !!props.readOnly,
      onChange: (e: any) => props.onChange(e.target.value),
    });
  return { default: () => EditorStub };
});

import { NotificationsPageV2 } from "@/components/settings-v2/notifications-v2/notifications-page-v2";
import { EmailNotificationSettingsV2 } from "@/components/settings-v2/notification-states-v2";
import { SettingsPanel, SettingsRow, SettingsRowAlignProvider } from "@/components/settings-v2/settings-kit";
import { Switch } from "@/components/ui/switch";

let container: HTMLDivElement;
let root: Root;

const START = "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]";
const END = "md:grid-cols-[minmax(0,1fr)_auto]";

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.tenant = { id: "t1", slug: "northwind", company_name: "Northwind Rentals", currency_code: "USD", push_notifications_enabled: true };
  h.appUser = { id: "u1", role: "head_admin", email: "jo@northwind.test" };
  h.sender = { sender: { from_name: null, from_local_part: null, reply_to: null }, isLoading: false, error: null, tableMissing: false };
  h.prefs = {
    prefs: { masterEnabled: true, recipientEmail: "alerts@northwind.test", contactEmail: "office@northwind.test", categories: {} },
    isLoading: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    setMasterEnabled: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), variables: undefined },
    setRecipientEmail: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), variables: undefined },
    setCategoryEnabled: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), variables: undefined },
  };
  h.sendTest = vi.fn(async () => ({ success: true, sent: 1, message: "Sent." }));
  h.settings = {
    rows: [],
    isLoading: false,
    isFetching: false,
    error: null,
    tableMissing: false,
    refetch: vi.fn(),
    saveRows: vi.fn(async () => undefined),
    resetRows: vi.fn(async () => undefined),
    isSaving: false,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PROBE notifications", () => {
  it("full page: headings, surfaces, rows", () => {
    act(() =>
      root.render(
        <SettingsRowAlignProvider align="start">
          <NotificationsPageV2
            canEdit
            registerSave={() => () => {}}
            todaySettings={
              <SettingsPanel title="In-app payment reminders" description="Shown in your reminders list.">
                {["Payment due in 2 days", "Payment due today"].map((l) => (
                  <SettingsRow key={l} label={l}>
                    <Switch checked aria-label={l} />
                  </SettingsRow>
                ))}
              </SettingsPanel>
                }
          />
        </SettingsRowAlignProvider>,
      ),
    );

    const heads = Array.from(container.querySelectorAll("h1,h2,h3,h4")).map(
      (e) => `${e.tagName} [${e.className}] ${(e.textContent ?? "").slice(0, 40)}`,
    );
    // eslint-disable-next-line no-console
    console.log("\n### HEADINGS\n" + heads.join("\n"));

    const rows = Array.from(container.querySelectorAll<HTMLElement>("div.px-5.py-4 > div"))
      .filter((g) => g.className.includes("md:grid-cols-"))
      .map((g) => `${g.className.includes(END) ? "END" : g.className.includes(START) ? "START" : "?"} :: ${(g.firstElementChild?.textContent ?? "").slice(0, 40)}`);
    // eslint-disable-next-line no-console
    console.log("\n### ROWS\n" + rows.join("\n"));

    // Surfaces: every card-ish container
    const surfaces = new Map<string, number>();
    container.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const c = el.className;
      if (typeof c === "string" && /\bbg-card\b|\bbg-muted\//.test(c) && /rounded-/.test(c)) {
        const key = c.split(/\s+/).filter((t) => /^rounded-|^border|^bg-|^shadow/.test(t)).join(" ");
        surfaces.set(key, (surfaces.get(key) ?? 0) + 1);
      }
    });
    // eslint-disable-next-line no-console
    console.log("\n### SURFACES\n" + Array.from(surfaces).map(([k, n]) => `${n}x  ${k}`).join("\n"));

    expect(heads.length).toBeGreaterThan(0);
  });

  it("team-alert category cards (notification-states-v2 parts=categories)", () => {
    act(() => root.render(<EmailNotificationSettingsV2 canEdit parts="categories" />));
    // eslint-disable-next-line no-console
    console.log("\n### CATEGORIES HTML HEADS\n" + Array.from(container.querySelectorAll("h1,h2,h3,h4")).map((e) => `${e.tagName} [${e.className}] ${e.textContent?.slice(0, 40)}`).join("\n"));
    const surfaces = new Set<string>();
    container.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const c = el.className;
      if (typeof c === "string" && /rounded-/.test(c)) surfaces.add(c.split(/\s+/).filter((t) => /^rounded-|^border|^bg-|^shadow/.test(t)).join(" "));
    });
    // eslint-disable-next-line no-console
    console.log("\n### CATEGORY SURFACES\n" + Array.from(surfaces).join("\n"));
    expect(container.textContent).toBeTruthy();
  });
});
