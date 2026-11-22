/**
 * QA B9 Audit logs (2026-11-11): an entry says WHEN on the tenant's own clock,
 * with the zone, and WHAT in words rather than raw JSON; and a v2 settings
 * save writes an entry naming each field it changed.
 *
 * HARNESS: `react-dom/client` + `act`, as in `settings-business-rules-pages.test.tsx`.
 * The tenant context and Supabase are mocked, so nothing here touches the network.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {}, supabaseUntyped: {} }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", timezone: "America/New_York" } }),
}));
vi.mock("@/hooks/use-rental-settings", () => ({
  useRentalSettings: () => ({ hasLoaded: true, error: null, isFetching: false, refetch: () => undefined }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AuditLogsTableV2, describeDetails } from "@/components/admin-v2/audit-logs-table-v2";
import { makeBusinessSave } from "@/components/settings-v2/business-rules-pages";
import { auditDayBounds } from "@/hooks/use-audit-logs";

describe("B9.7 filter by date: a day means the tenant's day", () => {
  it("From Nov 10 for a New York tenant starts at 05:00 UTC and To Nov 10 ends just before 05:00 UTC on the 11th", () => {
    const day = auditDayBounds("2026-11-10", "2026-11-10", "America/New_York");
    expect(day.from).toBe("2026-11-10T05:00:00.000Z");
    expect(day.to).toBe("2026-11-11T04:59:59.999Z");
  });

  it("leaves a bound out when its date is not set", () => {
    expect(auditDayBounds(undefined, undefined, "America/New_York")).toEqual({ from: undefined, to: undefined });
    expect(auditDayBounds("2026-11-10", undefined, "Europe/London").to).toBeUndefined();
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const entry = {
  id: "log-1",
  actor_id: "u1",
  action: "settings_updated",
  target_user_id: null,
  details: { section: "general", changes: { minimum_rental_age: { from: 18, to: 21 } } },
  created_at: "2026-11-10T23:13:15.000Z",
  entity_type: "settings",
  entity_id: "t1",
  tenant_id: "t1",
  actor: { id: "u1", first_name: "QA", last_name: "Owner", email: "owner@example.test", role: "head_admin" },
} as any;

describe("B9.4 when: the table shows the tenant's clock and names the zone", () => {
  it("renders 23:13 UTC as 18:13:15 EST for a New York tenant, whatever this machine's zone", () => {
    const el = mount(<AuditLogsTableV2 logs={[entry]} resetKey="k" serverCount={1} />);
    expect(el.textContent).toContain("Nov 10, 2026");
    expect(el.textContent).toContain("18:13:15 EST");
  });
});

describe("B9.5 what: the details column reads as words", () => {
  it("names the section and each changed field, from and to", () => {
    const text = describeDetails(entry.details);
    expect(text).toContain("Section: general");
    expect(text).toContain("Minimum rental age: 18 → 21");
    expect(text).not.toContain("{");
  });

  it("leaves ids to the tooltip and skips empty values", () => {
    expect(describeDetails({ target_user_id: "abc", target_email: "x@y.test", note: "", entity_ref: "r1" })).toBe(
      "Target email: x@y.test",
    );
    expect(describeDetails(null)).toBe("");
    expect(describeDetails({})).toBe("");
  });

  it("shows the words, not the JSON, in the row itself", () => {
    const el = mount(<AuditLogsTableV2 logs={[entry]} resetKey="k" serverCount={1} />);
    const cells = Array.from(el.querySelectorAll("td")).map((td) => td.textContent || "");
    expect(cells.some((c) => c.includes("Minimum rental age: 18 → 21"))).toBe(true);
    expect(cells.some((c) => c.includes('"section"'))).toBe(false);
  });
});

describe("B9.2 what changed: a v2 settings save reaches the log", () => {
  it("runs afterSave with the saved values once the write has succeeded", async () => {
    const afterSave = vi.fn();
    await makeBusinessSave(vi.fn().mockResolvedValue({}), undefined, afterSave)({ minimum_rental_age: 21 });
    expect(afterSave).toHaveBeenCalledWith({ minimum_rental_age: 21 });
  });

  it("does not log a write that failed", async () => {
    const afterSave = vi.fn();
    await expect(
      makeBusinessSave(vi.fn().mockRejectedValue(new Error("nope")), undefined, afterSave)({ a: 1 }),
    ).rejects.toThrow("nope");
    expect(afterSave).not.toHaveBeenCalled();
  });

  it("never fails the save because the log entry threw", async () => {
    const afterSave = vi.fn(() => {
      throw new Error("log down");
    });
    await expect(makeBusinessSave(vi.fn().mockResolvedValue({}), undefined, afterSave)({ a: 1 })).resolves.toBeUndefined();
  });
});
