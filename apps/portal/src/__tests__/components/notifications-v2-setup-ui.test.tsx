/**
 * Notifications v2: the "Email" setup card (email-sender-settings-v2.tsx) and
 * the Send test box (send-test-box.tsx).
 *
 * The data hooks are mocked (they are tested with the hooks); settings-model
 * and message-rules are the real pure rules, so the sender validation and the
 * "Customers see:" preview here are exactly what the page runs. Expected copy
 * comes from the exported constants, the rules themselves, or is behaviour
 * (a call, a disabled control, a result kind).
 *
 * HARNESS: `react-dom/client` + `act`, as in settings-section-states.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  tenant: { value: { id: "t1", slug: "northwind", company_name: "Northwind Rentals" } as any },
  sender: {} as any,
  prefs: {} as any,
  sendTest: null as any,
}));

vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant.value }) }));
vi.mock("@/hooks/use-email-sender-v2", () => ({
  EMAIL_SENDER_NAME_MAX: 100,
  useEmailSenderV2: () => h.sender,
}));
vi.mock("@/hooks/use-email-notification-prefs", () => ({
  useEmailNotificationPrefs: () => h.prefs,
}));
vi.mock("@/hooks/use-notification-test-v2", () => ({
  useNotificationTestV2: () => ({ sendTest: h.sendTest, isSending: false }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));

import {
  EMAIL_SENDER_SAVE_KEY,
  EMAIL_SENDER_STORAGE_OFF_COPY,
  EmailSenderSettingsV2,
  SENDER_FIELD_WIDTH,
  normaliseLocalInput,
  senderFieldProblems,
  senderSettingsFromDraft,
} from "@/components/settings-v2/notifications-v2/email-sender-settings-v2";
import {
  SEND_TEST_COPY,
  SendTestBox,
  buildTestRequest,
  sendTestResult,
} from "@/components/settings-v2/notifications-v2/send-test-box";
import { isValidLocalPart } from "@/lib/notifications-v2/settings-model";
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

function field(label: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const hit = labels.find((l) => l.textContent?.trim() === label);
  if (!hit) throw new Error(`No label "${label}" in: ${labels.map((l) => l.textContent?.trim()).join(" | ")}`);
  const input = document.getElementById(hit.htmlFor) as HTMLInputElement | null;
  if (!input) throw new Error(`Label "${label}" points at nothing`);
  return input;
}

function buttonByText(name: string): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll("button"));
  const hit = all.find((b) => b.textContent?.trim() === name);
  if (!hit) throw new Error(`No button "${name}" in: ${all.map((b) => b.textContent?.trim()).join(" | ")}`);
  return hit;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function key(el: HTMLElement, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

async function clickAsync(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

/** Disabled by its own attribute or by a disabled fieldset around it (how the kit's read-only works). */
const isDisabled = (el: HTMLElement) => el.matches(":disabled");

const preview = () => container.querySelector("[data-sender-preview]")?.textContent ?? "";
const teamSwitch = () => container.querySelector('[role="switch"][aria-label="Team alert emails"]') as HTMLButtonElement;

/** The latest registration for the card's key: [save|null, discard?]. */
function registration(registerSave: ReturnType<typeof vi.fn>) {
  const calls = registerSave.mock.calls.filter((c) => c[0] === EMAIL_SENDER_SAVE_KEY);
  const last = calls[calls.length - 1];
  return { save: (last?.[1] ?? null) as null | (() => Promise<unknown>), discard: last?.[2] as undefined | (() => void) };
}

function resetSender(overrides: Record<string, unknown> = {}) {
  h.sender = {
    sender: { from_name: null, from_local_part: null, reply_to: null },
    isLoading: false,
    error: null,
    tableMissing: false,
    refetch: vi.fn(),
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

function resetPrefs(overrides: Record<string, unknown> = {}) {
  h.prefs = {
    prefs: { masterEnabled: false, recipientEmail: "", contactEmail: "office@northwind.test", categories: {} },
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    setMasterEnabled: { mutateAsync: vi.fn(async () => undefined) },
    setRecipientEmail: { mutateAsync: vi.fn(async () => undefined) },
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.tenant.value = { id: "t1", slug: "northwind", company_name: "Northwind Rentals" };
  h.sendTest = vi.fn(async () => ({ success: true, sent: 1, message: "Sent to jo@northwind.test." }));
  resetSender();
  resetPrefs();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* -------------------------------------------------------------------------- */
/* Sender rules                                                                */
/* -------------------------------------------------------------------------- */

describe("sender rules", () => {
  const draft = (patch: Partial<{ name: string; local: string; replyTo: string }> = {}) => ({
    name: "",
    local: "northwind",
    replyTo: "",
    ...patch,
  });

  it("the part before the @ follows isValidLocalPart for this slug", () => {
    expect(senderFieldProblems(draft(), "northwind").local).toBeNull();
    expect(senderFieldProblems(draft({ local: "northwind.bookings" }), "northwind").local).toBeNull();
    for (const bad of ["coastline", "", "northwind.", "nor thwind", "northwind-cars"]) {
      const expected = isValidLocalPart(bad, "northwind");
      expect(expected.ok).toBe(false);
      expect(senderFieldProblems(draft({ local: bad }), "northwind").local).toBe(expected.reason);
    }
  });

  it("reply-to is optional, must be an address, and can't be one of this company's send-only addresses", () => {
    expect(senderFieldProblems(draft(), "northwind").replyTo).toBeNull();
    expect(senderFieldProblems(draft({ replyTo: "help@northwind.test" }), "northwind").replyTo).toBeNull();
    expect(senderFieldProblems(draft({ replyTo: "not an address" }), "northwind").replyTo).toBeTruthy();
    expect(senderFieldProblems(draft({ replyTo: "northwind.bookings@drive-247.com" }), "northwind").replyTo).toBeTruthy();
    // Another drive-247 inbox (support) is a real inbox, not this company's sender.
    expect(senderFieldProblems(draft({ replyTo: "support@drive-247.com" }), "northwind").replyTo).toBeNull();
  });

  it("the name may be empty (company name), but not too long or with <, > or quotes", () => {
    expect(senderFieldProblems(draft(), "northwind").name).toBeNull();
    expect(senderFieldProblems(draft({ name: "Northwind Cars" }), "northwind").name).toBeNull();
    expect(senderFieldProblems(draft({ name: "x".repeat(101) }), "northwind").name).toBeTruthy();
    expect(senderFieldProblems(draft({ name: 'The "Best" Cars' }), "northwind").name).toBeTruthy();
  });

  it("stores NULL for defaults: blanks, and the slug itself", () => {
    expect(senderSettingsFromDraft(draft({ name: "  " }), "northwind")).toEqual({
      from_name: null,
      from_local_part: null,
      reply_to: null,
    });
    expect(
      senderSettingsFromDraft({ name: " Coastline ", local: "northwind.help", replyTo: " a@b.co " }, "northwind"),
    ).toEqual({ from_name: "Coastline", from_local_part: "northwind.help", reply_to: "a@b.co" });
  });

  it("the Send from box lowercases and drops a pasted @drive-247.com", () => {
    expect(normaliseLocalInput("Northwind.Bookings@drive-247.com")).toBe("northwind.bookings");
    expect(normaliseLocalInput("north wind")).toBe("northwind");
  });
});

/* -------------------------------------------------------------------------- */
/* EmailSenderSettingsV2                                                       */
/* -------------------------------------------------------------------------- */

describe("EmailSenderSettingsV2", () => {
  it("every field in the panel is the same width, and the send-from box shares it with the domain", () => {
    // The three plain fields and the "Send from" pair used to measure
    // differently, so their edges did not line up and the local-part box was
    // far too wide for a short account name.
    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    const byId = (suffix: string) => document.querySelector(`[id$="${suffix}"]`) as HTMLElement;
    const name = byId("-name");
    const replyTo = byId("-reply");
    const recipient = byId("-recipient");
    const local = byId("-local");
    for (const field of [name, replyTo, recipient]) {
      expect(field).not.toBeNull();
      expect(field.className).toContain(SENDER_FIELD_WIDTH.split(" ")[0]);
    }
    // The pair: the group carries the shared width, the box takes what the
    // fixed domain leaves, so the row ends level with the fields above it.
    const group = local.parentElement!;
    expect(group.className).toContain(SENDER_FIELD_WIDTH.split(" ")[0]);
    expect(group.textContent).toContain("@drive-247.com");
    expect(local.className).toContain("flex-1");
    expect(local.className).not.toContain("w-48");
  });

  it("shows today's default in the preview, then follows the fields as they are typed", () => {
    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    expect(preview()).toContain("Customers see: Northwind Rentals <northwind@drive-247.com>");
    expect(field("Sender name").placeholder).toBe("Northwind Rentals");
    expect(field("Send from").value).toBe("northwind");
    expect(text()).toContain("Must start with northwind, on its own or followed by a dot or an underscore");

    typeInto(field("Sender name"), "Northwind Bookings");
    typeInto(field("Send from"), "northwind.bookings");
    typeInto(field("Replies go to"), "help@northwind.test");
    expect(preview()).toContain("Customers see: Northwind Bookings <northwind.bookings@drive-247.com>");
    expect(preview()).toContain("help@northwind.test");
  });

  it("an address that doesn't start with the slug shows the reason and blocks Save", async () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    const local = field("Send from");
    typeInto(local, "coastline");
    blur(local);

    const reason = isValidLocalPart("coastline", "northwind").reason!;
    expect(text()).toContain(reason);
    expect(local.getAttribute("aria-invalid")).toBe("true");

    const { save } = registration(registerSave);
    expect(save).toBeTypeOf("function");
    await act(async () => {
      await expect(save!()).rejects.toThrow(reason);
    });
    expect(h.sender.save).not.toHaveBeenCalled();
  });

  it("registers with the page only while dirty; Save stores the fields, Reset puts them back", async () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    expect(registration(registerSave).save).toBeNull();

    typeInto(field("Sender name"), "Coastline Cars");
    typeInto(field("Send from"), "northwind.help");
    typeInto(field("Replies go to"), "desk@northwind.test");
    const { save, discard } = registration(registerSave);
    expect(save).toBeTypeOf("function");
    expect(discard).toBeTypeOf("function");

    await act(async () => {
      await save!();
    });
    expect(h.sender.save).toHaveBeenCalledWith({
      from_name: "Coastline Cars",
      from_local_part: "northwind.help",
      reply_to: "desk@northwind.test",
    });
    // Saved: no longer dirty, and the fields keep what was saved.
    expect(registration(registerSave).save).toBeNull();
    expect(field("Sender name").value).toBe("Coastline Cars");

    typeInto(field("Sender name"), "Something else");
    expect(registration(registerSave).save).toBeTypeOf("function");
    act(() => registration(registerSave).discard!());
    expect(field("Sender name").value).toBe("Coastline Cars");
    expect(registration(registerSave).save).toBeNull();
  });

  it("typing the stored value back is not a change", () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    typeInto(field("Send from"), "northwind.x");
    expect(registration(registerSave).save).toBeTypeOf("function");
    typeInto(field("Send from"), "northwind");
    expect(registration(registerSave).save).toBeNull();
  });

  it("a failed write rejects the page's save and shows the reason inline", async () => {
    h.sender.save = vi.fn(async () => {
      throw new Error("Couldn't save your email sender. Try again in a moment.");
    });
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    typeInto(field("Sender name"), "Coastline Cars");

    let failure: unknown = null;
    await act(async () => {
      await registration(registerSave).save!().catch((e) => {
        failure = e;
      });
    });
    expect(failure).toBeInstanceOf(Error);
    expect(text()).toContain("Couldn't save your email sender");
    // Still dirty, still registered, the typed value kept.
    expect(registration(registerSave).save).toBeTypeOf("function");
    expect(field("Sender name").value).toBe("Coastline Cars");
  });

  it("the team switch and recipient save through the page save with the existing mutations", async () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    expect(teamSwitch().getAttribute("aria-checked")).toBe("false");

    await clickAsync(teamSwitch());
    typeInto(field("Team alerts go to"), "  ops@northwind.test ");
    expect(h.prefs.setMasterEnabled.mutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      await registration(registerSave).save!();
    });
    expect(h.prefs.setMasterEnabled.mutateAsync).toHaveBeenCalledWith(true);
    expect(h.prefs.setRecipientEmail.mutateAsync).toHaveBeenCalledWith("ops@northwind.test");
    expect(h.sender.save).not.toHaveBeenCalled();
  });

  it("an invalid team recipient blocks Save and writes nothing", async () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);
    typeInto(field("Team alerts go to"), "abc");
    await act(async () => {
      await expect(registration(registerSave).save!()).rejects.toThrow();
    });
    expect(text()).toContain("Enter a valid email address");
    expect(h.prefs.setRecipientEmail.mutateAsync).not.toHaveBeenCalled();
  });

  it("storage off: sender fields are read-only with one line why; the team rows still work", () => {
    resetSender({ tableMissing: true, sender: { from_name: null, from_local_part: null, reply_to: null } });
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit registerSave={registerSave} />);

    expect(text()).toContain(EMAIL_SENDER_STORAGE_OFF_COPY);
    expect(isDisabled(field("Sender name"))).toBe(true);
    expect(isDisabled(field("Send from"))).toBe(true);
    expect(isDisabled(field("Replies go to"))).toBe(true);
    expect(preview()).toContain("Northwind Rentals <northwind@drive-247.com>");

    expect(isDisabled(field("Team alerts go to"))).toBe(false);
    expect(isDisabled(teamSwitch())).toBe(false);
  });

  it("view only: nothing is editable and nothing registers a save", () => {
    const registerSave = vi.fn();
    render(<EmailSenderSettingsV2 canEdit={false} registerSave={registerSave} />);
    expect(isDisabled(field("Sender name"))).toBe(true);
    expect(isDisabled(field("Team alerts go to"))).toBe(true);
    expect(registerSave.mock.calls.some((c) => typeof c[1] === "function")).toBe(false);
  });

  it("loading shows a skeleton, not default values", () => {
    resetSender({ sender: null, isLoading: true });
    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("a failed sender read offers a retry instead of the fields", async () => {
    resetSender({ sender: null, error: new Error("boom") });
    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    expect(container.querySelector('[data-settings-state="error"]')).not.toBeNull();
    expect(container.querySelector("[data-sender-preview]")).toBeNull();
    await clickAsync(buttonByText("Try again"));
    expect(h.sender.refetch).toHaveBeenCalled();
    // The team rows are unaffected.
    expect(field("Team alerts go to")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Send test                                                                   */
/* -------------------------------------------------------------------------- */

describe("sendTestResult / buildTestRequest", () => {
  it("prefers the server's sentence and sorts replies into sent / none / error", () => {
    expect(sendTestResult({ success: true, sent: 1, message: "Sent to jo@x.co." }, "email", "jo@x.co")).toEqual({
      kind: "sent",
      message: "Sent to jo@x.co.",
    });
    expect(sendTestResult({ success: true, sent: 1 }, "email", "jo@x.co").message).toContain("jo@x.co");
    expect(sendTestResult({ success: true, sent: 2 }, "push")).toEqual({ kind: "sent", message: "Sent to 2 of your devices." });
    expect(sendTestResult({ success: false, code: "no_devices", message: "No devices." }, "push")).toEqual({
      kind: "none",
      message: "No devices.",
    });
    expect(sendTestResult({ success: false, error: "Limit reached." }, "email")).toEqual({
      kind: "error",
      message: "Limit reached.",
    });
    expect(sendTestResult(null, "email").kind).toBe("error");
  });

  it("adds the recipient to an email test and never to a push test", () => {
    expect(
      buildTestRequest({ channel: "email", notificationKey: "x", subject: "S", bodyHtml: "<p>B</p>" }, "email", "booking_confirmed", "a@b.co"),
    ).toEqual({ channel: "email", notificationKey: "booking_confirmed", to: "a@b.co", subject: "S", bodyHtml: "<p>B</p>" });

    const push = buildTestRequest(
      { channel: "push", notificationKey: "booking_confirmed", title: "T", body: "B", url: "/rentals/1", pushOptions: { silent: true } },
      "push",
      "booking_confirmed",
      "",
    );
    expect(push).toEqual({
      channel: "push",
      notificationKey: "booking_confirmed",
      title: "T",
      body: "B",
      url: "/rentals/1",
      pushOptions: { silent: true },
    });
    expect("to" in push).toBe(false);
  });
});

describe("SendTestBox", () => {
  const emailDraft = () => ({
    channel: "email" as const,
    notificationKey: "booking_confirmed",
    subject: "Your booking is confirmed",
    bodyHtml: "<p>Hi Alex</p>",
  });
  const resultEl = () => container.querySelector("[data-send-test-result]") as HTMLElement | null;

  it("opens a box underneath with the operator's email filled in and focused", () => {
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    expect(container.querySelector("input")).toBeNull();

    const trigger = buttonByText(SEND_TEST_COPY.button);
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const input = field(SEND_TEST_COPY.emailLabel);
    expect(input.value).toBe("jo@northwind.test");
    expect(document.activeElement).toBe(input);
    expect(resultEl()?.getAttribute("aria-live")).toBe("polite");
  });

  it("checks the address before sending", async () => {
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    const input = field(SEND_TEST_COPY.emailLabel);

    typeInto(input, "not-an-address");
    await clickAsync(buttonByText(SEND_TEST_COPY.send));
    expect(text()).toContain(SEND_TEST_COPY.emailInvalid);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    typeInto(input, "");
    await clickAsync(buttonByText(SEND_TEST_COPY.send));
    expect(text()).toContain(SEND_TEST_COPY.emailMissing);
    expect(h.sendTest).not.toHaveBeenCalled();
  });

  it("sends the page's message to the typed address and shows the server's success line", async () => {
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    typeInto(field(SEND_TEST_COPY.emailLabel), " sam@northwind.test ");
    await clickAsync(buttonByText(SEND_TEST_COPY.send));

    expect(h.sendTest).toHaveBeenCalledTimes(1);
    expect(h.sendTest).toHaveBeenCalledWith({
      channel: "email",
      notificationKey: "booking_confirmed",
      to: "sam@northwind.test",
      subject: "Your booking is confirmed",
      bodyHtml: "<p>Hi Alex</p>",
    });
    expect(resultEl()?.getAttribute("data-send-test-result")).toBe("sent");
    expect(resultEl()?.textContent).toContain("Sent to jo@northwind.test.");
    expect(buttonByText(SEND_TEST_COPY.close)).toBeTruthy();
  });

  it("Enter in the address field sends", async () => {
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    await act(async () => {
      field(SEND_TEST_COPY.emailLabel).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(h.sendTest).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when the test fails", async () => {
    h.sendTest = vi.fn(async () => ({ success: false, error: "You've sent 20 tests this hour. Try again later." }));
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    await clickAsync(buttonByText(SEND_TEST_COPY.send));
    expect(resultEl()?.getAttribute("data-send-test-result")).toBe("error");
    expect(resultEl()?.textContent).toContain(SEND_TEST_COPY.failedLead);
    expect(resultEl()?.textContent).toContain("You've sent 20 tests this hour.");
  });

  it("a message the page can't build is explained and nothing is sent", async () => {
    const buildRequest = () => {
      throw new Error("Add a subject.");
    };
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={buildRequest} defaultEmail="jo@northwind.test" canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    await clickAsync(buttonByText(SEND_TEST_COPY.send));
    expect(h.sendTest).not.toHaveBeenCalled();
    expect(resultEl()?.textContent).toContain("Add a subject.");
  });

  it("push: says where it goes, sends without a recipient, and reports no devices", async () => {
    h.sendTest = vi.fn(async () => ({ success: false, code: "no_devices", message: "None of your devices have push on." }));
    const pushDraft = () => ({ channel: "push" as const, notificationKey: "booking_confirmed", title: "Booked", body: "Alex booked" });
    render(<SendTestBox channel="push" notificationKey="booking_confirmed" buildRequest={pushDraft} canSend />);
    act(() => buttonByText(SEND_TEST_COPY.button).click());
    expect(text()).toContain(SEND_TEST_COPY.pushHint);
    expect(container.querySelector("input")).toBeNull();

    await clickAsync(buttonByText(SEND_TEST_COPY.send));
    expect(h.sendTest).toHaveBeenCalledWith({ channel: "push", notificationKey: "booking_confirmed", title: "Booked", body: "Alex booked" });
    expect(resultEl()?.getAttribute("data-send-test-result")).toBe("none");
    expect(resultEl()?.textContent).toContain("None of your devices have push on.");
  });

  it("can't send: the button is disabled and says why", () => {
    render(
      <SendTestBox
        channel="email"
        notificationKey="booking_confirmed"
        buildRequest={emailDraft}
        defaultEmail="jo@northwind.test"
        canSend={false}
        disabledReason="Fix the subject first."
      />,
    );
    expect(buttonByText(SEND_TEST_COPY.button).disabled).toBe(true);
    expect(text()).toContain("Fix the subject first.");
  });

  it("Escape closes the box and puts focus back on Send test", () => {
    render(<SendTestBox channel="email" notificationKey="booking_confirmed" buildRequest={emailDraft} defaultEmail="jo@northwind.test" canSend />);
    const trigger = buttonByText(SEND_TEST_COPY.button);
    act(() => trigger.click());
    key(field(SEND_TEST_COPY.emailLabel), "Escape");
    expect(container.querySelector("input")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});

/* -------------------------------------------------------------------------- */
/* Where the controls sit                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The house style for a v2 settings panel: the label and its help take the
 * left, the CONTROL sits at the END of the row. Asserted by rendering, against
 * the kit's own end-aligned row rather than a class string written out here —
 * so this follows the kit if the kit changes, and still fails the day a row on
 * this card goes back to the default (control against a fixed 420px label
 * column, with the whole right half of the card empty).
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
  const grid = host.querySelector("[data-reference-control]")!.parentElement!.parentElement as HTMLElement;
  const className = grid.className;
  act(() => reference.unmount());
  host.remove();
  return className;
}

/** The grid of the row whose label reads exactly `label` (label column → grid). */
function rowGrid(label: string): HTMLElement {
  const hit = Array.from(container.querySelectorAll("label, p")).find((n) => n.textContent?.trim() === label);
  if (!hit) throw new Error(`No row labelled "${label}"`);
  return hit.parentElement!.parentElement as HTMLElement;
}

describe("the Email card's layout", () => {
  const ROWS = ["Sender name", "Send from", "Replies go to", "Team alert emails", "Team alerts go to"];

  it("puts every control at the end of its row, the way the kit's end-aligned row does", () => {
    const end = kitRowGrid("end");
    const start = kitRowGrid("start");
    expect(end).not.toBe(start);

    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    for (const label of ROWS) {
      expect(rowGrid(label).className, label).toBe(end);
      expect(rowGrid(label).className, label).not.toBe(start);
    }
  });

  it("the control is the last thing in its row, after the label and its help", () => {
    render(<EmailSenderSettingsV2 canEdit registerSave={vi.fn()} />);
    const controlOf: Record<string, HTMLElement> = {
      "Sender name": field("Sender name"),
      "Send from": field("Send from"),
      "Replies go to": field("Replies go to"),
      "Team alert emails": teamSwitch(),
      "Team alerts go to": field("Team alerts go to"),
    };
    for (const label of ROWS) {
      const grid = rowGrid(label);
      expect(grid.children.length, label).toBe(2);
      expect(grid.lastElementChild!.contains(controlOf[label]), label).toBe(true);
    }
  });

  it("holds the layout when the card is read-only", () => {
    const end = kitRowGrid("end");
    render(<EmailSenderSettingsV2 canEdit={false} />);
    for (const label of ROWS) expect(rowGrid(label).className, label).toBe(end);
    expect(field("Sender name").matches(":disabled")).toBe(true);
  });
});
