import { describe, it, expect } from "vitest";
import {
  EMAIL_SUBJECT_MAX,
  IN_APP_BODY_MAX,
  IN_APP_TITLE_MAX,
  LOCAL_PART_PATTERN,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  diffEdits,
  effectiveChannel,
  isDefaultRow,
  isValidEmail,
  isValidLocalPart,
  normalisePushOptions,
  rowFromEdit,
  senderAddress,
  validateTemplate,
  type ChannelDraft,
  type ChannelEdit,
} from "@/lib/notifications-v2/settings-model";
import type {
  NotificationChannel,
  NotificationItem,
  NotificationSettingRow,
} from "@/lib/notifications-v2/types";

/**
 * Storage rule (types.ts): NULL column = catalog default, no row = all
 * defaults, reset = DELETE. These tests pin the round trips the page relies on:
 * what you edit is what you get back, and an edit that equals the default
 * stores nothing.
 */

const TENANT = "6e5c544f-b374-451f-a662-360a634bff15";

/** A self-contained catalog item, so these tests do not depend on catalog.ts. */
const item: NotificationItem = {
  key: "booking_confirmed",
  category: "booking",
  direction: "team_to_customer",
  name: "Booking confirmed",
  tooltip: "Sent when you approve a booking.",
  when: "When you approve a booking.",
  side: "portal",
  recipient: "The customer",
  channels: {
    email: {
      defaultEnabled: true,
      today: "sends",
      defaultTemplate: {
        subject: "Your booking {{booking_ref}} is confirmed",
        body: "<p>Hi {{customer_name}},</p><p>Your booking is confirmed.</p>",
      },
    },
    push: {
      defaultEnabled: false,
      today: "not_sent",
      defaultTemplate: { title: "Booking confirmed", body: "{{vehicle_name}} is booked." },
      defaultPushOptions: { openInApp: true },
    },
    in_app: {
      defaultEnabled: true,
      today: "sends",
      defaultTemplate: { title: "Booking confirmed", body: "Booking {{booking_ref}} is confirmed." },
    },
  },
  variables: ["customer_name", "booking_ref", "vehicle_name"],
  evidence: ["test fixture"],
};

const emailOnly: NotificationItem = { ...item, key: "email_only", channels: { email: item.channels.email } };

function row(channel: NotificationChannel, patch: Partial<NotificationSettingRow> = {}): NotificationSettingRow {
  return {
    tenant_id: TENANT,
    notification_key: item.key,
    channel,
    enabled: null,
    subject: null,
    title: null,
    body: null,
    push_options: {},
    ...patch,
  };
}

describe("effectiveChannel", () => {
  it("is the catalog default when nothing is saved", () => {
    const e = effectiveChannel(item, "email");
    expect(e.enabled).toBe(true);
    expect(e.template).toEqual(item.channels.email!.defaultTemplate);
    expect(e.customised).toBe(false);
    expect(e.pushOptions).toEqual({});

    const p = effectiveChannel(item, "push");
    expect(p.enabled).toBe(false);
    expect(p.pushOptions).toEqual({ requireInteraction: false, silent: false, replacePrevious: false, openInApp: true });
  });

  it("lays saved columns over the default one by one", () => {
    const e = effectiveChannel(item, "email", row("email", { subject: "Custom {{booking_ref}}" }));
    expect(e.template).toEqual({ subject: "Custom {{booking_ref}}", body: item.channels.email!.defaultTemplate.body });
    expect(e.customised).toBe(true);
    expect(e.enabled).toBe(true);

    const off = effectiveChannel(item, "email", row("email", { enabled: false }));
    expect(off.enabled).toBe(false);
    expect(off.customised).toBe(false);
  });

  it("keeps a deliberately emptied field empty (an empty string is not NULL)", () => {
    const p = effectiveChannel(item, "push", row("push", { body: "" }));
    expect(p.template).toEqual({ title: "Booking confirmed", body: "" });
    expect(p.customised).toBe(true);
  });

  it("merges saved push options over the default ones", () => {
    const p = effectiveChannel(item, "push", row("push", { push_options: { openInApp: false, silent: true } }));
    expect(p.pushOptions).toEqual({ requireInteraction: false, silent: true, replacePrevious: false, openInApp: false });
  });

  it("ignores a row for another notification or channel", () => {
    const e = effectiveChannel(item, "email", row("push", { title: "x", enabled: false }));
    expect(e.enabled).toBe(true);
    expect(e.customised).toBe(false);
  });

  it("treats a channel the item does not offer as off", () => {
    const p = effectiveChannel(emailOnly, "push");
    expect(p.enabled).toBe(false);
    expect(p.template).toEqual({ title: "", body: "" });
  });

  it("does not count whitespace-only reformatting as a customisation", () => {
    const reformatted = "<p>Hi {{customer_name}},</p>\n  <p>Your booking is confirmed.</p>\n";
    expect(effectiveChannel(item, "email", row("email", { body: reformatted })).customised).toBe(false);
  });
});

describe("rowFromEdit", () => {
  it("stores NULLs and {} when the edit equals the defaults", () => {
    for (const channel of ["email", "push", "in_app"] as const) {
      const r = rowFromEdit(TENANT, item.key, channel, effectiveChannel(item, channel), item);
      expect(r).toEqual(row(channel));
      expect(isDefaultRow(r)).toBe(true);
    }
  });

  it("stores only the columns that differ", () => {
    const edit: ChannelEdit = {
      enabled: true,
      template: { subject: "New subject", body: item.channels.email!.defaultTemplate.body },
    };
    const r = rowFromEdit(TENANT, item.key, "email", edit, item);
    expect(r).toEqual(row("email", { subject: "New subject" }));
  });

  it("stores only the push options that differ from the default, and none off push", () => {
    const push = effectiveChannel(item, "push");
    const r = rowFromEdit(TENANT, item.key, "push", { ...push, pushOptions: { ...push.pushOptions, silent: true } }, item);
    expect(r.push_options).toEqual({ silent: true });

    const inApp = rowFromEdit(TENANT, item.key, "in_app", { ...effectiveChannel(item, "in_app"), pushOptions: { silent: true } }, item);
    expect(inApp.push_options).toEqual({});
  });

  it("round-trips: edit -> row -> effective gives the edit back", () => {
    const edits: Array<[NotificationChannel, ChannelEdit]> = [
      ["email", { enabled: false, template: { subject: "S {{booking_ref}}", body: "<p>Body</p>" } }],
      [
        "push",
        {
          enabled: true,
          template: { title: "T", body: "" },
          pushOptions: { requireInteraction: true, silent: false, replacePrevious: true, openInApp: false },
        },
      ],
      ["in_app", { enabled: false, template: { title: "Title", body: "Message {{customer_name}}" } }],
    ];
    for (const [channel, edit] of edits) {
      const back = effectiveChannel(item, channel, rowFromEdit(TENANT, item.key, channel, edit, item));
      expect(back.enabled).toBe(edit.enabled);
      expect(back.template).toEqual(edit.template);
      expect(back.pushOptions).toEqual(channel === "push" ? normalisePushOptions(edit.pushOptions) : {});
      expect(back.customised).toBe(true);
    }
  });

  it("gives an all-default row for a channel the item does not offer", () => {
    const r = rowFromEdit(TENANT, emailOnly.key, "push", { enabled: true, template: { title: "x", body: "y" } }, emailOnly);
    expect(isDefaultRow(r)).toBe(true);
  });
});

describe("diffEdits", () => {
  const draft = (channel: NotificationChannel, state: ChannelEdit): ChannelDraft => ({
    tenantId: TENANT,
    item,
    channel,
    state,
  });

  it("upserts a changed channel", () => {
    const d = draft("email", { ...effectiveChannel(item, "email"), enabled: false });
    expect(diffEdits([], [d])).toEqual({ upserts: [row("email", { enabled: false })], deletes: [] });
  });

  it("deletes the saved row when the draft is back to the defaults (reset)", () => {
    const saved = [row("email", { subject: "Old" })];
    const reset = draft("email", effectiveChannel(item, "email"));
    expect(diffEdits(saved, [reset])).toEqual({
      upserts: [],
      deletes: [{ tenant_id: TENANT, notification_key: item.key, channel: "email" }],
    });
  });

  it("writes nothing for an untouched default or an unchanged saved row", () => {
    const saved = [row("in_app", { title: "Custom" })];
    const drafts = [
      draft("email", effectiveChannel(item, "email")),
      draft("in_app", effectiveChannel(item, "in_app", saved[0])),
    ];
    expect(diffEdits(saved, drafts)).toEqual({ upserts: [], deletes: [] });
  });

  it("upserts when a saved row holds a default value written out in full", () => {
    // An older writer stored the default subject instead of NULL; saving normalises it.
    const saved = [row("email", { subject: item.channels.email!.defaultTemplate.subject, enabled: false })];
    const d = draft("email", effectiveChannel(item, "email", saved[0]));
    expect(diffEdits(saved, [d]).upserts).toEqual([row("email", { enabled: false })]);
  });

  it("leaves saved rows without a draft alone, and lets the last draft for a channel win", () => {
    const saved = [row("push", { title: "Kept" })];
    const first = draft("email", { ...effectiveChannel(item, "email"), enabled: false });
    const last = draft("email", effectiveChannel(item, "email"));
    expect(diffEdits(saved, [first, last])).toEqual({ upserts: [], deletes: [] });
  });

  it("handles missing inputs", () => {
    expect(diffEdits(null, null)).toEqual({ upserts: [], deletes: [] });
  });
});

describe("validateTemplate", () => {
  const vars = item.variables;

  it("accepts good templates on every channel", () => {
    expect(validateTemplate("email", item.channels.email!.defaultTemplate, vars)).toMatchObject({ ok: true, messages: [] });
    expect(validateTemplate("push", item.channels.push!.defaultTemplate, vars).ok).toBe(true);
    expect(validateTemplate("in_app", item.channels.in_app!.defaultTemplate, vars).ok).toBe(true);
    expect(validateTemplate("push", { title: "Hi", body: "" }, vars).ok).toBe(true);
  });

  it("uses the documented limits", () => {
    expect(EMAIL_SUBJECT_MAX).toBe(200);
    expect(PUSH_TITLE_MAX).toBe(100);
    expect(PUSH_BODY_MAX).toBe(300);
    expect(IN_APP_TITLE_MAX).toBe(100);
    expect(IN_APP_BODY_MAX).toBe(500);
  });

  it("requires an email subject and a message with some text", () => {
    const r = validateTemplate("email", { subject: "  ", body: "<p></p><p>&nbsp;</p><hr>" }, vars);
    expect(r.ok).toBe(false);
    expect(r.messages).toEqual(["Add a subject.", "Add a message to the email."]);
    expect(r.issues.map((i) => i.field)).toEqual(["subject", "body"]);
  });

  it("keeps the email subject short and on one line", () => {
    const long = validateTemplate("email", { subject: "x".repeat(201), body: "<p>x</p>" }, vars);
    expect(long.messages).toEqual(["Keep the subject to 200 characters or fewer. It has 201."]);
    const twoLines = validateTemplate("email", { subject: "a\nBcc: x@y.com", body: "<p>x</p>" }, vars);
    expect(twoLines.messages).toEqual(["Keep the subject on one line."]);
  });

  it("requires a title for push and in-app, and caps their lengths", () => {
    expect(validateTemplate("push", { title: "", body: "" }, vars).messages).toEqual(["Add a title."]);
    expect(validateTemplate("in_app", { title: " ", body: "" }, vars).messages).toEqual(["Add a title."]);
    expect(validateTemplate("push", { title: "x".repeat(101), body: "y".repeat(301) }, vars).messages).toEqual([
      "Keep the title to 100 characters or fewer. It has 101.",
      "Keep the message to 300 characters or fewer. It has 301.",
    ]);
    expect(validateTemplate("in_app", { title: "x", body: "y".repeat(501) }, vars).messages).toEqual([
      "Keep the message to 500 characters or fewer. It has 501.",
    ]);
    expect(validateTemplate("in_app", { title: "x", body: "y".repeat(500) }, vars).ok).toBe(true);
  });

  it("names every unknown variable once, with the field it is in", () => {
    const r = validateTemplate(
      "email",
      { subject: "Hi {{first_name}}", body: '<p>{{first_name}} {{customer_name}} <a href="{{pay_link}}">pay</a></p>' },
      vars,
    );
    expect(r.ok).toBe(false);
    expect(r.unknownVariables).toEqual(["first_name", "pay_link"]);
    expect(r.messages).toEqual([
      "{{first_name}} isn't a variable this notification can use.",
      "{{pay_link}} isn't a variable this notification can use.",
    ]);
    expect(r.issues.map((i) => i.field)).toEqual(["subject", "body"]);
  });

  it("blocks an email Button block that has no link, however the missing link is written", () => {
    const withBody = (body: string) => validateTemplate("email", { subject: "Hi", body }, vars);
    for (const body of [
      "<p>Hi</p><p><a data-email-button>Pay now</a></p>",
      '<p>Hi</p><p><a data-email-button="">Pay now</a></p>',
      '<p>Hi</p><p><a data-email-button href="">Pay now</a></p>',
      '<p>Hi</p><p><a data-email-button href="  ">Pay now</a></p>',
      '<p>Hi</p><p><a href="https://x.test">Fine</a></p><p><a class="x" data-email-button>Pay</a></p>',
    ]) {
      const r = withBody(body);
      expect(r.ok, body).toBe(false);
      expect(r.messages, body).toEqual(["A button has no link."]);
      expect(r.issues, body).toEqual([{ field: "body", message: "A button has no link." }]);
    }
    // Two unlinked buttons still give the one message.
    expect(withBody("<p><a data-email-button>A</a></p><p><a data-email-button>B</a></p>").messages).toEqual([
      "A button has no link.",
    ]);
  });

  it("lets a Button block with a link through, and never flags a plain link without one", () => {
    const withBody = (body: string) => validateTemplate("email", { subject: "Hi", body }, vars);
    expect(withBody('<p>Hi</p><p><a data-email-button href="https://x.test/pay">Pay now</a></p>').ok).toBe(true);
    expect(withBody("<p>Hi</p><p><a data-email-button href='https://x.test'>Pay</a></p>").ok).toBe(true);
    expect(withBody('<p>Hi</p><p><a href="https://x.test" data-email-button>Pay</a></p>').ok).toBe(true);
    expect(withBody("<p>Hi <a>no link, not a button</a></p>").ok).toBe(true);
    // Only email bodies have buttons.
    expect(validateTemplate("push", { title: "Hi", body: "<a data-email-button>x</a>" }, vars).ok).toBe(true);
  });
});

describe("isValidLocalPart", () => {
  const ok = (local: string, slug = "coastline") => isValidLocalPart(local, slug);

  it("accepts the slug and slug-prefixed names", () => {
    for (const local of ["coastline", "coastline.bookings", "coastline_team", "coastline.a1", "coastline.help-desk"]) {
      expect(ok(local), local).toEqual({ ok: true, reason: null });
      expect(LOCAL_PART_PATTERN.test(local)).toBe(true);
    }
  });

  it("refuses names that do not start with the slug", () => {
    for (const local of ["bookings", "coast", "support", "xcoastline"]) {
      const r = ok(local);
      expect(r.ok, local).toBe(false);
      expect(r.reason).toBe('Start it with "coastline", for example coastline or coastline.bookings.');
    }
  });

  it("only a dot or an underscore may follow the slug, never a dash or a letter", () => {
    for (const local of ["coastline-help", "coastlinebookings", "coastline1", "coastline-"]) {
      const r = ok(local);
      expect(r.ok, local).toBe(false);
      expect(r.reason).toBe('After "coastline", use a dot (.) or an underscore (_), for example coastline.bookings.');
    }
  });

  it("one tenant can never take another tenant's default address (slugs may contain dashes)", () => {
    // Tenant "open" and tenant "open-bay": "open-bay" is open-bay's default.
    expect(isValidLocalPart("open-bay", "open").ok).toBe(false);
    expect(isValidLocalPart("open-bay.bookings", "open").ok).toBe(false);
    expect(isValidLocalPart("open-bay", "open-bay").ok).toBe(true);
    expect(isValidLocalPart("open.bay", "open").ok).toBe(true);
    // Neither separator can appear in a slug, so the two tenants' sets never meet.
    for (const slug of ["open", "open-bay", "a-b-c"]) expect(/^[a-z0-9-]+$/.test(slug)).toBe(true);
    expect(isValidLocalPart("open.bay", "open-bay").ok).toBe(false);
    expect(isValidLocalPart("open_bay", "open-bay").ok).toBe(false);
  });

  it("explains each other problem in plain words", () => {
    expect(ok("").reason).toBe("Add the part before @drive-247.com.");
    expect(ok("Coastline").reason).toBe("Use lowercase letters only.");
    expect(ok("coastline bookings").reason).toMatch(/^Use only lowercase letters, numbers/);
    expect(ok("coastline+x").reason).toMatch(/^Use only lowercase letters, numbers/);
    expect(ok("coastline@x").reason).toMatch(/^Use only lowercase letters, numbers/);
    expect(ok(".coastline").reason).toBe("Start with a letter or a number.");
    expect(ok("coastline..x").reason).toBe("A dot can't come last or twice in a row.");
    expect(ok("coastline.x.").reason).toBe("A dot can't come last or twice in a row.");
    expect(ok("coastline_").reason).toBe('Add something after "coastline_", or use just "coastline".');
    expect(ok("coastline." + "x".repeat(60)).reason).toBe("Keep it to 64 characters or fewer.");
    expect(isValidLocalPart("coastline", "").reason).toMatch(/haven't loaded yet/);
  });

  it("compares with the slug case-insensitively on the slug side only", () => {
    expect(isValidLocalPart("coastline", "Coastline").ok).toBe(true);
  });
});

describe("senderAddress", () => {
  const tenant = { company_name: "Coastline Car Rentals", slug: "coastline" };

  it("defaults to today's sender: the company name and slug@drive-247.com", () => {
    const s = senderAddress(null, tenant);
    expect(s).toMatchObject({
      name: "Coastline Car Rentals",
      address: "coastline@drive-247.com",
      display: "Coastline Car Rentals <coastline@drive-247.com>",
      header: "Coastline Car Rentals <coastline@drive-247.com>",
      replyTo: null,
      usesDefault: true,
    });
  });

  it("uses a saved name, local part and reply-to", () => {
    const s = senderAddress(
      { from_name: "Coastline Bookings", from_local_part: "coastline.bookings", reply_to: " desk@coastline.com " },
      tenant,
    );
    expect(s.display).toBe("Coastline Bookings <coastline.bookings@drive-247.com>");
    expect(s.replyTo).toBe("desk@coastline.com");
    expect(s.usesDefault).toBe(false);
  });

  it("falls back to the slug when the saved local part is not allowed", () => {
    expect(senderAddress({ from_local_part: "support" }, tenant).address).toBe("coastline@drive-247.com");
    expect(senderAddress({ reply_to: "not an email" }, tenant).replyTo).toBeNull();
  });

  it("quotes a name that needs it and strips what could break the header", () => {
    const s = senderAddress({ from_name: 'Coast & Co. <evil@x.com>\r\nBcc: a@b.com "q"' }, tenant);
    expect(s.name).not.toMatch(/[\r\n<>"]/);
    expect(s.header.startsWith('"')).toBe(true);
    expect(s.header.endsWith(" <coastline@drive-247.com>")).toBe(true);
  });

  it("still gives an address with no tenant details", () => {
    expect(senderAddress(null, null)).toMatchObject({ name: "Drive 247", address: "noreply@drive-247.com" });
  });
});

describe("isValidEmail", () => {
  it("accepts one plain address and refuses lists or junk", () => {
    expect(isValidEmail("jo@example.com")).toBe(true);
    expect(isValidEmail(" jo@example.co.uk ")).toBe(true);
    for (const bad of ["", "jo", "jo@", "jo@x", "a@b.com, c@d.com", "Jo <jo@x.com>", "jo@x.c", null]) {
      expect(isValidEmail(bad as string), String(bad)).toBe(false);
    }
  });
});
