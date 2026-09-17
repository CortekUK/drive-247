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

vi.mock("@/lib/v2-context", () => ({ useV2: () => h.v2.on }));
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
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/lib/lean-areas", () => ({ isLeanTenant: (slug?: string | null) => slug === "northwind" }));
vi.mock("@/components/subscription/pricing-card", () => ({
  PricingCard: ({ plan }: any) => <div data-testid="pricing-card">{plan.name}</div>,
}));
vi.mock("@/components/billing/credits-panel", () => ({ CreditsPanel: () => <div data-testid="credits" /> }));
vi.mock("@/components/subscription/cancel-subscription-card", () => ({ CancelSubscriptionCard: () => null }));
vi.mock("@/components/settings/usage-dashboard", () => ({
  UsageDashboard: () => <div data-testid="usage-dashboard" />,
  UsageSummary: () => <div data-testid="usage-summary" />,
}));
vi.mock("@/components/settings/subscription-settings", () => ({ LocalInvoiceView: () => null }));
vi.mock("@/components/subscription/card-brand-icon", () => ({ CardBrandIcon: () => null, CardOnFile: () => null }));
vi.mock("@/components/subscription/payment-methods", () => ({ PaymentMethods: () => null }));
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
  h.search.value = "";
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
    expect(templatesCase).toContain("{canEditPage ? 'Edit emails' : 'View emails'}");
  });

  it("Team emails and Push stay out of the page's read-only fieldset; their switches gate themselves", () => {
    expect(source).toContain("readOnly={!canEditPage && !V2_PAGES_GATING_OWN_CONTROLS.has(v2Page as string)}");
    // General, Locations and Booking site also gate their own controls (their Try again and list search stay usable),
    // and so do the Business-rules pages (each wraps its controls in its own fieldset).
    // Pricing rules, Tax and fees and Security deposit gate per section too (their Try again on a failed read stays usable).
    expect(source).toContain(
      "const V2_PAGES_GATING_OWN_CONTROLS = new Set(['reminders', 'push', 'general', 'locations', 'booking-site', 'requirements', 'duration', 'lockbox', 'templates', 'pricing', 'fees', 'preauth', 'installments', 'payg', 'auto-extend', 'promos', 'extras']);",
    );
    const reminders = source.slice(source.indexOf("        case 'reminders':"), source.indexOf("        case 'push':"));
    expect(reminders).toContain("disabled={isUpdating || !canEditPage}");
    expect(reminders).toContain("<EmailNotificationSettings canEdit={canEditSettings('reminders')} />");
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
