/**
 * v2 Settings › Notifications, Push notifications and Customer messages:
 * the empty / loading / error / read-only / extreme states.
 *
 * Every expected value below is worked out by hand from the rule it pins
 * (never produced by the code under test). Supabase is never touched: each
 * hook the components read is mocked.
 *
 * HARNESS: `react-dom/client` + `act`, same as settings-section-states.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => {
  const mut = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined as any });
  return {
    mut,
    perms: { edit: true },
    v2: { on: true },
    tenant: { value: { id: "t1", slug: "northwind", push_notifications_enabled: true } as any },
    router: { push: vi.fn(), replace: vi.fn() },
    search: { value: "" },
    toast: vi.fn(),
    emailPrefs: {} as any,
    rules: {} as any,
    ruleActions: {} as any,
    emailTemplates: {} as any,
    strictList: {} as any,
    strictOne: {} as any,
    selection: {} as any,
    rental: {} as any,
    push: {} as any,
    pushLog: {} as any,
  };
});

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => h.perms.edit, canViewSettings: () => true }),
}));
vi.mock("@/lib/v2-context", () => ({ useV2: () => h.v2.on }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant.value }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => h.router,
  useSearchParams: () => new URLSearchParams(h.search.value),
  useParams: () => ({}),
  usePathname: () => "/settings",
}));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast, useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/use-email-notification-prefs", () => ({
  EMAIL_NOTIFICATION_CATEGORIES: ["bookings", "payments", "insurance", "returns", "verification", "fines"],
  useEmailNotificationPrefs: () => h.emailPrefs,
}));
vi.mock("@/hooks/use-reminder-rules", () => ({
  useReminderRulesByCategory: () => h.rules,
  useReminderRuleActions: () => h.ruleActions,
}));
vi.mock("@/hooks/use-email-templates", () => ({ useEmailTemplates: () => h.emailTemplates }));
vi.mock("@/hooks/use-template-reads-v2", () => ({
  useEmailTemplatesStrict: () => h.strictList,
  useEmailTemplateStrict: () => h.strictOne,
}));
vi.mock("@/hooks/use-agreement-templates", () => ({
  DEFAULT_TEMPLATE_NAME: "Default Template",
  CUSTOM_TEMPLATE_NAME: "Custom Template",
  useTemplateSelection: () => h.selection,
}));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => h.rental }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => undefined }));
vi.mock("@/hooks/use-unsaved-changes-warning", () => ({
  useUnsavedChangesWarning: () => ({
    isDialogOpen: false,
    confirmLeave: vi.fn(),
    saveAndLeave: vi.fn(),
    cancelLeave: vi.fn(),
    isSaving: false,
  }),
}));
vi.mock("@/components/shared/unsaved-changes-dialog", () => ({ UnsavedChangesDialog: () => null }));
vi.mock("@/components/settings/tiptap-editor", () => ({
  TipTapEditor: ({ content, onChange }: any) => (
    <textarea data-testid="tiptap" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/lib/agreement-injection", () => ({ injectAgreementClauses: (c: string) => c }));
vi.mock("@/lib/bonzah-addendum", () => ({ BONZAH_INSURANCE_ADDENDUM_HTML: "" }));
vi.mock("@/lib/template-variables", () => ({
  getSampleData: () => ({}),
  replaceVariables: (c: string) => c,
}));
vi.mock("@/lib/default-agreement-template", () => ({
  getDefaultTemplateForCategory: () => "<p>Default terms</p>",
}));
vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => h.push,
  usePushLog: () => h.pushLog,
}));
vi.mock("@/hooks/use-pwa-install", () => ({
  usePwaInstall: () => ({ isInstalled: true, canPrompt: false, install: vi.fn() }),
}));

import {
  agreementPreviewSnippet,
  filterEmailTemplateTypes,
  htmlToPlainText,
  isBlankHtml,
  isValidEmail,
  isValidPushUrl,
  lockboxTemplateIssues,
  parseLeadDays,
  pushAudienceCount,
  pushSendBlockReason,
  recipientProblem,
  resolveAgreementCategory,
  resolveAgreementEditorParams,
  ruleSummary,
  smsSegments,
} from "@/components/settings-v2/message-rules";
import { EmailNotificationSettingsV2, ReminderRulesConfigV2 } from "@/components/settings-v2/notification-states-v2";
import { EmailTemplateEditorV2, EmailTemplatesListV2 } from "@/components/settings-v2/email-templates-v2";
import { AgreementTemplateEditorV2, AgreementTemplatesPageV2 } from "@/components/settings-v2/agreement-templates-v2";
import { PushNotificationSettings } from "@/components/settings/push-notification-settings";
import { EMAIL_TEMPLATE_TYPES } from "@/lib/email-template-variables";

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

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.perms.edit = true;
  h.v2.on = true;
  h.search.value = "";
  h.tenant.value = { id: "t1", slug: "northwind", push_notifications_enabled: true };
  h.toast.mockReset();
  h.router.push.mockReset();
  h.router.replace.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                  */
/* -------------------------------------------------------------------------- */

describe("message-rules: reminder timing", () => {
  it("accepts whole days 0–365 and names what is wrong otherwise", () => {
    expect(parseLeadDays("7")).toEqual({ ok: true, value: 7 });
    expect(parseLeadDays(" 0 ")).toEqual({ ok: true, value: 0 });
    expect(parseLeadDays("365")).toEqual({ ok: true, value: 365 });
    expect(parseLeadDays("366")).toEqual({ ok: false, message: "Keep it within a year (0–365 days)." });
    expect(parseLeadDays("9999")).toEqual({ ok: false, message: "Keep it within a year (0–365 days)." });
    expect(parseLeadDays("-5")).toEqual({ ok: false, message: "Days can't be negative." });
    expect(parseLeadDays("1.5")).toEqual({ ok: false, message: "Use whole days (0–365)." });
    expect(parseLeadDays("1e3")).toEqual({ ok: false, message: "Use whole days (0–365)." });
    expect(parseLeadDays("")).toEqual({ ok: false, message: "Enter a number of days (0–365)." });
  });

  it("summarises a rule, including a switched-off one", () => {
    expect(ruleSummary({ lead_days: 7, is_recurring: false, severity: "warning", is_enabled: false })).toBe(
      "Off · 7 days before due · Warning",
    );
    expect(ruleSummary({ lead_days: 1, is_recurring: false, severity: "critical", is_enabled: false })).toBe(
      "Off · 1 day before due · Critical",
    );
    expect(ruleSummary({ lead_days: 0, is_recurring: false, severity: "info", is_enabled: true })).toBe(
      "On · on the due date · Info",
    );
    expect(ruleSummary({ lead_days: 14, is_recurring: true, severity: "odd", is_enabled: false })).toBe(
      "Off · every 14 days · Odd",
    );
  });
});

describe("message-rules: email recipient", () => {
  it("validates addresses", () => {
    expect(isValidEmail("ops@fleet.io")).toBe(true);
    expect(isValidEmail(" Ops@Fleet.io ")).toBe(true);
    expect(isValidEmail("abc")).toBe(false);
    expect(isValidEmail("me@")).toBe(false);
    expect(isValidEmail("a@b.c")).toBe(false);
    expect(isValidEmail("a b@c.io")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });

  it("flags an invalid draft first, then alerts that can reach nobody", () => {
    expect(recipientProblem({ draft: "abc", contactEmail: "desk@fleet.io", masterEnabled: true })).toBe("invalid");
    expect(recipientProblem({ draft: "", contactEmail: "", masterEnabled: true })).toBe("no-address");
    expect(recipientProblem({ draft: "   ", contactEmail: null, masterEnabled: true })).toBe("no-address");
    expect(recipientProblem({ draft: "", contactEmail: "", masterEnabled: false })).toBeNull();
    expect(recipientProblem({ draft: "", contactEmail: "desk@fleet.io", masterEnabled: true })).toBeNull();
  });
});

describe("message-rules: push send form", () => {
  it("counts the audience a target reaches", () => {
    expect(pushAudienceCount("staff", 3, 0)).toBe(3);
    expect(pushAudienceCount("customers", 3, 0)).toBe(0);
    expect(pushAudienceCount("all", 3, 2)).toBe(5);
    expect(pushAudienceCount("self", 3, 2)).toBeNull();
  });

  it("allows portal paths and https links only", () => {
    expect(isValidPushUrl("")).toBe(true);
    expect(isValidPushUrl("/rentals?tab=1")).toBe(true);
    expect(isValidPushUrl("https://drive-247.com/x")).toBe(true);
    expect(isValidPushUrl("http://drive-247.com")).toBe(false);
    expect(isValidPushUrl("//evil.com")).toBe(false);
    expect(isValidPushUrl("rentals")).toBe(false);
    expect(isValidPushUrl("/a b")).toBe(false);
  });

  it("gives the first reason Send is blocked", () => {
    const base = {
      target: "self" as const,
      title: "Hi",
      url: "/",
      isSupported: true,
      isBlocked: false,
      staffCount: 0,
      customerCount: 0,
      devicesKnown: true,
    };
    expect(pushSendBlockReason(base)).toBeNull();
    expect(pushSendBlockReason({ ...base, title: "  " })).toBe("title");
    expect(pushSendBlockReason({ ...base, title: "  ", isBlocked: true })).toBe("title");
    expect(pushSendBlockReason({ ...base, url: "ftp://x.io" })).toBe("url");
    expect(pushSendBlockReason({ ...base, isBlocked: true })).toBe("browser");
    expect(pushSendBlockReason({ ...base, isSupported: false })).toBe("browser");
    expect(pushSendBlockReason({ ...base, target: "customers" })).toBe("empty-audience");
    // Counts not loaded: never claim the audience is empty.
    expect(pushSendBlockReason({ ...base, target: "customers", devicesKnown: false })).toBeNull();
    expect(pushSendBlockReason({ ...base, target: "all", staffCount: 1 })).toBeNull();
  });
});

describe("message-rules: lockbox and template text", () => {
  it("counts SMS parts (160 single, 153 per part after that)", () => {
    expect(smsSegments(0)).toBe(0);
    expect(smsSegments(-4)).toBe(0);
    expect(smsSegments(1)).toBe(1);
    expect(smsSegments(160)).toBe(1);
    expect(smsSegments(161)).toBe(2); // ceil(161 / 153) = 2
    expect(smsSegments(306)).toBe(2); // 306 / 153 = 2 exactly
    expect(smsSegments(307)).toBe(3);
  });

  it("finds blank fields and a message that would not carry the code", () => {
    expect(lockboxTemplateIssues({ channel: "email", subject: "", body: "Code {{lockbox_code}}" })).toEqual({
      subjectError: "Add a subject line.",
      bodyError: null,
      missingCode: false,
    });
    expect(lockboxTemplateIssues({ channel: "sms", body: "Your car is ready" })).toEqual({
      subjectError: null,
      bodyError: null,
      missingCode: true,
    });
    expect(lockboxTemplateIssues({ channel: "sms", body: "   " })).toEqual({
      subjectError: null,
      bodyError: "Add the message text.",
      missingCode: false,
    });
    // The send path replaces only the exact token, so a spaced one does not count.
    expect(lockboxTemplateIssues({ channel: "sms", body: "Code {{ lockbox_code }}" }).missingCode).toBe(true);
  });

  it("reads template HTML as text", () => {
    expect(isBlankHtml("<p></p>")).toBe(true);
    expect(isBlankHtml("<p>&nbsp;</p>")).toBe(true);
    expect(isBlankHtml('<p><img src="x.png"></p>')).toBe(false);
    expect(htmlToPlainText("<h2>Terms</h2><p>Drive &amp; return</p>")).toBe("Terms Drive & return");
  });

  it("previews an agreement without a stray ellipsis", () => {
    expect(agreementPreviewSnippet("<p>Short terms.</p>")).toBe("Short terms.");
    expect(agreementPreviewSnippet(null)).toBeNull();
    expect(agreementPreviewSnippet("<p></p>")).toBeNull();
    const long = agreementPreviewSnippet(`<p>${"a".repeat(250)}</p>`);
    expect(long).toBe(`${"a".repeat(200)}…`);
    expect(long).toHaveLength(201);
  });

  it("resolves agreement deep links", () => {
    expect(resolveAgreementCategory(null, false)).toEqual({ category: "standard", notice: null });
    expect(resolveAgreementCategory("payg", false)).toEqual({ category: "standard", notice: "payg-off" });
    expect(resolveAgreementCategory("payg", true)).toEqual({ category: "payg", notice: null });
    expect(resolveAgreementCategory("installment", false)).toEqual({ category: "installment", notice: null });
    expect(resolveAgreementCategory("foo", true)).toEqual({ category: "standard", notice: "unknown" });

    expect(resolveAgreementEditorParams(null, null)).toEqual({ type: "default", category: "standard" });
    expect(resolveAgreementEditorParams("custom", "installment")).toEqual({ type: "custom", category: "installment" });
    expect(resolveAgreementEditorParams("foo", "standard")).toBeNull();
    expect(resolveAgreementEditorParams("default", "weekly")).toBeNull();
  });

  it("searches email templates by name, description or key", () => {
    const types = [
      { key: "booking_confirmed", name: "Booking Confirmed", description: "Sent when approved" },
      { key: "rental_reminder", name: "Return Reminder", description: "Before the car is due back" },
    ];
    expect(filterEmailTemplateTypes(types, "")).toHaveLength(2);
    expect(filterEmailTemplateTypes(types, "REMIND").map((t) => t.key)).toEqual(["rental_reminder"]);
    expect(filterEmailTemplateTypes(types, "approved").map((t) => t.key)).toEqual(["booking_confirmed"]);
    expect(filterEmailTemplateTypes(types, "rental_").map((t) => t.key)).toEqual(["rental_reminder"]);
    expect(filterEmailTemplateTypes(types, "zzz")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Email notifications                                                         */
/* -------------------------------------------------------------------------- */

const allOff = { bookings: false, payments: false, insurance: false, returns: false, verification: false, fines: false };

function resetEmailPrefs(overrides: Record<string, unknown> = {}) {
  h.emailPrefs = {
    prefs: undefined,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    setMasterEnabled: h.mut(),
    setRecipientEmail: h.mut(),
    setCategoryEnabled: h.mut(),
    ...overrides,
  };
}

describe("EmailNotificationSettingsV2", () => {
  it("loading: a skeleton, never switches painted OFF", () => {
    resetEmailPrefs();
    render(<EmailNotificationSettingsV2 />);
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("read failed: the retry card instead of the form", () => {
    resetEmailPrefs({ error: { message: "Failed to fetch" } });
    render(<EmailNotificationSettingsV2 />);
    expect(text()).toContain("Couldn't load email preferences");
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
    click(buttonByText("Try again"));
    expect(h.emailPrefs.refetch).toHaveBeenCalledTimes(1);
  });

  it("alerts on with no recipient and no contact email: says nobody receives them", () => {
    resetEmailPrefs({ prefs: { masterEnabled: true, recipientEmail: "", contactEmail: "", categories: allOff } });
    render(<EmailNotificationSettingsV2 />);
    expect(text()).toContain("No address to send to.");
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(7); // master + 6 categories
  });

  it("master off: explains why categories are disabled", () => {
    resetEmailPrefs({ prefs: { masterEnabled: false, recipientEmail: "", contactEmail: "", categories: allOff } });
    render(<EmailNotificationSettingsV2 />);
    expect(text()).toContain("Turn on email alerts above to choose categories.");
    expect(text()).not.toContain("No address to send to.");
    const category = container.querySelector('[data-category="bookings"] [role="switch"]') as HTMLButtonElement;
    expect(category.disabled).toBe(true);
  });

  it("an invalid recipient is not saved; a valid one is saved trimmed", () => {
    resetEmailPrefs({ prefs: { masterEnabled: true, recipientEmail: "", contactEmail: "desk@fleet.io", categories: allOff } });
    render(<EmailNotificationSettingsV2 />);
    const input = container.querySelector("#v2-notification-recipient") as HTMLInputElement;

    setValue(input, "abc");
    blur(input);
    expect(h.emailPrefs.setRecipientEmail.mutate).not.toHaveBeenCalled();
    expect(text()).toContain("Enter a valid email address");

    setValue(input, " ops@fleet.io ");
    blur(input);
    expect(h.emailPrefs.setRecipientEmail.mutate).toHaveBeenCalledTimes(1);
    expect(h.emailPrefs.setRecipientEmail.mutate.mock.calls[0][0]).toBe("ops@fleet.io");
  });

  it("a pending category disables only its own switch", () => {
    const setCategoryEnabled = { ...h.mut(), isPending: true, variables: { category: "payments", enabled: true } };
    resetEmailPrefs({
      prefs: { masterEnabled: true, recipientEmail: "ops@fleet.io", contactEmail: "", categories: allOff },
      setCategoryEnabled,
    });
    render(<EmailNotificationSettingsV2 />);
    const payments = container.querySelector('[data-category="payments"] [role="switch"]') as HTMLButtonElement;
    const bookings = container.querySelector('[data-category="bookings"] [role="switch"]') as HTMLButtonElement;
    expect(payments.disabled).toBe(true);
    expect(bookings.disabled).toBe(false);
  });

  it("view only: every control is inside a disabled fieldset", () => {
    resetEmailPrefs({ prefs: { masterEnabled: true, recipientEmail: "ops@fleet.io", contactEmail: "", categories: allOff } });
    render(<EmailNotificationSettingsV2 canEdit={false} />);
    expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect((container.querySelector('[role="switch"]') as HTMLElement).matches(":disabled")).toBe(true);
    // The settings page shows the one "View only" chip above this section; a
    // second copy inside it was noise.
    expect(container.querySelector('[data-settings-state="read-only"]')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Reminder timing rules                                                       */
/* -------------------------------------------------------------------------- */

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    rule_type: "MOT",
    category: "Vehicle",
    lead_days: 30,
    severity: "info",
    is_enabled: true,
    rule_code: "MOT_30",
    is_recurring: false,
    interval_type: "none",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function resetRules(data: unknown, overrides: Record<string, unknown> = {}) {
  h.rules = { data, error: null, refetch: vi.fn(), isFetching: false, ...overrides };
  h.ruleActions = { updateRule: h.mut(), resetToDefaults: h.mut() };
}

describe("ReminderRulesConfigV2", () => {
  it("read failed: retry calls refetch", () => {
    resetRules(undefined, { error: new Error("Failed to fetch reminder rules") });
    render(<ReminderRulesConfigV2 />);
    expect(text()).toContain("Couldn't load reminder rules");
    click(buttonByText("Try again"));
    expect(h.rules.refetch).toHaveBeenCalledTimes(1);
  });

  it("no rules: a real empty state, and no Reset all that would change nothing", () => {
    resetRules({});
    render(<ReminderRulesConfigV2 />);
    expect(text()).toContain("No reminder timing rules yet");
    expect(container.querySelector('[aria-label="Reset all rules to defaults"]')).toBeNull();
  });

  it("invalid days keep Save disabled with a reason; valid days save", () => {
    resetRules({ Vehicle: { MOT: [rule()] } });
    render(<ReminderRulesConfigV2 />);
    const input = container.querySelector("#v2-rule-days-r1") as HTMLInputElement;

    setValue(input, "-5");
    expect(text()).toContain("Days can't be negative.");
    expect(buttonByText("Save").disabled).toBe(true);

    setValue(input, "14");
    expect(buttonByText("Save").disabled).toBe(false);
    click(buttonByText("Save"));
    expect(h.ruleActions.updateRule.mutate).toHaveBeenCalledWith({ id: "r1", lead_days: 14 });
  });

  it("follows the stored value after a reset, but keeps an edit in progress", () => {
    resetRules({ Vehicle: { MOT: [rule({ lead_days: 30 })] } });
    render(<ReminderRulesConfigV2 />);
    const input = () => container.querySelector("#v2-rule-days-r1") as HTMLInputElement;

    h.rules = { ...h.rules, data: { Vehicle: { MOT: [rule({ lead_days: 7 })] } } };
    render(<ReminderRulesConfigV2 />);
    expect(input().value).toBe("7");

    setValue(input(), "12");
    h.rules = { ...h.rules, data: { Vehicle: { MOT: [rule({ lead_days: 30 })] } } };
    render(<ReminderRulesConfigV2 />);
    expect(input().value).toBe("12");
  });

  it("a switched-off rule still says what it would do", () => {
    resetRules({ Vehicle: { MOT: [rule({ is_enabled: false })] } });
    render(<ReminderRulesConfigV2 />);
    expect(text()).toContain("Off · 30 days before due · Info");
  });

  it("view only: no Reset all, and the rule switch is disabled", () => {
    h.perms.edit = false;
    resetRules({ Vehicle: { MOT: [rule()] } });
    render(<ReminderRulesConfigV2 />);
    expect(container.querySelector('[aria-label="Reset all rules to defaults"]')).toBeNull();
    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-settings-state="read-only"]')).toBeNull();
  });

  it("view only: a viewer can still switch categories to read the other rules", () => {
    h.perms.edit = false;
    resetRules({
      Vehicle: { MOT: [rule()] },
      Insurance: { Expiry: [rule({ id: "r2", category: "Insurance", rule_type: "Expiry", lead_days: 14 })] },
    });
    render(<ReminderRulesConfigV2 />);
    expect(text()).toContain("MOT reminders");
    const insuranceTab = Array.from(container.querySelectorAll('[role="tab"]')).find((b) =>
      b.textContent?.includes("Insurance"),
    ) as HTMLButtonElement;
    expect(insuranceTab.disabled).toBe(false);
    click(insuranceTab);
    expect(text()).toContain("Policy expiry reminders");
    expect(text()).not.toContain("MOT reminders");
  });
});

/* -------------------------------------------------------------------------- */
/* Email templates list                                                        */
/* -------------------------------------------------------------------------- */

function resetEmailTemplates(strict: Record<string, unknown>) {
  h.emailTemplates = { resetTemplateAsync: vi.fn(), saveTemplateAsync: vi.fn(), isSaving: false, isResetting: false };
  h.strictList = { data: undefined, isError: false, error: null, refetch: vi.fn(), isFetching: false, ...strict };
}

describe("EmailTemplatesListV2", () => {
  it("read failed: an error card, never every email marked Default", () => {
    resetEmailTemplates({ isError: true, error: { message: "permission denied", code: "42501" } });
    render(<EmailTemplatesListV2 />);
    expect(text()).toContain("Couldn't load your email templates");
    const chips = Array.from(container.querySelectorAll("span")).filter((s) => s.textContent === "Default");
    expect(chips).toHaveLength(0);
    expect(container.querySelector('input[type="search"]')).toBeNull();
    click(buttonByText("Try again"));
    expect(h.strictList.refetch).toHaveBeenCalledTimes(1);
  });

  it("nothing customised: every row says Customize and there is no Reset all", () => {
    resetEmailTemplates({ data: [] });
    render(<EmailTemplatesListV2 />);
    expect(text()).toContain("Every email uses the default wording.");
    expect(container.querySelectorAll("li[data-template-key]")).toHaveLength(EMAIL_TEMPLATE_TYPES.length);
    expect(container.querySelector("li a")?.textContent?.trim()).toBe("Customize");
    expect(container.querySelector('[aria-label="Reset all emails to default"]')).toBeNull();
  });

  it("view only: links say View and Reset all is hidden even with customised emails", () => {
    h.perms.edit = false;
    const first = EMAIL_TEMPLATE_TYPES[0];
    resetEmailTemplates({
      data: [{ id: "e1", tenant_id: "t1", template_key: first.key, template_name: first.name, subject: "Hi", template_content: "<p>x</p>" }],
    });
    render(<EmailTemplatesListV2 />);
    const labels = Array.from(container.querySelectorAll("li a")).map((a) => a.textContent?.trim());
    expect(new Set(labels)).toEqual(new Set(["View"]));
    expect(container.querySelector('[aria-label="Reset all emails to default"]')).toBeNull();
    expect(text()).toContain(`1 of ${EMAIL_TEMPLATE_TYPES.length} emails customized.`);
  });

  it("search with no match echoes the query and clears", () => {
    resetEmailTemplates({ data: [] });
    render(<EmailTemplatesListV2 />);
    setValue(container.querySelector('input[type="search"]') as HTMLInputElement, "zzzz-nothing");
    expect(container.querySelectorAll("li[data-template-key]")).toHaveLength(0);
    expect(text()).toContain("zzzz-nothing");
    click(buttonByText("Clear search"));
    expect(container.querySelectorAll("li[data-template-key]")).toHaveLength(EMAIL_TEMPLATE_TYPES.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Email template editor                                                       */
/* -------------------------------------------------------------------------- */

function resetEmailEditor(strict: Record<string, unknown>) {
  h.emailTemplates = {
    resetTemplateAsync: vi.fn().mockResolvedValue(undefined),
    saveTemplateAsync: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
    isResetting: false,
  };
  h.strictOne = { data: undefined, isError: false, error: null, refetch: vi.fn(), isFetching: false, ...strict };
}

// lib/default-email-templates.ts, key "rental_reminder": the subject a reset restores.
const RETURN_REMINDER_DEFAULT_SUBJECT = "Return Reminder - {{rental_number}} | {{company_name}}";

describe("EmailTemplateEditorV2", () => {
  const subjectInput = () => container.querySelector("#v2-email-subject") as HTMLInputElement | null;
  const hasButton = (name: string) =>
    Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === name);

  it("unknown key: a not-found state with a way back, no editor and no Save", () => {
    resetEmailEditor({ data: undefined });
    render(<EmailTemplateEditorV2 templateKey="no_such_email" />);
    expect(text()).toContain("This email template doesn't exist");
    expect(container.querySelector('[data-testid="tiptap"]')).toBeNull();
    expect(hasButton("Save")).toBe(false);
    click(buttonByText("Back to email templates"));
    expect(h.router.push).toHaveBeenCalledWith("/settings/email-templates");
  });

  it("read failed: the retry card, never an editor seeded with the default wording", () => {
    resetEmailEditor({ isError: true, error: { message: "Failed to fetch" } });
    render(<EmailTemplateEditorV2 templateKey="rental_reminder" />);
    expect(text()).toContain("Couldn't load this email template");
    expect(container.querySelector('[data-testid="tiptap"]')).toBeNull();
    expect(subjectInput()).toBeNull();
    expect(hasButton("Save")).toBe(false);
    click(buttonByText("Try again"));
    expect(h.strictOne.refetch).toHaveBeenCalledTimes(1);
  });

  it("a blank subject keeps Save disabled and says why", () => {
    resetEmailEditor({ data: { customTemplate: null } });
    render(<EmailTemplateEditorV2 templateKey="rental_reminder" />);
    expect(subjectInput()!.value).toBe(RETURN_REMINDER_DEFAULT_SUBJECT);
    expect(buttonByText("Save").disabled).toBe(true); // nothing changed yet
    setValue(subjectInput()!, "   ");
    expect(text()).toContain("Add a subject line.");
    expect(buttonByText("Save").disabled).toBe(true);
    setValue(subjectInput()!, "Your car is due back");
    expect(buttonByText("Save").disabled).toBe(false);
  });

  it("reset to default: the default becomes the saved state, not an unsaved change", async () => {
    resetEmailEditor({
      data: { customTemplate: { id: "e1", template_key: "rental_reminder", subject: "Custom hi", template_content: "<p>Mine</p>" } },
    });
    render(<EmailTemplateEditorV2 templateKey="rental_reminder" />);
    expect(subjectInput()!.value).toBe("Custom hi");

    click(container.querySelector('[aria-label="Reset to default"]') as HTMLButtonElement);
    const confirm = Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find(
      (b) => b.textContent?.trim() === "Reset to default",
    ) as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    expect(h.emailTemplates.resetTemplateAsync).toHaveBeenCalledWith("rental_reminder");
    expect(subjectInput()!.value).toBe(RETURN_REMINDER_DEFAULT_SUBJECT);
    expect(text()).not.toContain("Unsaved changes");
    expect(buttonByText("Save").disabled).toBe(true);
  });

  it("view only: the editor is inert, the subject is read-only, and there is no Save or Reset", () => {
    h.perms.edit = false;
    resetEmailEditor({
      data: { customTemplate: { id: "e1", template_key: "rental_reminder", subject: "Custom hi", template_content: "<p>Mine</p>" } },
    });
    render(<EmailTemplateEditorV2 templateKey="rental_reminder" />);
    expect(container.querySelector("[inert]")).not.toBeNull();
    expect(subjectInput()!.readOnly).toBe(true);
    expect(hasButton("Save")).toBe(false);
    expect(container.querySelector('[aria-label="Reset to default"]')).toBeNull();
    expect(text()).toContain("View only");
  });
});

/* -------------------------------------------------------------------------- */
/* Agreements                                                                  */
/* -------------------------------------------------------------------------- */

function resetSelection(overrides: Record<string, unknown> = {}) {
  h.selection = {
    defaultTemplate: null,
    customTemplate: null,
    activeType: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    initializeDefault: vi.fn().mockResolvedValue(undefined),
    initializeCustom: vi.fn().mockResolvedValue(undefined),
    setActiveByType: vi.fn(),
    isSettingActive: false,
    resetDefault: vi.fn(),
    isResetting: false,
    clearCustom: vi.fn(),
    isClearing: false,
    updateContentAsync: vi.fn().mockResolvedValue(undefined),
    isUpdating: false,
    resetDefaultAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AgreementTemplatesPageV2", () => {
  it("?category=payg while Pay As You Go is off: says so and shows Standard", () => {
    h.search.value = "category=payg";
    h.rental = { settings: { pay_as_you_go_enabled: false }, isLoading: false };
    resetSelection({ defaultTemplate: { template_content: "<p>T</p>", updated_at: null }, customTemplate: { template_content: "" } });
    render(<AgreementTemplatesPageV2 />);
    expect(text()).toContain("Pay As You Go is off");
    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain("Standard");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3); // no PAYG tab
  });

  it("a failed read shows a retry and never runs first-time setup", () => {
    h.rental = { settings: { pay_as_you_go_enabled: false }, isLoading: false };
    resetSelection({ defaultTemplate: undefined, customTemplate: undefined, error: { message: "Failed to fetch" } });
    render(<AgreementTemplatesPageV2 />);
    expect(text()).toContain("Couldn't load agreement templates");
    expect(h.selection.initializeDefault).not.toHaveBeenCalled();
    expect(h.selection.initializeCustom).not.toHaveBeenCalled();
  });

  it("a viewer never triggers setup writes, and sees View, not Edit", () => {
    h.perms.edit = false;
    h.rental = { settings: { pay_as_you_go_enabled: false }, isLoading: false };
    resetSelection();
    render(<AgreementTemplatesPageV2 />);
    expect(h.selection.initializeDefault).not.toHaveBeenCalled();
    const labels = Array.from(container.querySelectorAll("a")).map((a) => a.textContent?.trim());
    expect(labels).toContain("View");
    expect(labels).not.toContain("Edit");
    expect(text()).toContain("No custom agreement yet");
  });
});

describe("AgreementTemplateEditorV2", () => {
  const props = { disclaimerHtml: "<hr/><p><strong>Platform Disclaimer</strong></p><p>Fixed text.</p>", depositClauseSample: "" };

  it("unknown ?type=: a not-found state with a way back, no editor", () => {
    h.search.value = "type=foo";
    resetSelection();
    render(<AgreementTemplateEditorV2 {...props} />);
    expect(text()).toContain("This agreement doesn't exist");
    expect(container.querySelector('[data-testid="tiptap"]')).toBeNull();
  });

  it("read failed: the retry card, never an editor seeded with default wording", () => {
    h.search.value = "type=default&category=standard";
    resetSelection({ defaultTemplate: undefined, error: { message: "Failed to fetch" } });
    render(<AgreementTemplateEditorV2 {...props} />);
    expect(text()).toContain("Couldn't load this agreement");
    expect(container.querySelector('[data-testid="tiptap"]')).toBeNull();
  });

  it("view only: the editor is inert and there is no Save", () => {
    h.perms.edit = false;
    h.search.value = "type=default&category=installment";
    resetSelection({ defaultTemplate: { template_content: "<p>Terms</p>" } });
    render(<AgreementTemplateEditorV2 {...props} />);
    expect(text()).toContain("Installment Plan");
    expect(container.querySelector("[inert]")).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Save")).toBe(false);
  });

  it("blank content blocks Save; real content saves", async () => {
    h.search.value = "type=default&category=standard";
    resetSelection({ defaultTemplate: { template_content: "<p>Terms</p>" } });
    render(<AgreementTemplateEditorV2 {...props} />);
    const editor = () => container.querySelector('[data-testid="tiptap"]') as HTMLTextAreaElement;

    setValue(editor(), "<p></p>");
    expect(text()).toContain("The agreement is empty.");
    expect(buttonByText("Save").disabled).toBe(true);

    setValue(editor(), "<p>New terms</p>");
    expect(buttonByText("Save").disabled).toBe(false);
    await act(async () => {
      buttonByText("Save").click();
    });
    expect(h.selection.updateContentAsync).toHaveBeenCalledWith({ type: "default", content: "<p>New terms</p>" });
  });
});

/* -------------------------------------------------------------------------- */
/* Push: the v2 gate on the shared component                                   */
/* -------------------------------------------------------------------------- */

function resetPush(overrides: Record<string, unknown> = {}, log: Record<string, unknown> = {}) {
  h.push = {
    isSupported: true,
    needsInstall: false,
    isEnabledForTenant: true,
    isSubscribed: true,
    isLoading: false,
    isBusy: false,
    error: null,
    permission: "granted",
    capability: {},
    enable: vi.fn(),
    disable: vi.fn(),
    staffDevices: [],
    customerDevices: [],
    devicesLoading: false,
    devicesError: null,
    refetchDevices: vi.fn(),
    sendPush: { isPending: false, mutateAsync: vi.fn() },
    ...overrides,
  };
  h.pushLog = { data: [], isLoading: false, isError: false, refetch: vi.fn(), isFetching: false, ...log };
}

describe("PushNotificationSettings (v2 gate)", () => {
  it("v1 is unchanged: with no sends the history card stays hidden", () => {
    h.v2.on = false;
    resetPush();
    render(<PushNotificationSettings />);
    expect(text()).not.toContain("Recent sends");
    expect(text()).not.toContain("No notifications sent yet");
  });

  it("v2, no sends: the history card explains what will appear", () => {
    resetPush();
    render(<PushNotificationSettings />);
    expect(text()).toContain("Recent sends");
    expect(text()).toContain("No notifications sent yet. Your last 10 sends will appear here.");
  });

  it("v2, devices read failed: counts are unknown, not zero, with a retry", () => {
    resetPush({ devicesError: new Error("boom") });
    render(<PushNotificationSettings />);
    expect(text()).toContain("Couldn't load enrolled devices");
    expect(text()).not.toContain("No devices enrolled yet");
    click(buttonByText("Try again"));
    expect(h.push.refetchDevices).toHaveBeenCalledTimes(1);
  });

  it("v2, feature off for the tenant: an empty state with a support action", () => {
    resetPush({ isEnabledForTenant: false });
    render(<PushNotificationSettings />);
    expect(text()).toContain("Push notifications aren't on for your account");
    expect(container.querySelector('a[href="mailto:support@drive-247.com"]')).not.toBeNull();
  });

  it("v2, tenant not resolved yet: a skeleton, not the 'not enabled' card", () => {
    h.tenant.value = null;
    resetPush({ isEnabledForTenant: false });
    render(<PushNotificationSettings />);
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    expect(text()).not.toContain("aren't on for your account");
  });

  it("v2, blocked browser sending to itself: Send is disabled with the reason", () => {
    resetPush({ permission: "denied", isSubscribed: false });
    render(<PushNotificationSettings />);
    expect(buttonByText("Send notification").disabled).toBe(true);
    expect(text()).toContain("This browser can't receive push notifications.");
  });
});
