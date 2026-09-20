/**
 * Notifications v2: the page (notifications-page-v2.tsx), its item panel and
 * its pure model (notifications-page-model.ts), plus the routing that sends the
 * old `?tab=reminders` / `?tab=push` links to it (settings-shell-state).
 *
 * The data hooks are mocked (they have their own tests). The catalog,
 * settings-model, the page model, the previews, the Send test box and the
 * variable inputs are the real modules, so what is asserted is what the page
 * does. The setup cards (Email sender, Push on this device) and the team email
 * categories are stubbed to record their props: each has its own test file.
 * The Tiptap editor (loaded with next/dynamic) is a plain textarea here.
 *
 * Expected values come from the catalog and the exported copy, never from the
 * component under test.
 *
 * HARNESS: `react-dom/client` + `act`, as in notifications-v2-setup-ui.test.tsx.
 */

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
  pushSetupProps: null as any,
  senderProps: null as any,
  categoriesProps: null as any,
}));

vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant }) }));
vi.mock("@/stores/auth-store", () => ({ useAuth: () => ({ appUser: h.appUser, user: null }) }));
vi.mock("@/hooks/use-notification-settings-v2", () => ({ useNotificationSettingsV2: () => h.settings }));
vi.mock("@/hooks/use-email-sender-v2", () => ({ EMAIL_SENDER_NAME_MAX: 100, useEmailSenderV2: () => h.sender }));
vi.mock("@/hooks/use-email-notification-prefs", () => ({ useEmailNotificationPrefs: () => h.prefs }));
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
vi.mock("@/components/settings-v2/notifications-v2/push-setup-v2", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("@/components/settings-v2/notifications-v2/push-setup-v2")>(
    "@/components/settings-v2/notifications-v2/push-setup-v2",
  );
  return {
    ...actual,
    PushSetupV2: (props: any) => {
      h.pushSetupProps = props;
      return React.createElement("div", { "data-push-setup-stub": "" }, "Push on this device");
    },
  };
});
vi.mock("@/components/settings-v2/notifications-v2/email-sender-settings-v2", async () => {
  const React = await import("react");
  return {
    EmailSenderSettingsV2: (props: any) => {
      h.senderProps = props;
      return React.createElement("div", { "data-sender-stub": "" }, "Email");
    },
  };
});
vi.mock("@/components/settings-v2/notification-states-v2", async () => {
  const React = await import("react");
  return {
    EmailNotificationSettingsV2: (props: any) => {
      h.categoriesProps = props;
      return React.createElement("div", { "data-categories-stub": "" }, "Team alert emails by category");
    },
  };
});
// The Tiptap editor, as a textarea that reports what is typed (value in, onChange out).
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

import { NotificationsPageV2, notificationToggleId } from "@/components/settings-v2/notifications-v2/notifications-page-v2";
import {
  NOTIFICATIONS_PAGE_COPY as COPY,
  NOTIFICATIONS_SAVE_KEY,
  NOTIFICATIONS_TODAY_ANCHOR,
  NOTIFICATION_DIRECTION_GROUPS,
  PUSH_OPTION_COPY,
  PUSH_SETUP_TEST_KEY,
  TEAM_ACTION_ITEM_KEYS,
  TODAY_COPY,
  categoryGroups,
  channelSpec,
  isNotSentYet,
  itemMetaLine,
  notApplicableCopy,
  notSentYetCopy,
  pushSetupTestResponse,
} from "@/components/settings-v2/notifications-v2/notifications-page-model";
import { PUSH_SETUP_TEST_MESSAGE } from "@/components/settings-v2/notifications-v2/push-setup-v2";
import { NOTIFICATION_CATALOG, NOTIFICATION_CATEGORIES, getNotificationItem, itemsFor } from "@/lib/notifications-v2/catalog";
import { effectiveChannel } from "@/lib/notifications-v2/settings-model";
import { exampleValues } from "@/lib/notifications-v2/variables";
import {
  V2_NOTIFICATIONS_SECTIONS,
  resolveV2SettingsRoute,
  settingsSectionId,
  v2NoticePages,
  v2SectionHomePage,
} from "@/components/settings-v2/settings-shell-state";
import { SETTINGS_VALUE_TO_KEY } from "@/lib/permissions";
import { SettingsRow, SettingsRowAlignProvider } from "@/components/settings-v2/settings-kit";

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
const all = <T extends Element = HTMLElement>(selector: string) => Array.from(container.querySelectorAll<T>(selector));
const one = <T extends Element = HTMLElement>(selector: string) => {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`Nothing matches ${selector}`);
  return el;
};

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

/** Radix Tabs activate on mousedown with the main button. */
function selectTab(channel: string) {
  const trigger = one(`[data-channel-tab="${channel}"]`);
  act(() => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The input a <label> with this text points at. */
function field(label: string, scope: ParentNode = container): HTMLInputElement | HTMLTextAreaElement {
  const hit = Array.from(scope.querySelectorAll("label")).find((l) => l.textContent?.trim() === label);
  if (!hit) throw new Error(`No label "${label}"`);
  return document.getElementById(hit.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
}

const row = (key: string) => one(`[data-notification-item="${key}"]`);
const channelSwitch = (key: string, channel: "email" | "push" | "in_app") =>
  row(key).querySelector<HTMLButtonElement>(`[data-channel-cell="${channel}"] [role="switch"]`);
const openItem = (key: string) => click(document.getElementById(notificationToggleId(key))!);
const panel = () => container.querySelector<HTMLElement>("[data-notification-panel]");

/** The latest registration for the page's key: the save (or null) and the discard. */
function registration(registerSave: ReturnType<typeof vi.fn>) {
  const calls = registerSave.mock.calls.filter((c) => c[0] === NOTIFICATIONS_SAVE_KEY);
  const last = calls[calls.length - 1];
  return { save: (last?.[1] ?? null) as null | (() => Promise<void>), discard: last?.[2] as undefined | (() => void) };
}
const everRegistered = (registerSave: ReturnType<typeof vi.fn>) =>
  registerSave.mock.calls.some((c) => c[0] === NOTIFICATIONS_SAVE_KEY && typeof c[1] === "function");

function resetSettings(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

// Two items the tests lean on, looked up from the catalog so a rename fails loudly here.
const NEW_BOOKING = getNotificationItem("new_booking_team")!;
const DRIVER_INVITE = getNotificationItem("driver_invite_customer")!;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.tenant = { id: "t1", slug: "northwind", company_name: "Northwind Rentals", currency_code: "USD", push_notifications_enabled: true };
  h.appUser = { id: "u1", role: "head_admin", email: "jo@northwind.test" };
  h.sender = { sender: { from_name: null, from_local_part: null, reply_to: null }, isLoading: false, error: null, tableMissing: false };
  h.prefs = { prefs: { masterEnabled: true, recipientEmail: "alerts@northwind.test", contactEmail: "office@northwind.test", categories: {} } };
  h.sendTest = vi.fn(async () => ({ success: true, sent: 1, message: "Sent." }));
  h.pushSetupProps = null;
  h.senderProps = null;
  h.categoriesProps = null;
  resetSettings();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Structure: from the catalog                                                 */
/* -------------------------------------------------------------------------- */

describe("the page's structure comes from the catalog", () => {
  it("two direction groups, each with its categories in catalog order (empty ones skipped) and its items", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const groups = all("[data-notification-direction]");
    expect(groups.map((g) => g.getAttribute("data-notification-direction"))).toEqual(["customer_to_team", "team_to_customer"]);
    for (const group of groups) {
      const direction = group.getAttribute("data-notification-direction") as "customer_to_team" | "team_to_customer";
      const expectedCategories = NOTIFICATION_CATEGORIES.map((c) => c.id).filter((id) => itemsFor(direction, id).length > 0);
      const categories = Array.from(group.querySelectorAll("[data-notification-category]"));
      expect(categories.map((c) => c.getAttribute("data-notification-category"))).toEqual(expectedCategories);
      for (const category of categories) {
        const id = category.getAttribute("data-notification-category") as any;
        const keys = Array.from(category.querySelectorAll("[data-notification-item]")).map((r) => r.getAttribute("data-notification-item"));
        expect(keys).toEqual(itemsFor(direction, id).map((i) => i.key));
        // Each category is a titled region.
        expect(category.querySelector("h3")?.textContent).toBe(NOTIFICATION_CATEGORIES.find((c) => c.id === id)!.label);
      }
    }
    // Every catalog item once, and nothing else.
    const rendered = all("[data-notification-item]").map((r) => r.getAttribute("data-notification-item"));
    expect([...rendered].sort()).toEqual(NOTIFICATION_CATALOG.map((i) => i.key).sort());
  });

  it("the group headings are the lead's two directions", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const headings = all("h2").map((el) => el.textContent);
    for (const group of NOTIFICATION_DIRECTION_GROUPS) expect(headings).toContain(group.title);
    expect(NOTIFICATION_DIRECTION_GROUPS.map((g) => g.title)).toEqual(["Customer → Your team", "Your team → Customer"]);
  });

  it("a row: name, the plain when · where · who line, the direction chip, and a labelled switch only per offered channel", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    // Email only: the other two are a dash with a reason.
    const r = row(DRIVER_INVITE.key);
    expect(r.textContent).toContain(DRIVER_INVITE.name);
    expect(r.textContent).toContain(itemMetaLine(DRIVER_INVITE));
    expect(itemMetaLine(DRIVER_INVITE)).toBe(`${DRIVER_INVITE.when.replace(/\.$/, "")} · Portal · ${DRIVER_INVITE.recipient}`);
    expect(r.querySelector("[data-direction-chip]")?.textContent).toBe("Admin → Customer");
    expect(channelSwitch(DRIVER_INVITE.key, "email")?.getAttribute("aria-label")).toBe(`Email for ${DRIVER_INVITE.name}`);
    expect(channelSwitch(DRIVER_INVITE.key, "push")).toBeNull();
    expect(channelSwitch(DRIVER_INVITE.key, "in_app")).toBeNull();
    expect(r.querySelectorAll("[data-channel-na]")).toHaveLength(2);
    expect(r.querySelector('[data-channel-cell="push"] [data-channel-na]')?.getAttribute("aria-label")).toBe(
      `Push: not available for ${DRIVER_INVITE.name}`,
    );
    // Three channels: three switches, each showing the catalog default.
    for (const channel of ["email", "push", "in_app"] as const) {
      const sw = channelSwitch(NEW_BOOKING.key, channel)!;
      expect(sw).not.toBeNull();
      expect(sw.getAttribute("aria-checked")).toBe(String(effectiveChannel(NEW_BOOKING, channel).enabled));
    }
    expect(row(NEW_BOOKING.key).querySelector("[data-direction-chip]")?.textContent).toBe("Customer → Admin");
    // The info button carries the item's tooltip trigger.
    expect(row(NEW_BOOKING.key).querySelector(`[aria-label="About ${NEW_BOOKING.name}"]`)).not.toBeNull();
  });

  it("a stored row shows over the default, and an edited wording shows Edited", () => {
    const def = effectiveChannel(NEW_BOOKING, "push");
    resetSettings({
      rows: [
        { tenant_id: "t1", notification_key: NEW_BOOKING.key, channel: "push", enabled: !def.enabled, subject: null, title: "Custom", body: null, push_options: {} },
      ],
    });
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(channelSwitch(NEW_BOOKING.key, "push")!.getAttribute("aria-checked")).toBe(String(!def.enabled));
    expect(row(NEW_BOOKING.key).querySelector("[data-edited-badge]")?.textContent).toBe(COPY.edited);
    expect(row(DRIVER_INVITE.key).querySelector("[data-edited-badge]")).toBeNull();
  });

  it("marks exactly the team's own actions as Team action, and only team items", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const marked = all("[data-team-action]").map((el) => el.closest("[data-notification-item]")!.getAttribute("data-notification-item"));
    expect(new Set(marked)).toEqual(new Set(TEAM_ACTION_ITEM_KEYS));
    expect(all("[data-team-action]")[0].textContent).toContain(COPY.teamAction);
    // The set, checked against the catalog by hand-picked rule: every team item a
    // staff member triggers in the portal, plus the refund record.
    for (const key of TEAM_ACTION_ITEM_KEYS) {
      const item = getNotificationItem(key);
      expect(item, key).toBeDefined();
      expect(item!.direction, key).toBe("customer_to_team");
    }
    for (const item of NOTIFICATION_CATALOG) {
      if (item.direction === "customer_to_team" && item.side === "portal") expect(TEAM_ACTION_ITEM_KEYS.has(item.key), item.key).toBe(true);
      if (item.side === "booking_site") expect(TEAM_ACTION_ITEM_KEYS.has(item.key), item.key).toBe(false);
    }
  });

  it("categoryGroups skips a category with no items in that direction", () => {
    for (const group of NOTIFICATION_DIRECTION_GROUPS) {
      for (const { items } of categoryGroups(group.direction)) expect(items.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Top of the page and the Channels section                                    */
/* -------------------------------------------------------------------------- */

describe("the top notice and the channels", () => {
  it("says honestly that live sending (and today's sender) is unchanged until sending switches over (D18)", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const notice = one("[data-notifications-notice]");
    expect(notice.getAttribute("data-notifications-notice")).toBe("sending-unchanged");
    expect(notice.textContent).toBe(COPY.notice);
    expect(COPY.notice).toMatch(/Send test/);
    expect(COPY.notice).toMatch(/today's sender address/);
    expect(COPY.notice).toMatch(/until sending switches over/);
  });

  it("Channels: the Email card, Push on this device and the In-app explainer, at the ids the old tabs scroll to", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    for (const section of V2_NOTIFICATIONS_SECTIONS) {
      expect(document.getElementById(settingsSectionId(section.anchor)), section.anchor).not.toBeNull();
    }
    expect(document.getElementById(settingsSectionId("notifications-email"))!.querySelector("[data-sender-stub]")).not.toBeNull();
    expect(document.getElementById(settingsSectionId("notifications-push"))!.querySelector("[data-push-setup-stub]")).not.toBeNull();
    // The sender card saves through the same bar.
    expect(h.senderProps).toMatchObject({ canEdit: true, registerSave });
    expect(one('[data-settings-section="in-app"]').textContent).toContain(COPY.inAppTeam);
    expect(one('[data-settings-section="in-app"]').textContent).toContain(COPY.inAppCustomer);
  });

  it("Push on this device tests through notification-test-v2, with the Open in app button", async () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(h.pushSetupProps.canEdit).toBe(true);
    const response = await h.pushSetupProps.onSendTest();
    expect(h.sendTest).toHaveBeenCalledTimes(1);
    expect(h.sendTest).toHaveBeenCalledWith({
      channel: "push",
      notificationKey: PUSH_SETUP_TEST_KEY,
      title: PUSH_SETUP_TEST_MESSAGE.title,
      body: PUSH_SETUP_TEST_MESSAGE.body,
      url: PUSH_SETUP_TEST_MESSAGE.url,
      pushOptions: { openInApp: true },
    });
    expect(response).toEqual({ success: true, sent: 1, message: "Sent." });
  });

  it("the test function's no-devices answer reads as nothing to send to, not a failure", () => {
    expect(pushSetupTestResponse({ success: false, code: "no_devices", message: "No devices.", error: "No devices." })).toEqual({
      success: true,
      sent: 0,
      failed: 0,
      message: "No devices.",
    });
    const failure = { success: false, code: "rate_limited", error: "Too many tests." };
    expect(pushSetupTestResponse(failure)).toBe(failure);
  });

  it("What's sent today: the team email categories alone, then the settings page's reminder settings", () => {
    render(
      <NotificationsPageV2 canEdit registerSave={vi.fn()} todaySettings={<div data-today-slot="">In-app payment reminders</div>} />,
    );
    const today = document.getElementById(settingsSectionId(NOTIFICATIONS_TODAY_ANCHOR))!;
    expect(today).not.toBeNull();
    expect(today.textContent).toContain(COPY.todayTitle);
    expect(today.textContent).toContain(COPY.todayDescription);
    expect(today.querySelector("[data-categories-stub]")).not.toBeNull();
    expect(h.categoriesProps).toEqual({ canEdit: true, parts: "categories" });
    expect(today.querySelector("[data-today-slot]")).not.toBeNull();
    // It comes last, after both direction groups.
    const sections = all("[data-settings-section]").map((el) => el.getAttribute("data-settings-section"));
    expect(sections[sections.length - 1]).toBe(NOTIFICATIONS_TODAY_ANCHOR);
  });

  it("scrolls to an old link's section once, when it first renders", () => {
    const spy = vi.fn();
    const original = (HTMLElement.prototype as any).scrollIntoView;
    (HTMLElement.prototype as any).scrollIntoView = function (this: HTMLElement, ...args: unknown[]) {
      spy(this.id, ...args);
    };
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    try {
      render(<NotificationsPageV2 canEdit registerSave={vi.fn()} scrollTarget={settingsSectionId("notifications-push")} />);
      expect(spy).toHaveBeenCalledWith(settingsSectionId("notifications-push"), { block: "start" });
      spy.mockClear();
      render(<NotificationsPageV2 canEdit registerSave={vi.fn()} scrollTarget={settingsSectionId("notifications-email")} />);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      (HTMLElement.prototype as any).scrollIntoView = original;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Editing and the one save                                                    */
/* -------------------------------------------------------------------------- */

describe("editing and the page's one save", () => {
  it("nothing to save at first: the key is registered empty", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    expect(registration(registerSave).save).toBeNull();
    expect(everRegistered(registerSave)).toBe(false);
  });

  it("a switch marks the row unsaved and registers the save; Save writes exactly that change, then clears it", async () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    const before = effectiveChannel(NEW_BOOKING, "push").enabled;
    click(channelSwitch(NEW_BOOKING.key, "push")!);
    expect(channelSwitch(NEW_BOOKING.key, "push")!.getAttribute("aria-checked")).toBe(String(!before));
    expect(row(NEW_BOOKING.key).querySelector("[data-unsaved-marker]")?.textContent).toBe(COPY.unsaved);

    const { save } = registration(registerSave);
    expect(save).toBeTypeOf("function");
    await act(async () => {
      await save!();
    });
    expect(h.settings.saveRows).toHaveBeenCalledTimes(1);
    const diff = h.settings.saveRows.mock.calls[0][0];
    expect(diff.deletes).toEqual([]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({
      tenant_id: "t1",
      notification_key: NEW_BOOKING.key,
      channel: "push",
      enabled: !before,
      subject: null,
      title: null,
      body: null,
    });
    // Saved: the draft is gone, so nothing is registered and no row says Unsaved.
    expect(registration(registerSave).save).toBeNull();
    expect(container.querySelector("[data-unsaved-marker]")).toBeNull();
  });

  it("switching back to the stored value is not a change", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    click(channelSwitch(NEW_BOOKING.key, "email")!);
    expect(registration(registerSave).save).toBeTypeOf("function");
    click(channelSwitch(NEW_BOOKING.key, "email")!);
    expect(registration(registerSave).save).toBeNull();
  });

  it("a failed save throws the reason and keeps the edit", async () => {
    const registerSave = vi.fn();
    h.settings.saveRows = vi.fn(async () => {
      throw new Error("Couldn't save your notification settings. Try again in a moment.");
    });
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    click(channelSwitch(NEW_BOOKING.key, "in_app")!);
    const { save } = registration(registerSave);
    let thrown: unknown;
    await act(async () => {
      await save!().catch((e) => {
        thrown = e;
      });
    });
    expect((thrown as Error).message).toBe("Couldn't save your notification settings. Try again in a moment.");
    expect(registration(registerSave).save).toBeTypeOf("function");
    expect(row(NEW_BOOKING.key).querySelector("[data-unsaved-marker]")).not.toBeNull();
  });

  it("the bar's Reset drops every edit", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    const before = channelSwitch(NEW_BOOKING.key, "push")!.getAttribute("aria-checked");
    click(channelSwitch(NEW_BOOKING.key, "push")!);
    act(() => registration(registerSave).discard!());
    expect(channelSwitch(NEW_BOOKING.key, "push")!.getAttribute("aria-checked")).toBe(before);
    expect(registration(registerSave).save).toBeNull();
  });

  it("the email template box grows to the preview's height; push and in-app sit at the top", () => {
    // The email column used to end at the variables list while the Gmail
    // preview beside it ran on, leaving a tall empty gap under the template.
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    const box = panel()!;
    const fields = box.querySelector("[data-channel-fields]") as HTMLElement;
    const grid = fields.parentElement!;
    expect(fields.className).toContain("flex");
    expect(grid.className).not.toContain("items-start");
    // The message block is what takes the space, not the subject or the buttons.
    const message = box.querySelector("[data-editor-stub]")!.closest("div.flex-1");
    expect(message).not.toBeNull();
    expect(message!.className).toContain("flex-col");

    // Push: short inputs, so the row is only as tall as it needs to be.
    selectTab("push");
    const pushFields = box.querySelector("[data-channel-fields]") as HTMLElement;
    expect(pushFields.parentElement!.className).toContain("items-start");
  });

  it("a template problem blocks Save with the reason, and opens that item at that channel", async () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    openItem(NEW_BOOKING.key);
    typeInto(field(COPY.subject, panel()!), "");
    // Inline, under the field.
    expect(panel()!.querySelector('[data-field-issues="subject"]')?.textContent).toBe("Add a subject.");
    openItem(NEW_BOOKING.key); // close it: Save must reopen it
    expect(panel()).toBeNull();

    let thrown: unknown;
    await act(async () => {
      await registration(registerSave).save!().catch((e) => {
        thrown = e;
      });
    });
    expect((thrown as Error).message).toBe(`Check the email for ${NEW_BOOKING.name}: Add a subject.`);
    expect(h.settings.saveRows).not.toHaveBeenCalled();
    expect(panel()?.getAttribute("data-notification-panel")).toBe(NEW_BOOKING.key);
    expect(one('[data-channel-tab="email"]').getAttribute("data-state")).toBe("active");
  });

  it("a Button block with no link blocks Save", async () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    openItem(NEW_BOOKING.key);
    const editor = one<HTMLTextAreaElement>("[data-editor-stub]");
    typeInto(editor, "<p>A new booking came in.</p><p><a data-email-button>Open it</a></p>");
    expect(panel()!.querySelector('[data-field-issues="body"]')?.textContent).toBe("A button has no link.");
    let thrown: unknown;
    await act(async () => {
      await registration(registerSave).save!().catch((e) => {
        thrown = e;
      });
    });
    expect((thrown as Error).message).toBe(`Check the email for ${NEW_BOOKING.name}: A button has no link.`);
    expect(h.settings.saveRows).not.toHaveBeenCalled();
    // Send test is blocked by the same problem.
    const trigger = Array.from(panel()!.querySelectorAll<HTMLButtonElement>("[data-send-test] button")).find(
      (b) => b.textContent?.trim() === "Send test",
    )!;
    expect(trigger.disabled).toBe(true);
    expect(panel()!.textContent).toContain(COPY.fixToTest);
  });

  it("Reset to default puts the catalog wording back as a draft (and is off while it is the default)", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    openItem(NEW_BOOKING.key);
    const reset = () => one<HTMLButtonElement>('[data-reset-channel="email"]');
    expect(reset().disabled).toBe(true);
    typeInto(field(COPY.subject, panel()!), "Something else");
    expect(reset().disabled).toBe(false);
    expect(registration(registerSave).save).toBeTypeOf("function");
    click(reset());
    expect((field(COPY.subject, panel()!) as HTMLInputElement).value).toBe(
      (NEW_BOOKING.channels.email!.defaultTemplate as { subject: string }).subject,
    );
    expect(registration(registerSave).save).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The item panel                                                              */
/* -------------------------------------------------------------------------- */

describe("opening an item", () => {
  it("shows one tab per channel the item offers, under its row, and only one panel at a time", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const toggle = document.getElementById(notificationToggleId(NEW_BOOKING.key))!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    openItem(NEW_BOOKING.key);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(panel()!.id);
    expect(row(NEW_BOOKING.key).contains(panel())).toBe(true);
    expect(all("[data-channel-tab]").map((t) => t.getAttribute("data-channel-tab"))).toEqual(["email", "push", "in_app"]);

    openItem(DRIVER_INVITE.key);
    expect(all("[data-notification-panel]")).toHaveLength(1);
    expect(panel()!.getAttribute("data-notification-panel")).toBe(DRIVER_INVITE.key);
    expect(all("[data-channel-tab]").map((t) => t.getAttribute("data-channel-tab"))).toEqual(["email"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("Email: subject, the editor and the Gmail preview filled with examples; Send test goes to the operator", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    const p = panel()!;
    expect(field(COPY.subject, p)).toBeTruthy();
    expect(p.querySelector("[data-editor-stub]")?.getAttribute("aria-label")).toBe(`Email message for ${NEW_BOOKING.name}`);
    expect(p.querySelector("[data-gmail-subject]")?.textContent).not.toContain("{{");
    // A team item's preview is addressed to the team's alert address ("to me ▾" opens the details).
    const toMe = () => Array.from(panel()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "to me")!;
    click(toMe());
    expect(panel()!.querySelector("[data-gmail-details]")?.textContent).toContain("alerts@northwind.test");
    expect(panel()!.querySelector("[data-gmail-details]")?.textContent).toContain("northwind@drive-247.com");
    expect(p.querySelector("iframe")).not.toBeNull();
    expect(p.querySelector("[data-variables-help]")).not.toBeNull();
    const trigger = Array.from(p.querySelectorAll<HTMLButtonElement>("[data-send-test] button")).find((b) => b.textContent?.trim() === "Send test")!;
    expect(trigger.disabled).toBe(false);
    click(trigger);
    // Pre-filled with the signed-in operator's email.
    expect(field("Send the test to", panel()!).value).toBe("jo@northwind.test");

    // A customer item's preview is addressed to the example customer.
    const customerItem = getNotificationItem("booking_received_customer")!;
    openItem(customerItem.key);
    click(toMe());
    expect(panel()!.querySelector("[data-gmail-details]")?.textContent).toContain(exampleValues()["customer_email"]);
  });

  it("Push: title, message, the four display options with a plain line each, the phone note, and the phone preview", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("push");
    const p = panel()!;
    expect(field(COPY.title, p)).toBeTruthy();
    expect(field(COPY.message, p)).toBeTruthy();
    for (const option of PUSH_OPTION_COPY) {
      expect(p.textContent).toContain(option.label);
      expect(p.textContent).toContain(option.description);
    }
    expect(PUSH_OPTION_COPY.map((o) => o.label)).toEqual([
      "Stay on screen until dismissed",
      "Silent",
      "Replace the previous one",
      "Open in app button",
    ]);
    expect(p.textContent).toContain(COPY.pushPhoneNote);
    expect(p.querySelector("[data-push-mockup]")).not.toBeNull();
    expect(p.querySelector('[data-send-test="push"]')).not.toBeNull();
  });

  it("Push: Send test sends the display options as set", async () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("push");
    const optionSwitch = document.getElementById(
      Array.from(panel()!.querySelectorAll("label")).find((l) => l.textContent === "Open in app button")!.htmlFor,
    )!;
    click(optionSwitch);
    const buttons = () => Array.from(panel()!.querySelectorAll<HTMLButtonElement>('[data-send-test="push"] button'));
    click(buttons().find((b) => b.textContent?.trim() === "Send test")!);
    await act(async () => {
      buttons().find((b) => b.textContent?.trim() === "Send")!.click();
    });
    expect(h.sendTest).toHaveBeenCalledTimes(1);
    const request = h.sendTest.mock.calls[0][0];
    expect(request).toMatchObject({ channel: "push", notificationKey: NEW_BOOKING.key });
    expect(request.pushOptions.openInApp).toBe(!effectiveChannel(NEW_BOOKING, "push").pushOptions.openInApp);
    expect(request.title).not.toContain("{{");
  });

  it("In-app: title and message, the bell preview, and no test send", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("in_app");
    const p = panel()!;
    expect(field(COPY.title, p)).toBeTruthy();
    expect(p.querySelector('[data-inapp-mockup="team"]')).not.toBeNull();
    expect(p.querySelector("[data-send-test]")).toBeNull();
    expect(p.querySelector("[data-inapp-no-test]")?.textContent).toBe(COPY.inAppNoTest);
  });

  it("Close shuts the panel", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    click(one("[data-panel-close]"));
    expect(panel()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Storage off, read-only, loading and a failed read                           */
/* -------------------------------------------------------------------------- */

describe("when saving can't happen", () => {
  it("storage not switched on: the reason is at the top, edits are allowed to preview, and no save is ever registered", () => {
    resetSettings({ tableMissing: true });
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    const notice = one("[data-notifications-notice]");
    expect(notice.getAttribute("data-notifications-notice")).toBe("storage-off");
    expect(notice.textContent).toContain("Saving turns on once notifications storage is switched on.");
    expect(COPY.storageOff).toBe("Saving turns on once notifications storage is switched on.");
    // Before the page's groups, right under the header.
    expect(container.firstElementChild!.firstElementChild).toBe(notice);

    click(channelSwitch(NEW_BOOKING.key, "push")!);
    expect(notice.textContent).toContain(COPY.storageOffEdits);
    expect(everRegistered(registerSave)).toBe(false);

    // Previews and Send test still work.
    openItem(NEW_BOOKING.key);
    const trigger = Array.from(panel()!.querySelectorAll<HTMLButtonElement>("[data-send-test] button")).find((b) => b.textContent?.trim() === "Send test")!;
    expect(trigger.disabled).toBe(false);
    expect(panel()!.querySelector("iframe")).not.toBeNull();
  });

  it("read-only: every switch and field is off, no reset, Send test says why; panels and previews still work", () => {
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit={false} registerSave={registerSave} />);
    const switches = all<HTMLButtonElement>('[data-notification-item] [role="switch"]');
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) expect(sw.disabled).toBe(true);
    expect(h.pushSetupProps.canEdit).toBe(false);
    expect(h.senderProps.canEdit).toBe(false);
    expect(h.categoriesProps.canEdit).toBe(false);

    openItem(NEW_BOOKING.key);
    const p = panel()!;
    expect((field(COPY.subject, p) as HTMLInputElement).readOnly).toBe(true);
    expect(one<HTMLTextAreaElement>("[data-editor-stub]").readOnly).toBe(true);
    expect(p.querySelector("[data-reset-channel]")).toBeNull();
    const trigger = Array.from(p.querySelectorAll<HTMLButtonElement>("[data-send-test] button")).find((b) => b.textContent?.trim() === "Send test")!;
    expect(trigger.disabled).toBe(true);
    expect(p.textContent).toContain(COPY.noTestForViewer);

    // The preview's own switches still work for a viewer.
    const phone = Array.from(p.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.includes("Phone"))!;
    expect(phone.disabled).toBe(false);
    click(phone);
    expect(phone.getAttribute("aria-checked")).toBe("true");
    selectTab("push");
    for (const sw of all<HTMLButtonElement>('[data-push-options] [role="switch"]')) expect(sw.disabled).toBe(true);
    expect(panel()!.querySelector("[data-push-mockup]")).not.toBeNull();

    expect(everRegistered(registerSave)).toBe(false);
  });

  it("an ops user may edit but not send tests, and is told why", async () => {
    h.appUser = { id: "u2", role: "ops", email: "ops@northwind.test" };
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    // Push on this device says so too, without calling the function.
    expect(await h.pushSetupProps.onSendTest()).toMatchObject({ success: false, error: COPY.noTestForRole });
    expect(h.sendTest).not.toHaveBeenCalled();
    openItem(NEW_BOOKING.key);
    const trigger = Array.from(panel()!.querySelectorAll<HTMLButtonElement>("[data-send-test] button")).find((b) => b.textContent?.trim() === "Send test")!;
    expect(trigger.disabled).toBe(true);
    expect(panel()!.textContent).toContain(COPY.noTestForRole);
  });

  it("loading: a skeleton, never the catalog defaults painted as the tenant's settings", () => {
    resetSettings({ isLoading: true });
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(container.querySelector("[data-notification-item]")).toBeNull();
    const skeleton = all('[data-settings-state="loading"]').find((el) => el.textContent?.includes(COPY.loading));
    expect(skeleton).toBeDefined();
    expect(everRegistered(vi.fn())).toBe(false);
  });

  it("a failed read: the error with Try again, no rows, nothing registered", () => {
    const refetch = vi.fn();
    resetSettings({ error: new Error("Couldn't load your notification settings. Try again in a moment."), refetch });
    const registerSave = vi.fn();
    render(<NotificationsPageV2 canEdit registerSave={registerSave} />);
    expect(container.querySelector("[data-notification-item]")).toBeNull();
    expect(text()).toContain("Couldn't load");
    const retry = all<HTMLButtonElement>("button").find((b) => b.textContent?.trim() === "Try again")!;
    click(retry);
    expect(refetch).toHaveBeenCalled();
    expect(everRegistered(registerSave)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Routing: the old tabs open this page                                        */
/* -------------------------------------------------------------------------- */

describe("?tab=reminders and ?tab=push open Notifications at their setup", () => {
  // The shape settings/page.tsx passes (its V2_SETTINGS_PAGES, the parts routing reads).
  const pages = {
    general: { title: "General", permTab: "general" },
    fees: { title: "Tax, fees and deposit", permTab: "fees" },
    notifications: { title: "Notifications", permTab: "notifications" },
    reminders: { title: "Team emails", permTab: "reminders" },
    push: { title: "Push notifications", permTab: "push" },
    templates: { title: "Customer messages", permTab: "templates" },
  };

  it("routes each old tab to the page, scrolled to its section, under the Notifications permission", () => {
    expect(resolveV2SettingsRoute("notifications", pages)).toEqual({ page: "notifications", anchor: null, permTab: ["notifications"] });
    expect(resolveV2SettingsRoute("reminders", pages)).toEqual({ page: "notifications", anchor: "notifications-email", permTab: "notifications" });
    expect(resolveV2SettingsRoute("push", pages)).toEqual({ page: "notifications", anchor: "notifications-push", permTab: "notifications" });
    // Customer messages is not part of it.
    expect(resolveV2SettingsRoute("templates", pages)).toEqual({ page: "templates", anchor: null, permTab: "templates" });
  });

  it("the three tabs share one permission, so access is exactly what it was", () => {
    expect(SETTINGS_VALUE_TO_KEY.notifications).toBe("settings.reminders");
    expect(SETTINGS_VALUE_TO_KEY.reminders).toBe("settings.reminders");
    expect(SETTINGS_VALUE_TO_KEY.push).toBe("settings.reminders");
  });

  it("a no-access notice still names what the old link pointed at", () => {
    const notice = v2NoticePages(pages);
    expect(notice.reminders).toEqual({ title: "Email notifications", permTab: "notifications" });
    expect(notice.push).toEqual({ title: "Push notifications", permTab: "notifications" });
    expect(notice.notifications.permTab).toEqual(["notifications"]);
  });

  it("an old #settings-… link to a setup card lands on Notifications", () => {
    expect(v2SectionHomePage(settingsSectionId("notifications-email"))).toBe("notifications");
    expect(v2SectionHomePage(settingsSectionId("notifications-push"))).toBe("notifications");
  });

  it("without the page in the map (hidden), the old tabs open nothing", () => {
    const { notifications: _gone, ...rest } = pages;
    expect(resolveV2SettingsRoute("push", rest).page).toBe("push");
    expect(resolveV2SettingsRoute("notifications", rest).page).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* D18 on the row itself: a channel that nothing sends yet                     */
/* -------------------------------------------------------------------------- */

describe("a channel with no sender yet is marked on the row, not only inside the panel", () => {
  const CHANNELS = ["email", "push", "in_app"] as const;
  const marker = (key: string, channel: (typeof CHANNELS)[number]) =>
    row(key).querySelector(`[data-channel-cell="${channel}"] [data-channel-not-sent="${channel}"]`);

  it("the catalog really does have both kinds, so this suite is not vacuous", () => {
    const pairs = NOTIFICATION_CATALOG.flatMap((i) => CHANNELS.map((c) => ({ i, c, spec: channelSpec(i, c) })));
    expect(pairs.filter((p) => p.spec && p.spec.today === "not_sent").length).toBeGreaterThan(10);
    expect(pairs.filter((p) => p.spec && p.spec.today !== "not_sent").length).toBeGreaterThan(10);
  });

  /**
   * These two render the whole page (48 items × 3 channels) and then walk every
   * cell, which lands around 4s on a quiet machine and tipped past the 5s
   * default under a full parallel suite run. The timeout is generous on purpose:
   * the assertion is the point, and a flake here reads as a real regression.
   */
  const WHOLE_PAGE_WALK_MS = 20_000;

  it("exactly the channels the catalog calls not_sent carry the marker", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    for (const item of NOTIFICATION_CATALOG) {
      for (const channel of CHANNELS) {
        expect(!!marker(item.key, channel), `${item.key} / ${channel}`).toBe(isNotSentYet(item, channel));
      }
    }
  }, WHOLE_PAGE_WALK_MS);

  it("the marker reads 'Not sent yet' and carries its explanation for a screen reader", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const pushMarker = marker(NEW_BOOKING.key, "push")!;
    expect(pushMarker).not.toBeNull();
    expect(pushMarker.textContent).toContain(COPY.notSentYet);
    expect(COPY.notSentYet).toBe("Not sent yet");
    // The hover tooltip's words are also in the DOM, so the marker is not a
    // mouse-only explanation.
    expect(pushMarker.textContent).toContain(notSentYetCopy("push"));
    expect(notSentYetCopy("push")).toContain("No push notification is sent for this yet");
    expect(notSentYetCopy("push")).toContain("saved");
  });

  it("never marks a channel the item doesn't have: that stays a dash", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    // Driver invite is email only.
    expect(channelSpec(DRIVER_INVITE, "push")).toBeUndefined();
    expect(marker(DRIVER_INVITE.key, "push")).toBeNull();
    expect(row(DRIVER_INVITE.key).querySelector('[data-channel-cell="push"] [data-channel-na]')).not.toBeNull();
    // A dash and a marker are never both in one cell.
    for (const item of NOTIFICATION_CATALOG) {
      for (const channel of CHANNELS) {
        const cell = row(item.key).querySelector(`[data-channel-cell="${channel}"]`)!;
        const both = !!cell.querySelector("[data-channel-na]") && !!cell.querySelector("[data-channel-not-sent]");
        expect(both, `${item.key} / ${channel}`).toBe(false);
      }
    }
  }, WHOLE_PAGE_WALK_MS);

  it("the row's marker and the panel's Today line say the same thing about the same channel", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(marker(NEW_BOOKING.key, "push")).not.toBeNull();
    openItem(NEW_BOOKING.key);
    selectTab("push");
    expect(panel()!.querySelector('[data-today="not_sent"]')?.textContent).toContain(TODAY_COPY.not_sent);
  });

  it("the marker is there for a view-only user too: it describes sending, not permission", () => {
    render(<NotificationsPageV2 canEdit={false} registerSave={vi.fn()} />);
    expect(marker(NEW_BOOKING.key, "push")).not.toBeNull();
  });

  it("a stored row that switches the channel on does not remove the marker", () => {
    resetSettings({
      rows: [
        {
          tenant_id: "t1",
          notification_key: NEW_BOOKING.key,
          channel: "push",
          enabled: true,
          subject: null,
          title: null,
          body: null,
          push_options: {},
        },
      ],
    });
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    expect(channelSwitch(NEW_BOOKING.key, "push")!.getAttribute("aria-checked")).toBe("true");
    expect(marker(NEW_BOOKING.key, "push")).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Copy an operator reads on a dash and on the Open in app option              */
/* -------------------------------------------------------------------------- */

describe("the words on a channel an item doesn't have", () => {
  it("are a grammatical sentence for every item and channel", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const channel of ["email", "push", "in_app"] as const) {
        const copy = notApplicableCopy(item, channel);
        expect(copy.startsWith(item.name), copy).toBe(true);
        expect(copy.endsWith(".")).toBe(true);
        // The old wording produced "has no a push notification".
        expect(copy).not.toMatch(/\bno an? \b/);
        expect(copy).not.toMatch(/\ba an?\b/);
      }
    }
  });

  it("names the channel the dash stands for", () => {
    expect(notApplicableCopy(DRIVER_INVITE, "push")).toBe(`${DRIVER_INVITE.name} is never sent as a push notification.`);
    expect(notApplicableCopy(DRIVER_INVITE, "in_app")).toBe(`${DRIVER_INVITE.name} is never sent as an in-app message.`);
    expect(notApplicableCopy(NEW_BOOKING, "email")).toBe(`${NEW_BOOKING.name} is never sent as an email.`);
  });
});

describe("Open in app says on the option that it only reaches test sends", () => {
  const openInApp = () => PUSH_OPTION_COPY.find((o) => o.key === "openInApp")!;

  it("is the only option that needs the caveat", () => {
    expect(openInApp().note).toBeTruthy();
    expect(PUSH_OPTION_COPY.filter((o) => o.note)).toHaveLength(1);
    expect(openInApp().note).toMatch(/test/i);
  });

  it("is rendered beside the toggle, and described to it", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("push");
    const p = panel()!;
    const note = p.querySelector('[data-push-option-note="openInApp"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe(openInApp().note);

    // The note sits in the same help text the switch points at with
    // aria-describedby, so it is read out with the option.
    const toggle = document.getElementById(
      Array.from(p.querySelectorAll("label")).find((l) => l.textContent === openInApp().label)!.htmlFor,
    )!;
    const describedBy = toggle.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.contains(note)).toBe(true);
  });

  it("no other display option carries one", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("push");
    expect(panel()!.querySelectorAll("[data-push-option-note]")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Layout: where the controls sit, and the two halves of an open item          */
/* -------------------------------------------------------------------------- */

/**
 * The kit's own end-aligned row grid (control at the END of the row), taken by
 * rendering the kit rather than written out here: these assertions follow the
 * kit if the kit changes, and fail the day a row on this page goes back to the
 * default, which puts the control against a fixed 420px label column with the
 * right half of the panel empty.
 */
function kitRowGrid(align: "start" | "end"): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const reference = createRoot(host);
  act(() =>
    reference.render(
      <SettingsRowAlignProvider align={align}>
        <SettingsRow label="Reference row" description="Reference help">
          <input data-reference-control="" />
        </SettingsRow>
      </SettingsRowAlignProvider>,
    ),
  );
  const className = (host.querySelector("[data-reference-control]")!.parentElement!.parentElement as HTMLElement).className;
  act(() => reference.unmount());
  host.remove();
  return className;
}

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("where the controls sit", () => {
  it("the In-app rows use the kit's end-aligned row, like every other panel on this page", () => {
    const end = kitRowGrid("end");
    const start = kitRowGrid("start");
    expect(end).not.toBe(start);
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const rows = Array.from(one('[data-settings-section="in-app"]').querySelectorAll("p"))
      .filter((p) => p.textContent === "Your team" || p.textContent === "Customers")
      .map((p) => p.parentElement!.parentElement as HTMLElement);
    expect(rows).toHaveLength(2);
    for (const grid of rows) expect(grid.className).toBe(end);
  });

  it("an item's three channel switches are the last thing in its row, in one column each", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    const r = row(NEW_BOOKING.key);
    const cells = r.querySelector("[data-channel-cells]")!;
    expect(Array.from(cells.querySelectorAll("[data-channel-cell]")).map((c) => c.getAttribute("data-channel-cell"))).toEqual([
      "email",
      "push",
      "in_app",
    ]);
    // Last in the row, after the name and its plain-English line.
    expect(cells.parentElement!.lastElementChild).toBe(cells);
    expect(before(r.querySelector("[data-direction-chip]")!, cells)).toBe(true);
  });

  it("the switches line up: a cell carrying the Not sent yet marker must not lift its switch", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    // A row where one channel carries the marker and another does not: centring
    // the cells makes the taller one's switch sit above the others.
    const marked = all("[data-notification-item]").find((r) => {
      const cells = Array.from(r.querySelectorAll("[data-channel-cell]"));
      const withSwitch = cells.filter((c) => c.querySelector('[role="switch"]'));
      return withSwitch.some((c) => c.querySelector("[data-channel-not-sent]")) &&
        withSwitch.some((c) => !c.querySelector("[data-channel-not-sent]"));
    });
    expect(marked, "no row mixes a marked and an unmarked channel").toBeTruthy();
    const cells = marked!.querySelector("[data-channel-cells]") as HTMLElement;
    expect(cells.className.split(/\s+/)).toContain("md:items-start");
    // The switch is the first thing in its cell; the marker sits under it.
    for (const cell of Array.from(cells.querySelectorAll("[data-channel-cell]"))) {
      const control = cell.querySelector('[role="switch"], [data-channel-na]');
      if (!control) continue;
      const marker = cell.querySelector("[data-channel-not-sent]");
      if (marker) expect(before(control, marker)).toBe(true);
    }
  });
});

describe("the open item reads as the lead drew it", () => {
  const halves = () => ({
    test: panel()!.querySelector("[data-channel-test]") as HTMLElement,
    fields: panel()!.querySelector("[data-channel-fields]") as HTMLElement,
    preview: panel()!.querySelector("[data-channel-preview]") as HTMLElement,
  });

  it("email: the template on the left, the preview on the right, Send test at the top right", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    const { test, fields, preview } = halves();
    // Send test opens the box, above both halves.
    const trigger = Array.from(test.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Send test",
    )!;
    expect(trigger).toBeTruthy();
    expect(before(test, fields)).toBe(true);
    expect(before(fields, preview)).toBe(true);
    // The editable template is the left half; the rendered email is the right.
    expect(fields.contains(field(COPY.subject, panel()!))).toBe(true);
    expect(fields.querySelector("[data-editor-stub]")).not.toBeNull();
    expect(preview.querySelector("iframe")).not.toBeNull();
    expect(preview.contains(trigger)).toBe(false);
    expect(fields.contains(trigger)).toBe(false);
    // Each half says which it is.
    expect(fields.textContent).toContain(COPY.templateColumn);
    expect(preview.textContent).toContain(COPY.previewColumn);
  });

  it("push: the same three places", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("push");
    const { test, fields, preview } = halves();
    expect(test.querySelector('[data-send-test="push"]')).not.toBeNull();
    expect(before(test, fields)).toBe(true);
    expect(before(fields, preview)).toBe(true);
    expect(fields.contains(field(COPY.title, panel()!))).toBe(true);
    expect(preview.querySelector("[data-push-mockup]")).not.toBeNull();
  });

  it("in-app has no test, so the reason stands where Send test does", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    selectTab("in_app");
    const { test, fields, preview } = halves();
    expect(panel()!.querySelector("[data-send-test]")).toBeNull();
    expect(test.querySelector("[data-inapp-no-test]")?.textContent).toBe(COPY.inAppNoTest);
    expect(before(test, fields)).toBe(true);
    expect(before(fields, preview)).toBe(true);
    expect(preview.querySelector('[data-inapp-mockup="team"]')).not.toBeNull();
  });

  it("the Today line opens the box, beside Send test and above both halves", () => {
    render(<NotificationsPageV2 canEdit registerSave={vi.fn()} />);
    openItem(NEW_BOOKING.key);
    const today = panel()!.querySelector("[data-today]")!;
    const { test, fields } = halves();
    expect(before(today, test)).toBe(true);
    expect(before(today, fields)).toBe(true);
    expect(today.textContent).toContain(TODAY_COPY[channelSpec(NEW_BOOKING, "email")!.today]);
  });
});
