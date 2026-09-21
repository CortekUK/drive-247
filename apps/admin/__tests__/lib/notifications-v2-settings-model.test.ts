import { describe, it, expect } from "vitest";
import {
  EMAIL_SUBJECT_MAX,
  IN_APP_BODY_MAX,
  IN_APP_TITLE_MAX,
  PLATFORM_EMAIL_BRAND,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  diffEdits,
  effectiveChannel,
  emptyTemplate,
  isDefaultRow,
  isValidEmail,
  isValidLocalPart,
  normalisePushOptions,
  rowFromEdit,
  senderAddress,
  settingKey,
  validateTemplate,
  type ChannelDraft,
} from "@/lib/notifications-v2/settings-model";
import { SYSTEM_NOTIFICATION_VARIABLES, unknownVariables } from "@/lib/notifications-v2/variables";
import type {
  NotificationChannel,
  PlatformNotificationSettingRow,
  SystemNotificationItem,
} from "@/lib/notifications-v2/types";

/**
 * The storage rules for the system set. The model is the portal's, with the
 * tenant taken out: platform settings are keyed by (notification_key, channel)
 * alone, so a row carries no tenant_id and the save diff has nothing to scope.
 *
 * NULL means "use the catalog default", a missing row means "all defaults", and
 * Reset is a DELETE — so the tests that matter are: what an operator sees when
 * a column is NULL, what Save writes back, and when a row is deleted rather
 * than stored.
 */

const item: SystemNotificationItem = {
  key: "operator_account_suspended",
  category: "account",
  direction: "platform_to_operator",
  name: "Account suspended",
  tooltip: "Sent to the operator's team when we suspend their account.",
  when: "When you suspend an account.",
  side: "super_admin",
  recipient: "The operator's team",
  channels: {
    email: {
      defaultEnabled: true,
      defaultTemplate: { subject: "Your account is suspended", body: "<p>Hi {{operator_name}}</p>" },
      today: "not_sent",
    },
    push: {
      defaultEnabled: false,
      defaultTemplate: { title: "Account suspended", body: "Contact Drive247." },
      today: "not_sent",
      defaultPushOptions: { requireInteraction: true },
    },
  },
  variables: ["operator_name"],
  evidence: ["apps/admin/app/admin/(protected)/rentals/[id]/page.tsx:1"],
};

/** A row with everything at its default, ready to be overridden field by field. */
function row(channel: NotificationChannel, over: Partial<PlatformNotificationSettingRow> = {}): PlatformNotificationSettingRow {
  return {
    notification_key: item.key,
    channel,
    enabled: null,
    subject: null,
    title: null,
    body: null,
    push_options: {},
    ...over,
  };
}

describe("the stored row has no tenant", () => {
  it("is keyed by notification and channel alone", () => {
    const produced = rowFromEdit(item.key, "email", { enabled: true, template: { subject: "X", body: "<p>y</p>" } }, item);
    expect(Object.keys(produced)).not.toContain("tenant_id");
    expect(produced.notification_key).toBe(item.key);
    expect(produced.channel).toBe("email");
    expect(settingKey(item.key, "email")).toBe("operator_account_suspended:email");
  });

  it("deletes by that same pair", () => {
    const saved = [row("email", { subject: "Old" })];
    const drafts: ChannelDraft[] = [
      { item, channel: "email", state: { enabled: true, template: item.channels.email!.defaultTemplate } },
    ];
    expect(diffEdits(saved, drafts).deletes).toEqual([{ notification_key: item.key, channel: "email" }]);
  });
});

describe("effectiveChannel", () => {
  it("uses every catalog default when nothing is stored", () => {
    const state = effectiveChannel(item, "email");
    expect(state.enabled).toBe(true);
    expect(state.template).toEqual(item.channels.email!.defaultTemplate);
    expect(state.customised).toBe(false);
  });

  it("lays a stored column over the default and leaves the NULLs alone", () => {
    const state = effectiveChannel(item, "email", row("email", { enabled: false, subject: "Suspended" }));
    expect(state.enabled).toBe(false);
    expect(state.template).toEqual({ subject: "Suspended", body: "<p>Hi {{operator_name}}</p>" });
    expect(state.customised).toBe(true);
  });

  it("treats a stored empty string as a real value, not as a missing one", () => {
    const state = effectiveChannel(item, "email", row("email", { subject: "" }));
    expect((state.template as { subject: string }).subject).toBe("");
    expect(state.customised).toBe(true);
  });

  it("ignores a row belonging to another notification or another channel", () => {
    const wrongKey = row("email", { notification_key: "something_else", subject: "Nope" });
    const wrongChannel = row("push", { subject: "Nope" });
    expect(effectiveChannel(item, "email", wrongKey).template).toEqual(item.channels.email!.defaultTemplate);
    expect(effectiveChannel(item, "email", wrongChannel).template).toEqual(item.channels.email!.defaultTemplate);
  });

  it("turns a channel the notification does not offer off, with an empty template", () => {
    const state = effectiveChannel(item, "in_app");
    expect(state.enabled).toBe(false);
    expect(state.template).toEqual(emptyTemplate("in_app"));
    expect(state.customised).toBe(false);
  });

  it("starts push from the catalog's display options and lets a stored one flip just that option", () => {
    expect(effectiveChannel(item, "push").pushOptions).toEqual({
      requireInteraction: true,
      silent: false,
      replacePrevious: false,
      openInApp: false,
    });
    const stored = effectiveChannel(item, "push", row("push", { push_options: { openInApp: true } }));
    expect(stored.pushOptions).toEqual({
      requireInteraction: true,
      silent: false,
      replacePrevious: false,
      openInApp: true,
    });
  });

  it("carries no push options on a channel that is not push", () => {
    expect(effectiveChannel(item, "email").pushOptions).toEqual({});
  });

  it("does not call a template customised when only line endings or tag spacing changed", () => {
    const reformatted = effectiveChannel(
      item,
      "email",
      row("email", { subject: " Your account is suspended\r\n", body: "<p>Hi {{operator_name}}</p>\n" }),
    );
    expect(reformatted.customised).toBe(false);
  });
});

describe("rowFromEdit", () => {
  it("writes NULL for everything that still equals the default", () => {
    const produced = rowFromEdit(
      item.key,
      "email",
      { enabled: true, template: item.channels.email!.defaultTemplate },
      item,
    );
    expect(produced).toEqual(row("email"));
    expect(isDefaultRow(produced)).toBe(true);
  });

  it("writes only the columns that actually changed", () => {
    const produced = rowFromEdit(
      item.key,
      "email",
      { enabled: false, template: { subject: "New subject", body: "<p>Hi {{operator_name}}</p>" } },
      item,
    );
    expect(produced.enabled).toBe(false);
    expect(produced.subject).toBe("New subject");
    expect(produced.body).toBeNull();
    expect(produced.title).toBeNull();
    expect(isDefaultRow(produced)).toBe(false);
  });

  it("stores only the push options that differ from the catalog default", () => {
    const spec = item.channels.push!;
    const same = rowFromEdit(item.key, "push", { enabled: false, template: spec.defaultTemplate, pushOptions: { requireInteraction: true } }, item);
    expect(same.push_options).toEqual({});
    expect(isDefaultRow(same)).toBe(true);

    const off = rowFromEdit(item.key, "push", { enabled: false, template: spec.defaultTemplate, pushOptions: {} }, item);
    expect(off.push_options).toEqual({ requireInteraction: false });
    expect(isDefaultRow(off)).toBe(false);
  });

  it("never stores push options off the push channel", () => {
    const produced = rowFromEdit(
      item.key,
      "email",
      { enabled: true, template: item.channels.email!.defaultTemplate, pushOptions: { silent: true } },
      item,
    );
    expect(produced.push_options).toEqual({});
  });

  it("stores nothing for a channel the notification does not offer", () => {
    const produced = rowFromEdit(item.key, "in_app", { enabled: true, template: { title: "T", body: "B" } }, item);
    expect(isDefaultRow(produced)).toBe(true);
  });
});

describe("diffEdits", () => {
  const emailDefault = item.channels.email!.defaultTemplate;

  it("upserts an edit that differs from the defaults", () => {
    const { upserts, deletes } = diffEdits([], [
      { item, channel: "email", state: { enabled: true, template: { subject: "Changed", body: emailDefault.body } } },
    ]);
    expect(deletes).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.subject).toBe("Changed");
  });

  it("deletes the saved row when the edit goes back to the defaults", () => {
    const { upserts, deletes } = diffEdits([row("email", { subject: "Changed" })], [
      { item, channel: "email", state: { enabled: true, template: emailDefault } },
    ]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([{ notification_key: item.key, channel: "email" }]);
  });

  it("writes nothing when an untouched item is at its defaults and nothing was saved", () => {
    expect(diffEdits([], [{ item, channel: "email", state: { enabled: true, template: emailDefault } }])).toEqual({
      upserts: [],
      deletes: [],
    });
  });

  it("writes nothing when the saved row already holds exactly these values", () => {
    const saved = row("email", { subject: "Changed" });
    const { upserts, deletes } = diffEdits([saved], [
      { item, channel: "email", state: { enabled: true, template: { subject: "Changed", body: emailDefault.body } } },
    ]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("leaves saved rows with no draft alone", () => {
    const saved = [row("email", { subject: "Changed" }), row("push", { title: "Also changed" })];
    const { upserts, deletes } = diffEdits(saved, [
      { item, channel: "email", state: { enabled: true, template: { subject: "Changed again", body: emailDefault.body } } },
    ]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.channel).toBe("email");
    expect(deletes).toEqual([]);
  });

  it("lets the last draft for a channel win", () => {
    const { upserts } = diffEdits([], [
      { item, channel: "email", state: { enabled: true, template: { subject: "First", body: emailDefault.body } } },
      { item, channel: "email", state: { enabled: true, template: { subject: "Second", body: emailDefault.body } } },
    ]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.subject).toBe("Second");
  });

  it("copes with nothing saved and nothing drafted", () => {
    expect(diffEdits(null, null)).toEqual({ upserts: [], deletes: [] });
  });
});

describe("normalisePushOptions", () => {
  it("turns anything but true into false, and fills in what is missing", () => {
    expect(normalisePushOptions()).toEqual({
      requireInteraction: false,
      silent: false,
      replacePrevious: false,
      openInApp: false,
    });
    expect(normalisePushOptions({ silent: true })).toEqual({
      requireInteraction: false,
      silent: true,
      replacePrevious: false,
      openInApp: false,
    });
    expect(normalisePushOptions({ openInApp: "yes" } as unknown as { openInApp?: boolean }).openInApp).toBe(false);
  });
});

describe("validateTemplate", () => {
  const allowed = ["operator_name"];

  it("accepts a good email", () => {
    const result = validateTemplate("email", { subject: "Hi {{operator_name}}", body: "<p>Text</p>" }, allowed);
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it("needs a subject on one line, within the cap", () => {
    expect(validateTemplate("email", { subject: "  ", body: "<p>x</p>" }, allowed).issues).toEqual([
      { field: "subject", message: "Add a subject." },
    ]);
    expect(validateTemplate("email", { subject: "a\nb", body: "<p>x</p>" }, allowed).messages).toContain(
      "Keep the subject on one line.",
    );
    const long = validateTemplate("email", { subject: "s".repeat(EMAIL_SUBJECT_MAX + 1), body: "<p>x</p>" }, allowed);
    expect(long.ok).toBe(false);
    expect(long.messages[0]).toContain(String(EMAIL_SUBJECT_MAX + 1));
  });

  it("needs visible text in the email body, not just markup", () => {
    expect(validateTemplate("email", { subject: "s", body: "<p></p><hr>" }, allowed).messages).toContain(
      "Add a message to the email.",
    );
    expect(validateTemplate("email", { subject: "s", body: "<p>&nbsp;</p>" }, allowed).messages).toContain(
      "Add a message to the email.",
    );
    expect(validateTemplate("email", { subject: "s", body: "<p>real</p>" }, allowed).ok).toBe(true);
  });

  it("refuses a call-to-action button that goes nowhere", () => {
    expect(validateTemplate("email", { subject: "s", body: '<p><a data-email-button>Pay</a></p>' }, allowed).messages).toContain(
      "A button has no link.",
    );
    expect(validateTemplate("email", { subject: "s", body: '<p><a data-email-button href="  ">Pay</a></p>' }, allowed).ok).toBe(
      false,
    );
    expect(
      validateTemplate("email", { subject: "s", body: '<p><a data-email-button href="https://x.com">Pay</a></p>' }, allowed).ok,
    ).toBe(true);
  });

  it("applies the push caps to push and the in-app caps to in-app", () => {
    expect(validateTemplate("push", { title: "t".repeat(PUSH_TITLE_MAX), body: "b".repeat(PUSH_BODY_MAX) }, allowed).ok).toBe(
      true,
    );
    expect(
      validateTemplate("push", { title: "t".repeat(PUSH_TITLE_MAX + 1), body: "" }, allowed).issues[0]?.field,
    ).toBe("title");
    expect(validateTemplate("push", { title: "t", body: "b".repeat(PUSH_BODY_MAX + 1) }, allowed).ok).toBe(false);
    expect(
      validateTemplate("in_app", { title: "t".repeat(IN_APP_TITLE_MAX), body: "b".repeat(IN_APP_BODY_MAX) }, allowed).ok,
    ).toBe(true);
    // in-app allows a longer message than push does.
    expect(validateTemplate("in_app", { title: "t", body: "b".repeat(PUSH_BODY_MAX + 1) }, allowed).ok).toBe(true);
  });

  it("needs a title but not a message on push and in-app", () => {
    expect(validateTemplate("push", { title: "", body: "some text" }, allowed).messages).toEqual(["Add a title."]);
    expect(validateTemplate("push", { title: "Here", body: "" }, allowed).ok).toBe(true);
  });

  it("names every variable the notification cannot use, once each", () => {
    const result = validateTemplate(
      "email",
      { subject: "{{operator_name}} {{nope}}", body: "<p>{{nope}} {{Operator_Name}}</p>" },
      allowed,
    );
    expect(result.ok).toBe(false);
    expect(result.unknownVariables).toEqual(["nope", "Operator_Name"]);
    expect(result.messages).toContain("{{nope}} isn't a variable this notification can use.");
  });

  it("copes with a missing template", () => {
    expect(validateTemplate("email", null, allowed).ok).toBe(false);
    expect(validateTemplate("push", undefined, allowed).messages).toEqual(["Add a title."]);
  });

  it("reads {{keys}} exactly as variables.ts does, so the page and Save cannot disagree", () => {
    const text = "{{a}} {{a}} {{b_2}} {{ c }} {{d-e}} {{}}";
    const scanned = unknownVariables(text, ["a"]);
    const validated = validateTemplate("push", { title: text, body: "" }, ["a"]).unknownVariables;
    expect(validated).toEqual(scanned);
    // Spaces inside the braces, dashes and an empty key are not variables at all.
    expect(scanned).toEqual(["b_2"]);
  });

  it("accepts a real variable from the system catalog and rejects one that is not in it", () => {
    const real = SYSTEM_NOTIFICATION_VARIABLES[0]!.key;
    const allowedReal = SYSTEM_NOTIFICATION_VARIABLES.map((v) => v.key);
    expect(validateTemplate("push", { title: `Hi {{${real}}}`, body: "" }, allowedReal).ok).toBe(true);
    expect(
      validateTemplate("push", { title: "Hi {{not_a_real_variable}}", body: "" }, allowedReal).unknownVariables,
    ).toEqual(["not_a_real_variable"]);
  });
});

describe("the platform sender", () => {
  it("defaults to the address platform email actually comes from today", () => {
    const sender = senderAddress();
    expect(sender.address).toBe("noreply@drive-247.com");
    expect(sender.name).toBe("Drive 247");
    expect(sender.display).toBe("Drive 247 <noreply@drive-247.com>");
    expect(sender.replyTo).toBeNull();
    expect(sender.usesDefault).toBe(true);
  });

  it("uses a saved name, local part and reply-to when they are usable", () => {
    const sender = senderAddress({ from_name: "Drive247 Support", from_local_part: "support", reply_to: "ops@drive-247.com" });
    expect(sender.address).toBe("support@drive-247.com");
    expect(sender.display).toBe("Drive247 Support <support@drive-247.com>");
    expect(sender.replyTo).toBe("ops@drive-247.com");
    expect(sender.usesDefault).toBe(false);
  });

  it("falls back rather than sending from a broken address", () => {
    const sender = senderAddress({ from_name: null, from_local_part: "Not Valid!", reply_to: "not-an-email" });
    expect(sender.address).toBe("noreply@drive-247.com");
    expect(sender.replyTo).toBeNull();
  });

  it("keeps a display name out of the From header's structure", () => {
    const sender = senderAddress({ from_name: 'Drive 247, "Ops" <x>\nBcc: a@b.com', from_local_part: null, reply_to: null });
    expect(sender.name).not.toContain("<");
    expect(sender.name).not.toContain('"');
    expect(sender.name).not.toContain("\n");
    // A comma is legal in a display name but only when quoted.
    expect(sender.header.startsWith('"')).toBe(true);
    expect(sender.header.endsWith(" <noreply@drive-247.com>")).toBe(true);
  });
});

describe("isValidLocalPart", () => {
  it("accepts plain platform addresses", () => {
    for (const good of ["noreply", "support", "billing.alerts", "ops_team", "a1", "no-reply"]) {
      expect(isValidLocalPart(good), good).toEqual({ ok: true, reason: null });
    }
  });

  it("does NOT require a tenant slug prefix, because there is no tenant here", () => {
    // The portal's twin rejects this unless it starts with the tenant's slug.
    expect(isValidLocalPart("anything").ok).toBe(true);
  });

  it("explains, in plain words, each way it can be wrong", () => {
    for (const bad of ["", "   ", "Support", "a".repeat(65), "with space", "with@at", ".leading", "-leading", "a..b", "a."]) {
      const check = isValidLocalPart(bad);
      expect(check.ok, bad).toBe(false);
      expect(typeof check.reason, bad).toBe("string");
      expect(check.reason!.length, bad).toBeGreaterThan(0);
    }
  });

  it("copes with null and undefined", () => {
    expect(isValidLocalPart(null).ok).toBe(false);
    expect(isValidLocalPart(undefined).ok).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts plausible addresses and refuses the rest", () => {
    for (const good of ["a@b.com", "first.last+tag@sub.example.co.uk"]) expect(isValidEmail(good), good).toBe(true);
    for (const bad of ["", "   ", "a@b", "a b@c.com", "a@b.c", "no-at-sign.com", "<a@b.com>", "a@b.com, c@d.com", null, undefined])
      expect(isValidEmail(bad), String(bad)).toBe(false);
    expect(isValidEmail("a".repeat(250) + "@b.com")).toBe(false);
  });
});

describe("the platform's own email brand", () => {
  it("is Drive247's, so a system email never borrows a tenant's colours", () => {
    expect(PLATFORM_EMAIL_BRAND.companyName).toBe("Drive 247");
    expect(PLATFORM_EMAIL_BRAND.contactEmail).toBe("support@drive-247.com");
    expect(PLATFORM_EMAIL_BRAND.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(PLATFORM_EMAIL_BRAND.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
