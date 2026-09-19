/**
 * Notifications v2 data hooks: settings rows, email sender, email branding and
 * Send test.
 *
 * What is pinned, and why each matters:
 *   - every read and write is scoped to the signed-in tenant (V2_PLAN §5: RLS is
 *     the second lock, the tenant filter is the first);
 *   - supabase-js resolves with {error} instead of throwing, so an error must
 *     surface as an error, and a write that quietly touched fewer rows than
 *     asked (RLS filters instead of raising) must NOT look like a save;
 *   - a missing table (ops/notifications_v2.sql not applied yet) is a state,
 *     not an error: defaults on read, a plain "not switched on yet" on save;
 *   - Send test always resolves to a sentence the operator can read, whatever
 *     the edge function, the gateway or the network did.
 *
 * HARNESS: renderHook with a real QueryClient; supabase is a recording,
 * chainable double whose result is decided per call by `respond`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  NOTIFICATION_KEY_PATTERN,
  NOTIFICATION_SETTINGS_V2_CONFLICT,
  NOTIFICATION_SETTINGS_V2_TABLE,
  NotificationStorageMissingError,
  expandSettingRefs,
  isMissingTableError,
  notificationSettingsV2QueryKey,
  useNotificationSettingsV2,
} from "@/hooks/use-notification-settings-v2";
import { EMAIL_SENDER_V2_TABLE, EMPTY_EMAIL_SENDER, emailSenderV2QueryKey, useEmailSenderV2 } from "@/hooks/use-email-sender-v2";
import {
  EMAIL_BRANDING_V2_COLUMNS,
  emailBrandFromTenantRow,
  emailBrandingV2QueryKey,
  useEmailBrandingV2,
} from "@/hooks/use-email-branding-v2";
import { NOTIFICATION_TEST_V2_FUNCTION, useNotificationTestV2 } from "@/hooks/use-notification-test-v2";
import { NOTIFICATION_CATALOG } from "@/lib/notifications-v2/catalog";
import type { NotificationSettingRow } from "@/lib/notifications-v2/types";

// ── Doubles ─────────────────────────────────────────────────────────────────

type Op = [string, unknown[]];
interface Call {
  table: string;
  ops: Op[];
}
type Result = { data?: unknown; error?: Record<string, unknown> | null };

let tenant: Record<string, unknown> | null;
let calls: Call[];
let respond: (call: Call) => Result | Promise<Result>;
const invoke = vi.fn();

const has = (call: Call, name: string) => call.ops.some(([n]) => n === name);
const args = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, a]) => a);
const writes = () => calls.filter((c) => has(c, "upsert") || has(c, "delete") || has(c, "insert") || has(c, "update"));
const reads = (table: string) => calls.filter((c) => c.table === table && !writes().includes(c));

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "order", "limit", "upsert", "delete", "insert", "update", "maybeSingle", "single"]) {
    b[m] = (...a: unknown[]) => {
      call.ops.push([m, a]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(() => respond(call))
      .then((r) => ({ data: r.data ?? null, error: r.error ?? null }))
      .then(resolve, reject);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant, tenantSlug: (tenant?.slug as string) ?? null }),
}));

// ── Harness ─────────────────────────────────────────────────────────────────

let client: QueryClient;
// `children: any`: the root @types/react 18 (Testing Library) and the portal's 19 disagree on ReactNode.
const wrapper = ({ children }: { children?: any }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

const stored = (over: Partial<NotificationSettingRow> = {}): NotificationSettingRow => ({
  tenant_id: T1,
  notification_key: "booking_confirmed",
  channel: "email",
  enabled: true,
  subject: null,
  title: null,
  body: null,
  push_options: {},
  ...over,
});

const missing = { code: "PGRST205", message: "Could not find the table 'public.tenant_notification_settings' in the schema cache" };

beforeEach(() => {
  tenant = { id: T1, slug: "northwind", company_name: "Northwind Cars", contact_email: "hi@northwind.test", phone: "+1 555 0100" };
  calls = [];
  respond = () => ({ data: [] });
  invoke.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

// ═════════════════════════════════════════════════════════════════════════════
// useNotificationSettingsV2
// ═════════════════════════════════════════════════════════════════════════════

describe("useNotificationSettingsV2: reading", () => {
  it("reads only this tenant's rows, under a tenant-scoped key, and cleans them", async () => {
    respond = () => ({
      data: [
        stored({ push_options: { silent: true } as never }),
        stored({ notification_key: "payment_received", channel: "push", push_options: { silent: true, vibrate: true, openInApp: "yes" } as never }),
        stored({ tenant_id: T2, notification_key: "leak_row" }),
        stored({ notification_key: "odd_channel", channel: "sms" as never }),
      ],
    });
    const { result } = renderHook(() => useNotificationSettingsV2(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [read] = reads(NOTIFICATION_SETTINGS_V2_TABLE);
    expect(args(read, "eq")).toContainEqual(["tenant_id", T1]);
    expect(client.getQueryData(notificationSettingsV2QueryKey(T1))).toBeTruthy();

    expect(result.current.rows.map((r) => r.notification_key)).toEqual(["booking_confirmed", "payment_received"]);
    // push_options: {} off push; only known boolean options on push.
    expect(result.current.rows[0].push_options).toEqual({});
    expect(result.current.rows[1].push_options).toEqual({ silent: true });
    expect(result.current.tableMissing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each([
    ["PGRST205", missing],
    ["42P01", { code: "42P01", message: 'relation "public.tenant_notification_settings" does not exist' }],
    ["message only", { message: "Could not find the table 'public.tenant_notification_settings'" }],
  ])("a missing table (%s) is defaults, not an error", async (_label, error) => {
    respond = () => ({ error });
    const { result } = renderHook(() => useNotificationSettingsV2(), { wrapper });
    await waitFor(() => expect(result.current.tableMissing).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("any other read error surfaces as an error (a missing COLUMN is not a missing table)", async () => {
    respond = () => ({ error: { code: "42703", message: "column tenant_notification_settings.title does not exist" } });
    const { result } = renderHook(() => useNotificationSettingsV2(), { wrapper });
    // The hook retries a failed read once (about a second later) before giving up.
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 4000 });
    expect(result.current.tableMissing).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it("does not query before the tenant is known", async () => {
    tenant = null;
    const { result } = renderHook(() => useNotificationSettingsV2(), { wrapper });
    await act(async () => {});
    expect(calls).toHaveLength(0);
    expect(result.current.rows).toEqual([]);
    await expect(result.current.saveRows([stored()])).rejects.toThrow(/haven't loaded/);
    expect(writes()).toHaveLength(0);
  });

  it("isMissingTableError only matches a missing table", () => {
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "42703", message: "column x does not exist" })).toBe(false);
    expect(isMissingTableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("useNotificationSettingsV2: saving", () => {
  /** Mount with `saved` rows stored; writes answer with `onWrite`. */
  async function mount(saved: NotificationSettingRow[], onWrite: (call: Call) => Result = echo) {
    respond = (call) => (writes().includes(call) ? onWrite(call) : { data: saved });
    const hook = renderHook(() => useNotificationSettingsV2(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }
  /** A write that "returns" exactly the rows it was asked to write. */
  function echo(call: Call): Result {
    if (has(call, "upsert")) {
      const rows = args(call, "upsert")[0][0] as NotificationSettingRow[];
      return { data: rows.map((r) => ({ notification_key: r.notification_key, channel: r.channel })) };
    }
    const keys = (args(call, "in")[0]?.[1] ?? []) as string[];
    const channel = args(call, "eq").find(([c]) => c === "channel")?.[1];
    return { data: keys.map((k) => ({ notification_key: k, channel })) };
  }

  it("upserts on the primary key, stamped with this tenant, then re-reads", async () => {
    const { result } = await mount([]);
    await act(() =>
      result.current.saveRows({
        upserts: [stored({ enabled: false, subject: "Hi {{customer_name}}" }), stored({ notification_key: "payment_received", channel: "push", title: "Paid", push_options: { openInApp: true } })],
        deletes: [],
      }),
    );
    const [up] = writes();
    expect(up.table).toBe(NOTIFICATION_SETTINGS_V2_TABLE);
    const [rows, opts] = args(up, "upsert")[0] as [NotificationSettingRow[], { onConflict: string }];
    expect(opts.onConflict).toBe(NOTIFICATION_SETTINGS_V2_CONFLICT);
    expect(NOTIFICATION_SETTINGS_V2_CONFLICT).toBe("tenant_id,notification_key,channel");
    expect(rows.every((r) => r.tenant_id === T1)).toBe(true);
    expect(rows[1]).toMatchObject({ channel: "push", title: "Paid", subject: null, push_options: { openInApp: true } });
    // The browser never sends updated_by: the table's trigger stamps it.
    expect(rows.every((r) => !("updated_by" in r) && !("updated_at" in r))).toBe(true);
    expect(has(up, "select")).toBe(true);
    await waitFor(() => expect(reads(NOTIFICATION_SETTINGS_V2_TABLE).length).toBe(2));
  });

  it("accepts the two lists separately too: saveRows(upserts, deletes)", async () => {
    const { result } = await mount([stored({ notification_key: "rental_started" })]);
    await act(() => result.current.saveRows([stored()], [{ notification_key: "rental_started", channel: "email" }]));
    expect(writes().map((c) => (has(c, "upsert") ? "upsert" : "delete"))).toEqual(["upsert", "delete"]);
  });

  it("fails when fewer rows come back than were sent (a silent RLS refusal is not a save)", async () => {
    const { result } = await mount([], () => ({ data: [{ notification_key: "booking_confirmed", channel: "email" }] }));
    await expect(
      result.current.saveRows([stored(), stored({ notification_key: "payment_received" })]),
    ).rejects.toThrow(/Only 1 of 2 notification settings were saved/);
  });

  it("an upsert error is thrown, in plain words", async () => {
    const { result } = await mount([], () => ({ error: { code: "42501", message: 'new row violates row-level security policy for table "tenant_notification_settings"' } }));
    await expect(result.current.saveRows([stored()])).rejects.toThrow("You don't have permission to change notifications. Ask an admin.");
  });

  it("a CHECK failure becomes a sentence, and keeps its code", async () => {
    const { result } = await mount([], () => ({ error: { code: "23514", message: 'violates check constraint "tns_title"' } }));
    const err = await result.current.saveRows([stored()]).catch((e) => e);
    expect(err.message).toMatch(/isn't allowed/);
    expect(err.message).not.toMatch(/tns_title/);
    expect(err.code).toBe("23514");
  });

  it("saving while the table is missing says storage isn't on yet", async () => {
    respond = (call) => ({ error: missing, data: writes().includes(call) ? null : undefined });
    const { result } = renderHook(() => useNotificationSettingsV2(), { wrapper });
    await waitFor(() => expect(result.current.tableMissing).toBe(true));
    const err = await result.current.saveRows([stored()]).catch((e) => e);
    expect(err).toBeInstanceOf(NotificationStorageMissingError);
    expect(err.message).toMatch(/isn't switched on/);
  });

  it("never writes a row for another tenant", async () => {
    const { result } = await mount([]);
    await expect(result.current.saveRows([stored({ tenant_id: T2 })])).rejects.toThrow(/another account/);
    expect(writes()).toHaveLength(0);
  });

  it("refuses a key or channel the table would reject, before writing", async () => {
    const { result } = await mount([]);
    await expect(result.current.saveRows([stored({ notification_key: "Booking Confirmed" })])).rejects.toThrow(/isn't a notification/);
    await expect(result.current.saveRows([stored({ channel: "sms" as never })])).rejects.toThrow(/isn't a notification channel/);
    expect(writes()).toHaveLength(0);
  });

  it("sends one row per (key, channel), the last one winning, and clears fields the channel cannot hold", async () => {
    const { result } = await mount([]);
    await act(() =>
      result.current.saveRows([
        stored({ enabled: true, title: "not for email", push_options: { silent: true } }),
        stored({ enabled: false }),
      ]),
    );
    const [rows] = args(writes()[0], "upsert")[0] as [NotificationSettingRow[]];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, title: null, push_options: {} });
  });

  it("resets by deleting per channel, filtered by tenant, channel and key", async () => {
    const saved = [stored(), stored({ notification_key: "payment_received" }), stored({ notification_key: "payment_received", channel: "push" })];
    const { result } = await mount(saved);
    await act(() =>
      result.current.resetRows([
        { notification_key: "booking_confirmed", channel: "email" },
        "payment_received:email",
        "payment_received:push",
      ]),
    );
    const deletes = writes();
    expect(deletes).toHaveLength(2);
    for (const d of deletes) {
      expect(has(d, "delete")).toBe(true);
      expect(args(d, "eq")).toContainEqual(["tenant_id", T1]);
      expect(args(d, "eq").some(([c]) => c === "channel")).toBe(true);
    }
    const email = deletes.find((d) => args(d, "eq").some(([c, v]) => c === "channel" && v === "email"))!;
    expect(args(email, "in")[0]).toEqual(["notification_key", ["booking_confirmed", "payment_received"]]);
  });

  it("a bare key resets every channel of that notification", () => {
    expect(expandSettingRefs(["booking_confirmed"]).map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    expect(expandSettingRefs([{ notification_key: "booking_confirmed" }])).toHaveLength(3);
    expect(expandSettingRefs(["booking_confirmed:push", "booking_confirmed:push"])).toEqual([{ key: "booking_confirmed", channel: "push" }]);
    expect(() => expandSettingRefs(["booking_confirmed:sms"])).toThrow(/isn't a notification channel/);
  });

  it("a reset that removes nothing we know is stored is reported, not swallowed", async () => {
    const { result } = await mount([stored()], () => ({ data: [] }));
    await expect(result.current.resetRows(["booking_confirmed:email"])).rejects.toThrow(/couldn't be reset/);
  });

  it("resetting a row that was never stored is fine", async () => {
    const { result } = await mount([], () => ({ data: [] }));
    await expect(result.current.resetRows(["booking_confirmed:email"])).resolves.toBeUndefined();
  });

  it("a key both saved and reset in one call is saved, not deleted", async () => {
    const { result } = await mount([stored()]);
    await act(() => result.current.saveRows({ upserts: [stored({ enabled: false })], deletes: [{ notification_key: "booking_confirmed", channel: "email", tenant_id: T1 }] }));
    expect(writes().map((c) => (has(c, "upsert") ? "upsert" : "delete"))).toEqual(["upsert"]);
  });

  it("nothing to write means no request", async () => {
    const { result } = await mount([]);
    await act(() => result.current.saveRows({ upserts: [], deletes: [] }));
    expect(writes()).toHaveLength(0);
  });

  it("every catalog key passes the key rule the table enforces", () => {
    expect(NOTIFICATION_CATALOG.length).toBeGreaterThan(0);
    for (const item of NOTIFICATION_CATALOG) expect(item.key).toMatch(NOTIFICATION_KEY_PATTERN);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useEmailSenderV2
// ═════════════════════════════════════════════════════════════════════════════

describe("useEmailSenderV2", () => {
  it("reads this tenant's sender row", async () => {
    respond = () => ({ data: { from_name: "Northwind Bookings", from_local_part: "northwind.bookings", reply_to: null } });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    const [read] = calls;
    expect(read.table).toBe(EMAIL_SENDER_V2_TABLE);
    expect(args(read, "eq")).toContainEqual(["tenant_id", T1]);
    expect(has(read, "maybeSingle")).toBe(true);
    expect(client.getQueryData(emailSenderV2QueryKey(T1))).toBeTruthy();
    expect(result.current.sender).toEqual({ from_name: "Northwind Bookings", from_local_part: "northwind.bookings", reply_to: null });
  });

  it("no row means the default sender (all NULL)", async () => {
    respond = () => ({ data: null });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    expect(result.current.sender).toEqual(EMPTY_EMAIL_SENDER);
    expect(result.current.tableMissing).toBe(false);
  });

  it("a missing table is defaults plus tableMissing; saving says storage isn't on", async () => {
    respond = () => ({ error: missing });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.tableMissing).toBe(true));
    expect(result.current.sender).toEqual(EMPTY_EMAIL_SENDER);
    expect(result.current.error).toBeNull();
    await expect(result.current.save({ from_name: "X" })).rejects.toBeInstanceOf(NotificationStorageMissingError);
  });

  it("saves trimmed values, blanks as default, keyed on the tenant, and checks the row came back", async () => {
    respond = (call) => (has(call, "upsert") ? { data: [{ tenant_id: T1 }] } : { data: null });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    await act(() => result.current.save({ from_name: "  Northwind Bookings ", from_local_part: "northwind.bookings", reply_to: "  " }));
    const up = writes()[0];
    const [row, opts] = args(up, "upsert")[0] as [Record<string, unknown>, { onConflict: string }];
    expect(row).toEqual({ tenant_id: T1, from_name: "Northwind Bookings", from_local_part: "northwind.bookings", reply_to: null });
    expect(opts.onConflict).toBe("tenant_id");
  });

  it("a save that comes back empty is a failure", async () => {
    respond = (call) => (has(call, "upsert") ? { data: [] } : { data: null });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    await expect(result.current.save({ from_name: "X" })).rejects.toThrow(/wasn't saved/);
  });

  it.each([
    ["another tenant's address", { from_local_part: "coastline" }, /Start it with "northwind"/],
    ["a dash after the slug (another tenant's slug may start the same way)", { from_local_part: "northwind-cars" }, /After "northwind", use a dot/],
    ["uppercase", { from_local_part: "Northwind" }, /lowercase/],
    ["two reply-to addresses", { reply_to: "a@b.com, c@d.com" }, /one reply-to address/],
    ["a name on two lines", { from_name: "A\nBcc: x@y.z" }, /one line/],
    ["a 101-character name", { from_name: "n".repeat(101) }, /100 characters/],
  ])("refuses %s before writing", async (_label, settings, message) => {
    respond = () => ({ data: null });
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    await expect(result.current.save(settings)).rejects.toThrow(message);
    expect(writes()).toHaveLength(0);
  });

  it("the table's slug rule comes back as a sentence", async () => {
    respond = (call) =>
      has(call, "upsert")
        ? { error: { code: "23514", message: "from_local_part must be the tenant slug or start with it" } }
        : { data: null };
    const { result } = renderHook(() => useEmailSenderV2(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    await expect(result.current.save({ from_local_part: "northwind.help" })).rejects.toThrow(/Start the address with "northwind"/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useEmailBrandingV2
// ═════════════════════════════════════════════════════════════════════════════

describe("useEmailBrandingV2", () => {
  it("reads the branding columns of this tenant's row and maps them for the layout", async () => {
    respond = () => ({
      data: { company_name: "Northwind Cars", logo_url: "https://cdn.test/logo.png", primary_color: "#112233", accent_color: " ", contact_email: "hi@nw.test", contact_phone: "", phone: "+1 555 0100", slug: "northwind" },
    });
    const { result } = renderHook(() => useEmailBrandingV2(), { wrapper });
    await waitFor(() => expect(result.current.brand.logoUrl).toBe("https://cdn.test/logo.png"));
    const [read] = calls;
    expect(read.table).toBe("tenants");
    expect(args(read, "select")[0]).toEqual([EMAIL_BRANDING_V2_COLUMNS]);
    expect(args(read, "eq")).toContainEqual(["id", T1]);
    expect(has(read, "maybeSingle")).toBe(true);
    expect(client.getQueryData(emailBrandingV2QueryKey(T1))).toBeTruthy();
    expect(result.current.brand).toEqual({
      companyName: "Northwind Cars",
      logoUrl: "https://cdn.test/logo.png",
      primaryColor: "#112233",
      accentColor: null,
      contactEmail: "hi@nw.test",
      contactPhone: "+1 555 0100",
    });
    expect(result.current.slug).toBe("northwind");
  });

  it("uses what TenantContext already has while loading and when the read fails", async () => {
    respond = () => ({ error: { code: "500", message: "boom" } });
    const { result } = renderHook(() => useEmailBrandingV2(), { wrapper });
    expect(result.current.brand.companyName).toBe("Northwind Cars");
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 4000 });
    expect(result.current.brand).toMatchObject({ companyName: "Northwind Cars", contactEmail: "hi@northwind.test", contactPhone: "+1 555 0100" });
  });

  it("emailBrandFromTenantRow: contact_phone first, blanks become null", () => {
    expect(emailBrandFromTenantRow({ company_name: " A ", contact_phone: "1", phone: "2" })).toMatchObject({ companyName: "A", contactPhone: "1" });
    expect(emailBrandFromTenantRow({ company_name: null, logo_url: "", primary_color: "  " })).toEqual({
      companyName: "",
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
      contactEmail: null,
      contactPhone: null,
    });
    expect(emailBrandFromTenantRow(null).companyName).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useNotificationTestV2
// ═════════════════════════════════════════════════════════════════════════════

describe("useNotificationTestV2", () => {
  const emailReq = { channel: "email" as const, notificationKey: "booking_confirmed", to: "jo@example.com", subject: "Hi", bodyHtml: "<p>Hi</p>" };
  const pushReq = { channel: "push" as const, notificationKey: "payment_received", title: "Paid", body: "700 USD" };
  /** A FunctionsHttpError as supabase-js builds it: the Response hangs off `context`. */
  const httpError = (status: number, body: unknown) =>
    Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    });

  it("calls notification-test-v2 with the request plus the tenant, and passes the reply through", async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, message: "Sent to jo@example.com." }, error: null });
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    let reply: unknown;
    await act(async () => {
      reply = await result.current.sendTest(emailReq);
    });
    expect(invoke).toHaveBeenCalledWith(NOTIFICATION_TEST_V2_FUNCTION, { body: { ...emailReq, tenantId: T1, tenantSlug: "northwind" } });
    expect(NOTIFICATION_TEST_V2_FUNCTION).toBe("notification-test-v2");
    expect(reply).toEqual({ success: true, sent: 1, message: "Sent to jo@example.com." });
  });

  it("a 2xx 'no devices' reply comes back as a failure with its sentence", async () => {
    invoke.mockResolvedValue({ data: { success: false, sent: 0, failed: 0, code: "no_devices", message: "Turn on notifications on this device first." }, error: null });
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    const reply = await result.current.sendTest(pushReq);
    expect(reply).toMatchObject({ success: false, code: "no_devices", message: "Turn on notifications on this device first.", error: "Turn on notifications on this device first." });
  });

  it("unwraps the function's own error body from a non-2xx reply", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(429, { success: false, error: "You can send 20 tests an hour. Try again in 12 minutes.", code: "rate_limited" }) });
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    const reply = await result.current.sendTest(emailReq);
    expect(reply).toEqual({ success: false, error: "You can send 20 tests an hour. Try again in 12 minutes.", message: "You can send 20 tests an hour. Try again in 12 minutes.", code: "rate_limited" });
  });

  it.each([
    ["the function is not deployed (gateway 404)", httpError(404, { code: "NOT_FOUND", message: "Requested function was not found" }), "not_deployed", /isn't switched on yet/],
    ["the gateway refused the session (401)", httpError(401, { code: 401, message: "Invalid JWT" }), "invalid_session", /Sign in again/],
    ["a gateway error with no body of ours", httpError(503, "<html>upstream</html>"), "request_failed", /wasn't sent/],
    ["the network failed", Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }), "network", /Couldn't reach the server/],
  ])("%s gets a plain sentence, not the raw error", async (_label, error, code, message) => {
    invoke.mockResolvedValue({ data: null, error });
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    const reply = await result.current.sendTest(emailReq);
    expect(reply.success).toBe(false);
    expect(reply.code).toBe(code);
    expect(reply.message).toMatch(message);
    expect(reply.message).not.toMatch(/non-2xx|Invalid JWT|upstream/);
  });

  it("never throws, even when invoke itself does", async () => {
    invoke.mockRejectedValue(new Error("kaboom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    await expect(result.current.sendTest(emailReq)).resolves.toMatchObject({ success: false, code: "request_failed" });
    spy.mockRestore();
  });

  it("an empty reply is a failure with a sentence", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    const reply = await result.current.sendTest(emailReq);
    expect(reply.success).toBe(false);
    expect(reply.message).toMatch(/wasn't sent/);
  });

  it("does not call the function before the tenant is known", async () => {
    tenant = null;
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    const reply = await result.current.sendTest(emailReq);
    expect(reply).toMatchObject({ success: false, code: "no_tenant" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports isSending while the request is in flight", async () => {
    let finish: (v: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((r) => (finish = r)));
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.sendTest(pushReq);
    });
    await waitFor(() => expect(result.current.isSending).toBe(true));
    await act(async () => {
      finish({ data: { success: true, sent: 1, message: "Sent to 1 device." }, error: null });
      await pending;
    });
    await waitFor(() => expect(result.current.isSending).toBe(false));
  });

  it("a push test refreshes the push log and device list", async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, message: "Sent to 1 device." }, error: null });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useNotificationTestV2(), { wrapper });
    await act(async () => {
      await result.current.sendTest(pushReq);
    });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(["push-log", T1]);
    expect(keys).toContainEqual(["push-devices", T1]);
  });
});
