import { describe, expect, it } from "vitest";
import { SETTINGS_SUB_TABS, TAB_GROUPS } from "@/lib/permissions";
import { ALLOWED_TAB_KEYS } from "../../../../../supabase/functions/_shared/manager-tab-keys";

/**
 * The manager-permissions picker and the user-management edge functions must
 * accept the same tab keys. When they drift, giving a manager a newer tab is
 * rejected server-side with "Invalid tab keys", which the portal used to show
 * as a save that spins and does nothing (Luxurious Car Rentals, Nov 2026).
 */
describe("manager tab keys", () => {
  const offered = [
    ...TAB_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.key)),
    ...SETTINGS_SUB_TABS.map((tab) => tab.key),
    "settings",
  ];

  it("the picker offers tabs", () => {
    expect(offered.length).toBeGreaterThan(20);
  });

  it("every tab the picker offers is accepted by the edge functions", () => {
    const rejected = offered.filter((key) => !ALLOWED_TAB_KEYS.includes(key));
    expect(rejected).toEqual([]);
  });

  it("the server list has no duplicates", () => {
    expect(new Set(ALLOWED_TAB_KEYS).size).toBe(ALLOWED_TAB_KEYS.length);
  });
});
