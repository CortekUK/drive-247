import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATEGORIES,
  getNotificationItem,
  itemsFor,
} from "@/lib/notifications-v2/catalog";
import { NOTIFICATION_VARIABLES, exampleValues, extractVariables, fillVariables } from "@/lib/notifications-v2/variables";
import type {
  ChannelSpec,
  ChannelTemplate,
  NotificationCategoryId,
  NotificationChannel,
  NotificationDirection,
  NotificationItem,
} from "@/lib/notifications-v2/types";

/**
 * Notifications v2 catalog: every notification the page lists. The lead forbade
 * invented entries (transcript §3.4), so these tests hold each item to the
 * contract in docs/notifications-v2/build-spec.md and types.ts, and check that
 * its evidence still points at real code.
 */

const repo = join(__dirname, "..", "..", "..", "..", "..");

/** Hard caps enforced by send-push (build-spec, push-display.ts). */
const PUSH_TITLE_MAX = 100;
const PUSH_BODY_MAX = 300;
/** What the lead asked us to aim for so the "…" falls late (§3.9). */
const PUSH_TITLE_IDEAL = 45;
const PUSH_BODY_IDEAL = 110;

const ALLOWED_EMAIL_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "a", "hr"]);
const LINK_ONLY_VARIABLES = ["rental_id", "customer_id"];
const CATEGORY_ORDER: NotificationCategoryId[] = [
  "booking",
  "rental",
  "payments",
  "agreements",
  "verification",
  "keys",
  "fines",
  "insurance",
  "enquiries",
];
const DIRECTIONS: NotificationDirection[] = ["customer_to_team", "team_to_customer"];

const knownVariables = new Set(NOTIFICATION_VARIABLES.map((v) => v.key));
const examples = exampleValues();

function channelsOf(item: NotificationItem): Array<[NotificationChannel, ChannelSpec<ChannelTemplate>]> {
  return Object.entries(item.channels) as Array<[NotificationChannel, ChannelSpec<ChannelTemplate>]>;
}

function templateTexts(item: NotificationItem): string[] {
  const texts: string[] = [];
  for (const [, spec] of channelsOf(item)) {
    const t = spec.defaultTemplate as unknown as Record<string, string>;
    for (const field of ["subject", "body", "title"]) if (typeof t[field] === "string") texts.push(t[field]);
  }
  return texts;
}

describe("NOTIFICATION_CATALOG items", () => {
  it("is not empty", () => {
    expect(NOTIFICATION_CATALOG.length).toBeGreaterThan(0);
  });

  it("has unique keys that fit the database check", () => {
    const keys = NOTIFICATION_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it("gives every item a name, a tooltip, a 'When …' sentence, a recipient and evidence", () => {
    for (const item of NOTIFICATION_CATALOG) {
      expect(item.name.trim(), item.key).not.toBe("");
      expect(item.tooltip.trim(), item.key).not.toBe("");
      expect(item.when, item.key).toMatch(/^When .+\.$/);
      expect(item.recipient.trim(), item.key).not.toBe("");
      expect(["booking_site", "portal", "automatic"], item.key).toContain(item.side);
      expect(DIRECTIONS, item.key).toContain(item.direction);
      expect(item.evidence.length, item.key).toBeGreaterThan(0);
      for (const e of item.evidence) expect(e.trim(), item.key).not.toBe("");
    }
  });

  it("names the right audience for each direction", () => {
    for (const item of NOTIFICATION_CATALOG) {
      if (item.direction === "customer_to_team") expect(item.recipient, item.key).toMatch(/^Your /);
      else expect(item.recipient, item.key).toMatch(/^The /);
    }
  });

  it("lists at least one channel, and only known ones", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const channels = channelsOf(item);
      expect(channels.length, item.key).toBeGreaterThan(0);
      for (const [channel] of channels) expect(["email", "push", "in_app"], item.key).toContain(channel);
    }
  });

  it("defaults each channel to what happens today (D12)", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const [channel, spec] of channelsOf(item)) {
        expect(spec.defaultEnabled, `${item.key}.${channel}`).toBe(spec.today !== "not_sent");
      }
    }
  });

  it("explains every channel that only sends on some paths", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const [channel, spec] of channelsOf(item)) {
        if (spec.today === "sends_some_paths") expect(spec.note?.trim(), `${item.key}.${channel}`).toBeTruthy();
      }
    }
  });

  it("marks push as not sent anywhere today, off by default, with display options", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const push = item.channels.push;
      if (!push) continue;
      expect(push.today, item.key).toBe("not_sent");
      expect(push.defaultEnabled, item.key).toBe(false);
      expect(push.defaultPushOptions, item.key).toBeDefined();
      expect(push.note?.trim(), item.key).toBeTruthy();
    }
  });

  it("keeps at least one channel that sends today, so nothing listed is invented", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const sendsToday = channelsOf(item).some(([, spec]) => spec.today !== "not_sent");
      expect(sendsToday, item.key).toBe(true);
    }
  });
});

describe("variables in the catalog", () => {
  it("offers only variables that exist", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const key of item.variables) expect(knownVariables.has(key), `${item.key}: ${key}`).toBe(true);
    }
  });

  it("uses only offered variables in every default template", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const text of templateTexts(item)) {
        for (const key of extractVariables(text)) {
          expect(item.variables, `${item.key}: {{${key}}}`).toContain(key);
          expect(knownVariables.has(key), `${item.key}: {{${key}}}`).toBe(true);
        }
      }
    }
  });

  it("fills every default template completely with the example values", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const text of templateTexts(item)) {
        expect(fillVariables(text, examples), item.key).not.toMatch(/\{\{/);
      }
    }
  });

  it("keeps link-only ids out of message text and out of the picker", () => {
    for (const item of NOTIFICATION_CATALOG) {
      for (const key of LINK_ONLY_VARIABLES) expect(item.variables, item.key).not.toContain(key);
    }
  });

  it("never offers customers the staff portal link", () => {
    for (const item of NOTIFICATION_CATALOG.filter((i) => i.direction === "team_to_customer")) {
      expect(item.variables, item.key).not.toContain("portal_url");
    }
  });

  it("uses relative links whose variables exist", () => {
    for (const item of NOTIFICATION_CATALOG) {
      if (!item.link) continue;
      expect(item.link.startsWith("/") && !item.link.startsWith("//"), item.key).toBe(true);
      for (const key of extractVariables(item.link)) expect(knownVariables.has(key), `${item.key}: ${key}`).toBe(true);
      expect(fillVariables(item.link, examples), item.key).not.toMatch(/\{\{/);
    }
  });
});

describe("default templates", () => {
  it("gives every email a subject and a body", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const email = item.channels.email;
      if (!email) continue;
      expect(email.defaultTemplate.subject.trim(), item.key).not.toBe("");
      expect(email.defaultTemplate.body.trim(), item.key).not.toBe("");
    }
  });

  it("writes email bodies with only the tags the editor produces, and at most one button", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const body = item.channels.email?.defaultTemplate.body;
      if (!body) continue;
      const tags = Array.from(body.matchAll(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g)).map((m) => m[1].toLowerCase());
      for (const tag of tags) expect(ALLOWED_EMAIL_TAGS.has(tag), `${item.key}: <${tag}>`).toBe(true);

      const anchors = Array.from(body.matchAll(/<a\b([^>]*)>/g)).map((m) => m[1]);
      const buttons = anchors.filter((attrs) => /\bdata-email-button\b/.test(attrs));
      expect(buttons.length, item.key).toBeLessThanOrEqual(1);
      // Every link is the button, and its target is a single variable.
      expect(anchors.length, item.key).toBe(buttons.length);
      for (const attrs of buttons) expect(attrs, item.key).toMatch(/href="\{\{[a-z0-9_]+\}\}"/);
    }
  });

  it("signs every email off with the company name", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const body = item.channels.email?.defaultTemplate.body;
      if (body) expect(extractVariables(body), item.key).toContain("company_name");
    }
  });

  it("keeps push text within the send-push caps, before and after filling", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const push = item.channels.push?.defaultTemplate;
      if (!push) continue;
      expect(push.title.trim(), item.key).not.toBe("");
      expect(push.body.trim(), item.key).not.toBe("");
      expect(push.title.length, item.key).toBeLessThanOrEqual(PUSH_TITLE_MAX);
      expect(push.body.length, item.key).toBeLessThanOrEqual(PUSH_BODY_MAX);
      expect(fillVariables(push.title, examples).length, item.key).toBeLessThanOrEqual(PUSH_TITLE_MAX);
      expect(fillVariables(push.body, examples).length, item.key).toBeLessThanOrEqual(PUSH_BODY_MAX);
    }
  });

  it("keeps filled push text short enough that the example rarely gets cut", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const push = item.channels.push?.defaultTemplate;
      if (!push) continue;
      expect(fillVariables(push.title, examples).length, `${item.key} title`).toBeLessThanOrEqual(PUSH_TITLE_IDEAL);
      expect(fillVariables(push.body, examples).length, `${item.key} body`).toBeLessThanOrEqual(PUSH_BODY_IDEAL);
    }
  });

  it("keeps in-app text to a short title and message", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const inApp = item.channels.in_app?.defaultTemplate;
      if (!inApp) continue;
      expect(inApp.title.trim(), item.key).not.toBe("");
      expect(inApp.body.trim(), item.key).not.toBe("");
      expect(fillVariables(inApp.title, examples).length, item.key).toBeLessThanOrEqual(60);
      expect(fillVariables(inApp.body, examples).length, item.key).toBeLessThanOrEqual(200);
    }
  });
});

describe("categories", () => {
  it("lists categories in the agreed order, with no duplicates", () => {
    const ids = NOTIFICATION_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const positions = ids.map((id) => CATEGORY_ORDER.indexOf(id));
    for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("gives every category a label and a description", () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(c.label.trim(), c.id).not.toBe("");
      expect(c.description.trim(), c.id).not.toBe("");
    }
  });

  it("puts every item in a listed category and lists no empty category", () => {
    const listed = new Set(NOTIFICATION_CATEGORIES.map((c) => c.id));
    for (const item of NOTIFICATION_CATALOG) expect(listed.has(item.category), item.key).toBe(true);
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(NOTIFICATION_CATALOG.some((i) => i.category === c.id), c.id).toBe(true);
    }
  });
});

describe("lookups", () => {
  it("finds an item by key", () => {
    const first = NOTIFICATION_CATALOG[0];
    expect(getNotificationItem(first.key)).toBe(first);
    expect(getNotificationItem("no_such_notification")).toBeUndefined();
  });

  it("splits the catalog by direction and category without losing or repeating an item", () => {
    const seen: string[] = [];
    for (const direction of DIRECTIONS) {
      for (const c of NOTIFICATION_CATEGORIES) {
        const items = itemsFor(direction, c.id);
        for (const item of items) {
          expect(item.direction).toBe(direction);
          expect(item.category).toBe(c.id);
        }
        // Catalog order is kept.
        const order = items.map((i) => NOTIFICATION_CATALOG.indexOf(i));
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        seen.push(...items.map((i) => i.key));
      }
    }
    expect(seen.sort()).toEqual(NOTIFICATION_CATALOG.map((i) => i.key).sort());
  });

  it("tells both sides of the booking-site booking", () => {
    // The lead's worked example (§3.5): a customer books on the booking site.
    const booking = NOTIFICATION_CATALOG.filter((i) => i.category === "booking" && i.side === "booking_site");
    expect(booking.some((i) => i.direction === "customer_to_team")).toBe(true);
    expect(booking.some((i) => i.direction === "team_to_customer")).toBe(true);
  });
});

describe("evidence still points at real code", () => {
  const PATH = /((?:apps|supabase)\/[A-Za-z0-9_\-./()[\]]+\.(?:tsx|ts|sql|json))(?::(\d+))?/g;

  it("names at least one real file per item", () => {
    for (const item of NOTIFICATION_CATALOG) {
      const paths = item.evidence.flatMap((e) => Array.from(e.matchAll(PATH)).map((m) => m[1]));
      expect(paths.length, item.key).toBeGreaterThan(0);
    }
  });

  it("cites files that exist, at lines that exist", () => {
    const lineCounts = new Map<string, number>();
    for (const item of NOTIFICATION_CATALOG) {
      for (const e of item.evidence) {
        for (const m of e.matchAll(PATH)) {
          const [, path, line] = m;
          const abs = join(repo, path);
          expect(existsSync(abs), `${item.key}: ${path}`).toBe(true);
          if (!line) continue;
          if (!lineCounts.has(path)) lineCounts.set(path, readFileSync(abs, "utf8").split("\n").length);
          expect(Number(line), `${item.key}: ${path}:${line}`).toBeLessThanOrEqual(lineCounts.get(path)!);
        }
      }
    }
  });
});
