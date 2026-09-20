/**
 * v2 Settings › Subscription (the billing page the v2 Subscription tab opens)
 * and the Customer messages entry points: the read-error, checkout-return,
 * empty and view-only states.
 *
 * Every expected value is worked out by hand from the rule it pins, never
 * produced by the code under test. Supabase is never touched: the billing
 * hooks are mocked, and the settings page is pinned at source level (it is
 * 6,800 lines of hooks; rendering it would test the mocks, not the page).
 *
 * HARNESS: `react-dom/client` + `act`, same as settings-messages-v2.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => ({
  v2: { on: true },
  perms: { edit: true },
  search: { value: "" },
  router: { push: () => undefined, replace: () => undefined },
  sub: {} as any,
  plans: {} as any,
  tenant: { value: { id: "t1", slug: "northwind", company_name: "Northwind Rentals" } as any },
  toast: Object.assign(
    (..._args: unknown[]) => undefined,
    { success: (..._args: unknown[]) => undefined, error: (..._args: unknown[]) => undefined },
  ) as any,
}));

vi.mock("@/lib/v2-context", () => ({
  useV2: () => h.v2.on,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
// Next returns the same URLSearchParams object while the URL is unchanged, so
// the mock does too (a fresh object per render would re-run the v1 poll effect).
const paramsCache = new Map<string, URLSearchParams>();
vi.mock("next/navigation", () => ({
  useRouter: () => h.router,
  useSearchParams: () => {
    if (!paramsCache.has(h.search.value)) paramsCache.set(h.search.value, new URLSearchParams(h.search.value));
    return paramsCache.get(h.search.value);
  },
  usePathname: () => "/subscription",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Delegates, so each test's fresh spies (assigned in beforeEach) are the ones called.
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => h.toast(...args), {
    success: (...args: unknown[]) => h.toast.success(...args),
    error: (...args: unknown[]) => h.toast.error(...args),
  }),
}));
vi.mock("@/hooks/use-tenant-subscription", () => ({ useTenantSubscription: () => h.sub }));
vi.mock("@/hooks/use-subscription-plans", () => ({ useSubscriptionPlans: () => h.plans }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant.value }) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => h.perms.edit, canViewSettings: () => true }),
}));
// The lean gate is read as a HOOK now (the answer is the slug list OR
// tenants.portal_experience, resolved on the server), so the double moves to
// the hook module and keeps the same predicate over this harness's tenant.
vi.mock("@/lib/lean-context", () => ({ useIsLean: () => h.tenant.value?.slug === "northwind" }));
vi.mock("@/components/subscription/pricing-card", () => ({
  PricingCard: ({ plan, onSubscribe }: any) => (
    <div data-testid="pricing-card">
      {plan.name}
      <button type="button" onClick={() => onSubscribe(plan.id, { termsAccepted: true })}>
        Subscribe
      </button>
    </div>
  ),
}));
vi.mock("@/components/billing/credits-panel", () => ({
  CreditsPanel: ({ hideReadOnlyNotice, suppressCheckoutToast }: any) => (
    <div
      data-testid="credits"
      data-hide-read-only-notice={String(!!hideReadOnlyNotice)}
      data-suppress-checkout-toast={String(!!suppressCheckoutToast)}
    />
  ),
}));
vi.mock("@/components/subscription/cancel-subscription-card", () => ({
  CancelSubscriptionCard: () => <button type="button">Contact support</button>,
}));
vi.mock("@/components/settings/usage-dashboard", () => ({
  UsageDashboard: () => <div data-testid="usage-dashboard" />,
  UsageSummary: () => <div data-testid="usage-summary" />,
}));
vi.mock("@/components/settings/subscription-settings", () => ({ LocalInvoiceView: () => null }));
vi.mock("@/components/subscription/card-brand-icon", () => ({ CardBrandIcon: () => null, CardOnFile: () => null }));
vi.mock("@/components/subscription/payment-methods", () => ({
  PaymentMethods: ({ onManage }: any) => (
    <button type="button" onClick={onManage}>
      Manage payment methods
    </button>
  ),
}));
vi.mock("@/components/subscription/payment-methods-dialog", () => ({ PaymentMethodsDialog: () => null }));
vi.mock("@/components/billing/billing-preview", () => ({
  useIsBillingPreviewTenant: () => false,
  useBillingPreview: () => false,
  usePreviewInvoices: () => [],
  usePreviewSubscription: () => null,
  PreviewDataPill: () => null,
  PreviewDataNotice: () => null,
  PreviewDisabledNote: () => null,
}));

import SubscriptionPage from "@/app/(dashboard)/subscription/page";
import {
  CHECKOUT_NOTE_MAX_AGE_MS,
  guessCheckoutKind,
  noteCheckoutStarted,
  readCheckoutNote,
} from "@/components/settings-v2/billing-states-v2";
import { Button } from "@/components/ui/button";

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

function buttonByText(name: string): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll("button"));
  const hit = all.find((b) => b.textContent?.trim() === name);
  if (!hit) throw new Error(`No button "${name}" in: ${all.map((b) => b.textContent?.trim()).join(" | ")}`);
  return hit;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function resetSub(overrides: Record<string, unknown> = {}) {
  h.sub = {
    subscription: null,
    isSubscribed: false,
    isGraceExpired: false,
    owesOutstandingInvoice: false,
    outstandingInvoiceUrl: null,
    isLoading: false,
    invoices: [],
    invoicesLoading: false,
    subscriptionError: null,
    invoicesError: null,
    createCheckoutSession: { mutateAsync: vi.fn(), isPending: false },
    createPortalSession: { mutateAsync: vi.fn(), isPending: false },
    refetch: vi.fn(),
    ...overrides,
  };
}

function resetPlans(overrides: Record<string, unknown> = {}) {
  h.plans = { data: [], isLoading: false, error: null, refetch: vi.fn(), isFetching: false, ...overrides };
}

const ACTIVE_SUBSCRIPTION = {
  id: "s1",
  status: "active",
  plan_name: "Growth",
  amount: 9900,
  currency: "usd",
  interval: "month",
  current_period_start: "2026-09-01T00:00:00Z",
  current_period_end: "2026-10-01T00:00:00Z",
  cancel_at: null,
  canceled_at: null,
  card_last4: null,
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.v2.on = true;
  h.perms.edit = true;
  h.search.value = "";
  window.sessionStorage.clear();
  h.tenant.value = { id: "t1", slug: "northwind", company_name: "Northwind Rentals" };
  h.toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  resetSub();
  resetPlans();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Read errors                                                                 */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): a failed read is never 'not subscribed'", () => {
  it("subscription read failed: a retry card instead of the pricing cards", () => {
    resetSub({ subscriptionError: { message: "Failed to fetch" } });
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    render(<SubscriptionPage />);
    expect(text()).toContain("Couldn't load your billing details");
    expect(text()).not.toContain("Choose your plan");
    expect(container.querySelector('[data-testid="pricing-card"]')).toBeNull();
    click(buttonByText("Try again"));
    expect(h.sub.refetch).toHaveBeenCalledTimes(1);
  });

  it("v1 is unchanged: the same failure still falls through to the plans", () => {
    h.v2.on = false;
    resetSub({ subscriptionError: { message: "Failed to fetch" } });
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    render(<SubscriptionPage />);
    expect(text()).toContain("Choose your plan");
    expect(text()).not.toContain("Couldn't load your billing details");
  });

  it("plans read failed: a retry card, not 'no plans are available'", () => {
    resetPlans({ data: undefined, error: { message: "Failed to fetch" } });
    render(<SubscriptionPage />);
    expect(text()).toContain("Couldn't load your plans");
    expect(text()).not.toContain("No subscription plans are available yet");
    click(buttonByText("Try again"));
    expect(h.plans.refetch).toHaveBeenCalledTimes(1);
  });

  it("v2, no plans configured (a successful empty read) still says so", () => {
    render(<SubscriptionPage />);
    expect(text()).toContain("No subscription plans are available yet");
  });
});

/* -------------------------------------------------------------------------- */
/* Back from Stripe Checkout                                                   */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): back from Stripe Checkout", () => {
  it("confirming, then slow after the 15s poll, then 'active' once the row says so", () => {
    vi.useFakeTimers();
    h.search.value = "status=success";
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    render(<SubscriptionPage />);

    expect(text()).toContain("Confirming your subscription…");
    expect(container.querySelector('[data-testid="pricing-card"]')).toBeNull();
    expect(h.toast.success).not.toHaveBeenCalled(); // no "activated" before Stripe confirms

    act(() => {
      vi.advanceTimersByTime(15000);
    });
    // The v1 poll still runs for v2: every 2s until 15s, so at 2,4,6,8,10,12,14s = 7 refetches.
    expect(h.sub.refetch).toHaveBeenCalledTimes(7);
    expect(text()).toContain("Activation is taking longer than usual");
    expect(text()).toContain("Please don't start a second checkout.");
    expect(container.querySelector('[data-testid="pricing-card"]')).toBeNull();

    click(buttonByText("Check again"));
    expect(h.sub.refetch).toHaveBeenCalledTimes(8);

    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION, refetch: h.sub.refetch });
    render(<SubscriptionPage />);
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith("Your subscription is active");
    expect(text()).not.toContain("Activation is taking longer");
  });

  it("v1 is unchanged: the success toast fires straight away", () => {
    h.v2.on = false;
    h.search.value = "status=success";
    render(<SubscriptionPage />);
    expect(h.toast.success).toHaveBeenCalledWith("Subscription activated successfully!");
    expect(text()).not.toContain("Confirming your subscription");
  });

  it("canceled checkout: says no charge was made", () => {
    h.search.value = "status=canceled";
    render(<SubscriptionPage />);
    expect(h.toast).toHaveBeenCalledWith("Checkout canceled", { description: "No charge was made." });
    expect(text()).not.toContain("Confirming your subscription");
  });
});

/* -------------------------------------------------------------------------- */
/* Payment required                                                            */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): payment required", () => {
  const pastDue = { status: "past_due", plan_name: "Growth" };

  it("while invoices load: 'loading your invoice link', not 'could not load'", () => {
    resetSub({ subscription: pastDue, invoicesLoading: true });
    render(<SubscriptionPage />);
    expect(text()).toContain("Payment required");
    expect(text()).toContain("Loading your invoice link…");
    expect(text()).not.toContain("We could not load your invoice link");
  });

  it("invoice read failed: the support fallback plus a way to try again", () => {
    resetSub({ subscription: pastDue, invoicesError: { message: "Failed to fetch" } });
    render(<SubscriptionPage />);
    expect(text()).toContain("We could not load your invoice link");
    click(buttonByText("Try loading it again"));
    expect(h.sub.refetch).toHaveBeenCalledTimes(1);
  });

  it("v1 is unchanged: the fallback shows while invoices are still loading", () => {
    h.v2.on = false;
    resetSub({ subscription: pastDue, invoicesLoading: true });
    render(<SubscriptionPage />);
    expect(text()).toContain("We could not load your invoice link");
    expect(text()).not.toContain("Loading your invoice link");
  });
});

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): invoices and usage", () => {
  it("invoice read failed: a retry card, not 'No invoices yet'", () => {
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION, invoicesError: { message: "Failed to fetch" } });
    render(<SubscriptionPage />);
    expect(text()).toContain("Couldn't load your invoices");
    expect(text()).not.toContain("No invoices yet");
    click(buttonByText("Try again"));
    expect(h.sub.refetch).toHaveBeenCalledTimes(1);
  });

  it("no invoices yet: explains when they appear, and still shows metered usage", () => {
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(text()).toContain("No invoices yet");
    expect(text()).toContain("Your invoices and receipts appear here after your first billing date.");
    expect(container.querySelector('[data-testid="usage-summary"]')).not.toBeNull();
  });

  it("with invoices: the shared dashboard, no empty state", () => {
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION, invoices: [{ id: "i1" }] });
    render(<SubscriptionPage />);
    expect(container.querySelector('[data-testid="usage-dashboard"]')).not.toBeNull();
    expect(text()).not.toContain("No invoices yet");
  });

  it("v1 is unchanged: a bare 'No invoices yet' and no usage block", () => {
    h.v2.on = false;
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION, invoicesError: { message: "Failed to fetch" } });
    render(<SubscriptionPage />);
    expect(text()).toContain("No invoices yet");
    expect(text()).not.toContain("Couldn't load your invoices");
    expect(container.querySelector('[data-testid="usage-summary"]')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Settings › Customer messages: entry points for view-only users              */
/* -------------------------------------------------------------------------- */

describe("settings page (v2): Customer messages entry points", () => {
  const source = readFileSync(resolve(__dirname, "../../app/(dashboard)/settings/page.tsx"), "utf8");
  const start = source.indexOf("        case 'templates': {");
  const end = source.indexOf("        case 'insurance':", start);
  const templatesCase = source.slice(start, end);

  it("the v2 templates page opens both editors through links, not buttons", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(templatesCase).toContain('href="/settings/email-templates"');
    expect(templatesCase).toContain('href="/settings/agreement-templates"');
    expect(templatesCase).not.toContain("<Button variant=\"outline\" size=\"sm\" className=\"pointer-events-auto\"");
    // The template links follow the Customer messages permission, not the page's
    // (the page is also editable for someone who may only edit the lockbox message).
    expect(templatesCase).toContain("const canEditTemplates = canEditSettings('templates');");
    expect(templatesCase).toContain("{canEditTemplates ? 'Edit emails' : 'View emails'}");
  });

  it("Team emails and Push stay out of the page's read-only fieldset; their switches gate themselves", () => {
    expect(source).toContain("readOnly={!canEditPage && !V2_PAGES_GATING_OWN_CONTROLS.has(v2Page as string)}");
    // General (each of its stacked sections wraps its controls in its own
    // fieldset), the pages that came out of it (Sep 19 2026) and Locations also
    // gate their own controls (their Try again and list search stay usable).
    // Weekend and holiday pricing gates per section too, and Notifications
    // disables its own switches, fields and Send test. Asserted as a SET: the
    // order these are written in is not behaviour.
    const gating = source.match(/const V2_PAGES_GATING_OWN_CONTROLS = new Set\(\[([^\]]*)\]\);/)?.[1] ?? "";
    expect(new Set([...gating.matchAll(/'([^']+)'/g)].map((m) => m[1]))).toEqual(
      new Set([
        "reminders",
        "push",
        "general",
        "duration",
        "lockbox",
        "tax-and-deposit",
        "booking-site",
        "modules",
        "locations",
        "templates",
        "pricing",
        "installments",
        "payg",
        "auto-extend",
        "promos",
        "extras",
        "notifications",
      ]),
    );
    const reminders = source.slice(source.indexOf("        case 'reminders':"), source.indexOf("        case 'push':"));
    expect(reminders).toContain("<EmailNotificationSettings canEdit={canEditSettings('reminders')} />");
    // The in-app payment reminder switches are shared with Notifications'
    // "What's sent today" (both follow settings.reminders), and gate themselves.
    expect(reminders).toContain("{renderV2ReminderExtras()}");
    const extras = source.slice(source.indexOf("const renderV2ReminderExtras = () =>"), source.indexOf("const renderV2NotificationsToday = () =>"));
    expect(extras).toContain("disabled={isUpdating || !canEditPage}");
    expect(extras).toContain("<ReminderRulesConfig />");
    const notifications = source.slice(source.indexOf("        case 'notifications':"), source.indexOf("        default:", source.indexOf("        case 'notifications':")));
    expect(notifications).toContain("todaySettings={renderV2NotificationsToday()}");
    const push = source.slice(source.indexOf("        case 'push':"), source.indexOf("        case 'templates': {"));
    expect(push).toContain("<PushNotificationSettings canEdit={canEditSettings('push')} />");
  });

  it("why: a disabled fieldset disables a button but never a link", () => {
    const opened = vi.fn();
    render(
      <fieldset disabled>
        <Button asChild variant="outline" size="sm">
          <a
            href="/settings/email-templates"
            onClick={(e) => {
              e.preventDefault();
              opened();
            }}
          >
            View emails
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={opened}>
          Old button
        </Button>
      </fieldset>,
    );
    const link = container.querySelector('a[href="/settings/email-templates"]') as HTMLAnchorElement;
    const button = buttonByText("Old button");
    expect(link.matches(":disabled")).toBe(false);
    expect(button.matches(":disabled")).toBe(true);
    // A user's click. (jsdom's element.click() refuses ANY element inside a
    // disabled fieldset; browsers only refuse form controls, per the spec.)
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* View only                                                                   */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): view only", () => {
  const NOTICE = "View only — ask an admin to make billing changes";

  it("subscribed: one notice, money controls disabled, Refresh and receipts still usable", () => {
    h.perms.edit = false;
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION, invoices: [{ id: "i1" }] });
    render(<SubscriptionPage />);
    expect(container.querySelectorAll('[data-settings-state="read-only"]')).toHaveLength(1);
    expect(text()).toContain(NOTICE);
    expect(buttonByText("Manage payment methods").matches(":disabled")).toBe(true);
    expect(buttonByText("Contact support").matches(":disabled")).toBe(true);
    expect(buttonByText("Refresh").matches(":disabled")).toBe(false);
    expect(container.querySelector('[data-testid="usage-dashboard"]')).not.toBeNull();
    // The page shows the notice, so the Credits section is told not to repeat it.
    const credits = container.querySelector('[data-testid="credits"]') as HTMLElement;
    expect(credits.dataset.hideReadOnlyNotice).toBe("true");
  });

  it("not subscribed: the plans are shown, but Subscribe is disabled", () => {
    h.perms.edit = false;
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    render(<SubscriptionPage />);
    expect(text()).toContain("Choose your plan");
    expect(text()).toContain(NOTICE);
    expect(buttonByText("Subscribe").matches(":disabled")).toBe(true);
  });

  it("payment required: the invoice link stays, Update payment method is disabled", () => {
    h.perms.edit = false;
    resetSub({ subscription: { status: "past_due", plan_name: "Growth" }, outstandingInvoiceUrl: "https://pay.example/inv" });
    render(<SubscriptionPage />);
    expect(text()).toContain(NOTICE);
    expect(buttonByText("Update payment method").disabled).toBe(true);
    expect(container.querySelector('a[href="https://pay.example/inv"]')).not.toBeNull();
  });

  it("an editor sees no notice and every control enabled", () => {
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(container.querySelector('[data-settings-state="read-only"]')).toBeNull();
    expect(buttonByText("Manage payment methods").matches(":disabled")).toBe(false);
    expect(buttonByText("Contact support").matches(":disabled")).toBe(false);
  });

  it("v1 is unchanged: a viewer gets no notice and no disabled controls", () => {
    h.v2.on = false;
    h.perms.edit = false;
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(container.querySelector('[data-settings-state="read-only"]')).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
    expect(buttonByText("Manage payment methods").matches(":disabled")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan details layout                                                         */
/* -------------------------------------------------------------------------- */

describe("billing page (v2): plan details", () => {
  const nextPaymentRow = () =>
    Array.from(container.querySelectorAll(".divide-y > div")).find((row) => row.textContent?.includes("Next Payment"));

  it("the cancel card sits below the list, not inside the Next Payment row", () => {
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(nextPaymentRow()?.textContent).not.toContain("Contact support");
    expect(text()).toContain("Contact support");
  });

  it("v1 is unchanged: the card is still where it was", () => {
    h.v2.on = false;
    resetSub({ isSubscribed: true, subscription: ACTIVE_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(nextPaymentRow()?.textContent).toContain("Contact support");
  });
});

/* -------------------------------------------------------------------------- */
/* Which checkout came back                                                    */
/* -------------------------------------------------------------------------- */

describe("billing-states-v2: telling the two checkouts apart", () => {
  // 2026-09-17 12:00:00 UTC
  const arrivedAt = Date.UTC(2026, 8, 17, 12, 0, 0);
  const minutesBefore = (m: number) => new Date(arrivedAt - m * 60_000).toISOString();

  it("seen unsubscribed on this visit: a subscription checkout, whatever the row's age", () => {
    expect(guessCheckoutKind({ sawUnsubscribed: true, subscriptionCreatedAt: minutesBefore(60 * 24 * 200), arrivedAt })).toBe("subscription");
    expect(guessCheckoutKind({ sawUnsubscribed: true, subscriptionCreatedAt: null, arrivedAt })).toBe("subscription");
  });

  it("already subscribed: a row up to 30 minutes old is the subscription just bought", () => {
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: minutesBefore(10), arrivedAt })).toBe("subscription");
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: minutesBefore(30), arrivedAt })).toBe("subscription");
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: minutesBefore(31), arrivedAt })).toBe("credits");
    // Database clock up to 5 minutes ahead of the browser still counts.
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: minutesBefore(-4), arrivedAt })).toBe("subscription");
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: minutesBefore(-6), arrivedAt })).toBe("credits");
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: null, arrivedAt })).toBe("credits");
    expect(guessCheckoutKind({ sawUnsubscribed: false, subscriptionCreatedAt: "not a date", arrivedAt })).toBe("credits");
  });

  it("a note counts only for the page it names, within the hour", () => {
    const now = arrivedAt;
    noteCheckoutStarted("credits", "/subscription", now - 59 * 60_000);
    expect(readCheckoutNote("/subscription", now)).toBe("credits");
    expect(readCheckoutNote("/credits", now)).toBeNull();
    // Reading does not use it up.
    expect(readCheckoutNote("/subscription", now)).toBe("credits");

    noteCheckoutStarted("subscription", "/subscription", now - CHECKOUT_NOTE_MAX_AGE_MS - 1);
    expect(readCheckoutNote("/subscription", now)).toBeNull();

    noteCheckoutStarted("subscription", "/subscription", now + 1000);
    expect(readCheckoutNote("/subscription", now)).toBeNull();

    window.sessionStorage.setItem("drive247:v2-checkout-started", "{not json");
    expect(readCheckoutNote("/subscription", now)).toBeNull();
    window.sessionStorage.setItem("drive247:v2-checkout-started", JSON.stringify({ kind: "refund", path: "/subscription", at: now }));
    expect(readCheckoutNote("/subscription", now)).toBeNull();
  });
});

describe("billing page (v2): back from a checkout that was not a subscription", () => {
  const OLD_SUBSCRIPTION = { ...ACTIVE_SUBSCRIPTION, created_at: "2026-01-05T09:00:00Z" };
  const credits = () => container.querySelector('[data-testid="credits"]') as HTMLElement;

  it("credits top-up, no note: no 'subscription is active', and Credits announces it", () => {
    h.search.value = "status=success";
    resetSub({ isSubscribed: true, subscription: OLD_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(h.toast.success).not.toHaveBeenCalledWith("Your subscription is active");
    expect(credits().dataset.suppressCheckoutToast).toBe("false");
  });

  it("credits note wins even over a brand-new subscription row", () => {
    noteCheckoutStarted("credits", "/subscription");
    h.search.value = "status=success";
    resetSub({ isSubscribed: true, subscription: { ...ACTIVE_SUBSCRIPTION, created_at: new Date().toISOString() } });
    render(<SubscriptionPage />);
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(credits().dataset.suppressCheckoutToast).toBe("false");
    expect(text()).not.toContain("Confirming your subscription");
    // Used up on arrival.
    expect(window.sessionStorage.getItem("drive247:v2-checkout-started")).toBeNull();
  });

  it("subscription note, webhook already landed: 'active' once, and Credits stays quiet", () => {
    noteCheckoutStarted("subscription", "/subscription");
    h.search.value = "status=success";
    resetSub({ isSubscribed: true, subscription: OLD_SUBSCRIPTION });
    render(<SubscriptionPage />);
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith("Your subscription is active");
    expect(credits().dataset.suppressCheckoutToast).toBe("true");
  });

  it("no note, a subscription created a minute ago: treated as the subscription return", () => {
    h.search.value = "status=success";
    resetSub({ isSubscribed: true, subscription: { ...ACTIVE_SUBSCRIPTION, created_at: new Date(Date.now() - 60_000).toISOString() } });
    render(<SubscriptionPage />);
    expect(h.toast.success).toHaveBeenCalledWith("Your subscription is active");
    expect(credits().dataset.suppressCheckoutToast).toBe("true");
  });

  it("Subscribe notes the checkout before leaving for Stripe (v2 only)", async () => {
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    resetSub({ createCheckoutSession: { mutateAsync: vi.fn().mockResolvedValue({ url: "#stripe-checkout" }), isPending: false } });
    render(<SubscriptionPage />);
    await act(async () => {
      buttonByText("Subscribe").click();
    });
    expect(h.sub.createCheckoutSession.mutateAsync).toHaveBeenCalledTimes(1);
    expect(readCheckoutNote("/subscription")).toBe("subscription");
  });

  it("v1 is unchanged: Subscribe writes no note", async () => {
    h.v2.on = false;
    resetPlans({ data: [{ id: "p1", name: "Growth" }] });
    resetSub({ createCheckoutSession: { mutateAsync: vi.fn().mockResolvedValue({ url: "#stripe-checkout" }), isPending: false } });
    render(<SubscriptionPage />);
    await act(async () => {
      buttonByText("Subscribe").click();
    });
    expect(window.sessionStorage.getItem("drive247:v2-checkout-started")).toBeNull();
  });
});
