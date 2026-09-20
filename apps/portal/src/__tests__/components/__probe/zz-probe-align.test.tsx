/** PROBE — temporary. Row alignment across v2 settings panels. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => true,
  usePortalExperience: () => ({ onV2: true, lean: false }),
  usePortalOnV2: () => true,
}));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", slug: "northwind", currency_code: "USD" }, refetchTenant: vi.fn() }),
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
vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings" }));

import { AutoExtendSettingsV2, PayAsYouGoSettingsV2 } from "@/components/settings-v2/payment-modes-v2";
import { DepositSettingsV2, FeesSettingsV2 } from "@/components/settings-v2/fees-deposit-v2";
import {
  DurationPageV2,
  LockboxPageV2,
  RequirementsPageV2,
  ReturnReminderPanelV2,
} from "@/components/settings-v2/business-rules-pages";
import { SettingsPanel, SettingsRow, SettingsRowAlignProvider } from "@/components/settings-v2/settings-kit";
import { Switch } from "@/components/ui/switch";

let container: HTMLDivElement;
let root: Root;

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

const START = "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]";
const END = "md:grid-cols-[minmax(0,1fr)_auto]";

function rows(label: string) {
  const grids = Array.from(container.querySelectorAll<HTMLElement>("div.px-5.py-4 > div")).filter((g) =>
    g.className.includes("md:grid-cols-"),
  );
  const out = grids.map((g) => {
    const mode = g.className.includes(END) ? "END" : g.className.includes(START) ? "START" : "?";
    return `${mode} :: ${(g.firstElementChild?.textContent ?? "").slice(0, 45)}`;
  });
  // eslint-disable-next-line no-console
  console.log(`\n### ${label} (${out.length} rows)\n` + out.join("\n"));
  return out;
}

function rentalApi(settings: Record<string, unknown> = {}) {
  return {
    settings: {
      pay_as_you_go_enabled: true,
      payg_upfront_required: false,
      payg_auto_reminders_enabled: true,
      auto_extend_enabled: true,
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
  };
}

const form = {
  min_rental_days: 1,
  min_rental_hours: 4,
  max_rental_days: 30,
  advance_booking_days: 90,
  buffer_hours: 2,
  require_license_verification: true,
  require_insurance_verification: false,
  minimum_age: 21,
  lockbox_enabled: true,
  lockbox_code_length: 4,
  lockbox_notification_methods: ["email"],
  return_reminder_enabled: true,
  return_reminder_hours_before: 24,
  return_reminder_channels: ["email"],
  tax_rate: 8,
  tax_enabled: true,
  security_deposit_enabled: true,
  security_deposit_amount: 250,
};

describe("PROBE align", () => {
  it("payment modes", () => {
    rs.current = rentalApi();
    act(() => root.render(<PayAsYouGoSettingsV2 canEdit registerSave={() => () => {}} />));
    expect(rows("payg")).not.toContain("START");
    act(() => root.render(<AutoExtendSettingsV2 canEdit registerSave={() => () => {}} />));
    rows("auto-extend");
  });

  it("business rules panels", () => {
    rs.current = rentalApi();
    const saved: any = { ...form };
    const noop = () => {};
    act(() =>
      root.render(
        <>
          <RequirementsPageV2 form={form as any} setForm={noop as any} saved={saved} canEdit onSave={async () => {}} registerSave={() => () => {}} idWaiver={{ enabled: false, canChange: true, saving: false, onToggle: noop }} />
        </>,
      ),
    );
    rows("requirements");
    act(() => root.render(<DurationPageV2 form={form as any} setForm={noop as any} saved={saved} canEdit onSave={async () => {}} registerSave={() => () => {}} />));
    rows("duration");
    act(() => root.render(<LockboxPageV2 form={form as any} setForm={noop as any} saved={saved} canEdit onSave={async () => {}} registerSave={() => () => {}} vehiclesHref="/vehicles" templatesHref="/settings?tab=templates" />));
    rows("lockbox");
    act(() =>
      root.render(
        <ReturnReminderPanelV2
          form={form as any}
          setForm={noop as any}
          saved={saved}
          canEdit
          onSave={async () => {}}
          registerSave={() => () => {}}
          smsReady
          emailTemplateHref="/x"
          integrationsHref="/y"
        />,
      ),
    );
    rows("return-reminder");
  });

  it("fees and deposit", () => {
    rs.current = rentalApi();
    const noop = () => {};
    act(() =>
      root.render(
        <FeesSettingsV2
          form={form as any}
          setForm={noop as any}
          saved={form as any}
          read={{ hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() } as any}
          canEdit
          currencyCode="USD"
          onSave={async () => {}}
          registerSave={() => () => {}}
        />,
      ),
    );
    rows("fees");
    act(() =>
      root.render(
        <DepositSettingsV2
          form={form as any}
          setForm={noop as any}
          saved={form as any}
          read={{ hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() } as any}
          holds={{ hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() } as any}
          liveHoldCount={0}
          canEdit
          currencyCode="USD"
          paymentProvider="stripe"
          connectHref="/x"
          onRequestCharge={() => {}}
          onSave={async () => {}}
          registerSave={() => () => {}}
        />,
      ),
    );
    rows("deposit");
  });

  it("the page's own 'What's sent today' reminder rows, as the notifications/reminders pages mount them", () => {
    // Replicates app/(dashboard)/settings/page.tsx renderV2ReminderExtras():
    // four SettingsRows in a SettingsPanel, inside the page's provider for a
    // page NOT in V2_PAGES_CONTROLS_AT_END.
    act(() =>
      root.render(
        <SettingsRowAlignProvider align="start">
          <SettingsPanel title="In-app payment reminders" description="Shown in your reminders list.">
            {["Payment due in 2 days", "Payment due today", "Payment 1 day overdue", "Payment several days overdue"].map((l) => (
              <SettingsRow key={l} label={l}>
                <Switch checked aria-label={l} />
              </SettingsRow>
            ))}
          </SettingsPanel>
        </SettingsRowAlignProvider>,
      ),
    );
    rows("whats-sent-today (page.tsx renderV2ReminderExtras)");
  });
});
