/**
 * The Integrations board's pin store, at the level below React.
 *
 * `integration-pins.ts` is the only place a pin is ever persisted, and it is
 * persisted to `localStorage` — which can be absent, cleared, shared with
 * another tenant's session, or edited by hand in devtools. This file pins the
 * three properties the board depends on and cannot check for itself:
 *
 *   1. The key is scoped to BOTH the tenant and the user. A pin is a personal
 *      preference; a super admin hopping tenants must not carry one operator's
 *      shortlist into the next, and two operators sharing a tenant must not
 *      re-order each other's board.
 *   2. Anything that is not a clean list of known card names reads as NO pins.
 *      The board's default order is always a correct render; a ghost pin for a
 *      card that no longer exists is not.
 *   3. `partitionByPins` keeps the board's OWN order inside both halves, so
 *      unpinning returns a card to where it started rather than somewhere new.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module under test also exports a hook, so importing it pulls in the
// tenant context and the auth store — and through them the Supabase client.
// Nothing below renders a component, so both are stubbed away rather than
// stood up: this file is about the storage layer, not about React.
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: null }),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ appUser: null }),
}));

import {
  integrationPinsKey,
  partitionByPins,
  readPins,
  writePins,
} from "@/app/(dashboard)/integrations/integration-pins";

const KNOWN = ["Turo Sync", "Stripe Connect", "Square", "Bonzah"];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("integrationPinsKey", () => {
  it("scopes on tenant AND user, under the portal's d247 prefix", () => {
    expect(integrationPinsKey("tenant-a", "user-1")).toBe(
      "d247.integrations.pins.v1.tenant-a.user-1",
    );
  });

  it("gives every (tenant, user) pair its own bucket", () => {
    const keys = new Set([
      integrationPinsKey("tenant-a", "user-1"),
      integrationPinsKey("tenant-a", "user-2"),
      integrationPinsKey("tenant-b", "user-1"),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("readPins / writePins", () => {
  const key = integrationPinsKey("tenant-a", "user-1");

  it("round-trips a shortlist", () => {
    writePins(key, ["Square", "Turo Sync"]);
    expect(readPins(key, KNOWN)).toEqual(["Square", "Turo Sync"]);
  });

  it("reads no pins when nothing was ever written", () => {
    expect(readPins(key, KNOWN)).toEqual([]);
  });

  it("reads no pins from a value that is not JSON", () => {
    window.localStorage.setItem(key, "not json at all");
    expect(readPins(key, KNOWN)).toEqual([]);
  });

  it("reads no pins from JSON that is not a list", () => {
    window.localStorage.setItem(key, JSON.stringify({ "Turo Sync": true }));
    expect(readPins(key, KNOWN)).toEqual([]);
  });

  it("drops names that are not cards on the board", () => {
    // A renamed or removed integration would otherwise leave a pin that can
    // never be seen and never be cleared — the only way to unpin something is
    // to click the card it is on.
    window.localStorage.setItem(
      key,
      JSON.stringify(["Turo Sync", "SomeDeadIntegration", 42, null, "Square"]),
    );
    expect(readPins(key, KNOWN)).toEqual(["Turo Sync", "Square"]);
  });

  it("de-duplicates", () => {
    window.localStorage.setItem(key, JSON.stringify(["Square", "Square", "Square"]));
    expect(readPins(key, KNOWN)).toEqual(["Square"]);
  });

  it("caps what one key can hold, however long the stored list is", () => {
    const known = Array.from({ length: 200 }, (_, i) => `Card ${i}`);
    window.localStorage.setItem(key, JSON.stringify(known));
    expect(readPins(key, known).length).toBeLessThanOrEqual(32);
  });

  it("never throws when storage itself is unavailable", () => {
    // Safari private mode, and managed profiles with site data disabled. The
    // board must still paint — in its default order, which is what an operator
    // with no pins sees anyway.
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => writePins(key, ["Square"])).not.toThrow();
    expect(() => readPins(key, KNOWN)).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("keeps the shortlist for the rest of the session when writes throw", () => {
    // Degrading to memory is the point: losing pins on reload is a small cost,
    // losing them on the very click that made them is a broken feature.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const memoryKey = integrationPinsKey("tenant-mem", "user-mem");
    writePins(memoryKey, ["Bonzah"]);
    setItem.mockRestore();

    expect(readPins(memoryKey, KNOWN)).toEqual(["Bonzah"]);
  });
});

describe("partitionByPins", () => {
  const board = KNOWN.map((name) => ({ name }));

  it("splits into pinned then the rest, each in the board's own order", () => {
    const { pinned, rest } = partitionByPins(board, new Set(["Bonzah", "Turo Sync"]));
    // NOT the order they were pinned in: insertion order would make an
    // already-pinned card jump whenever a different one is pinned.
    expect(pinned.map((i) => i.name)).toEqual(["Turo Sync", "Bonzah"]);
    expect(rest.map((i) => i.name)).toEqual(["Stripe Connect", "Square"]);
  });

  it("is the identity on an empty pin set", () => {
    const { pinned, rest } = partitionByPins(board, new Set());
    expect(pinned).toEqual([]);
    expect(rest.map((i) => i.name)).toEqual(KNOWN);
  });

  it("ignores pins for cards that are not on the board", () => {
    const { pinned, rest } = partitionByPins(board, new Set(["Nothing At All"]));
    expect(pinned).toEqual([]);
    expect(rest.map((i) => i.name)).toEqual(KNOWN);
  });
});
