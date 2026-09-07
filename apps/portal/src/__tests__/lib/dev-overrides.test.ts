/**
 * The developer override for the teaching empty states — `lib/dev-overrides.ts`.
 *
 * WHAT THIS GUARDS. The override lets a developer force a listing page into
 * its first-time teaching state without deleting data. Two things must be
 * true for that to be safe on a platform where 56 live operators share these
 * pages with the canary:
 *
 *   1. The reader is DEAD outside development. A planted localStorage key on
 *      any other build — production, a preview, vitest's own `test` — reads
 *      as "not forced", unconditionally. Every case below plants the key
 *      first and then asks; a negative that never planted anything would prove
 *      nothing.
 *   2. The override composes INSIDE the lean gate. Even in development, with
 *      the key planted, `isLeanTenant(slug) && (…|| forced)` is false for a
 *      real operator. The pages' own gate expressions are lifted and run in
 *      `components/teaching-empty-states.test.tsx`; this file pins the
 *      composition rule itself.
 *
 * `vi.stubEnv` flips `process.env.NODE_ENV`, which the module reads at CALL
 * time rather than at import — that is what makes a single test file able to
 * exercise both branches. Storage is injected so no test depends on jsdom's
 * localStorage surviving between cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DEV_OVERRIDES_EVENT,
  EMPTY_STATE_PAGES,
  FORCE_EMPTY_STATE_KEY,
  isEmptyStatePageId,
  isEmptyStateForced,
  parseForcedEmptyPages,
  readForcedEmptyPages,
  readForcedEmptyRaw,
  setAllEmptyStatesForced,
  setEmptyStateForced,
  subscribeDevOverrides,
  type EmptyStatePageId,
} from "@/lib/dev-overrides";
import { isLeanTenant } from "@/lib/lean-areas";
import { readPortalSource } from "../helpers/edge-source";

/** A Map-backed `Storage` so every case starts from nothing. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
  } as Storage;
}

const plant = (store: Storage, pages: string[]) =>
  store.setItem(FORCE_EMPTY_STATE_KEY, JSON.stringify(pages));

const ALL_IDS = EMPTY_STATE_PAGES.map((p) => p.id);

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. Dead outside development
// ---------------------------------------------------------------------------

describe("the reader is dead outside development", () => {
  it("vitest itself does not run as development, so the default branch is the inert one", () => {
    // If this ever flips, every "returns false" below would be testing the
    // wrong branch and passing for the wrong reason.
    expect(process.env.NODE_ENV).not.toBe("development");
  });

  it("returns false under vitest's own NODE_ENV with the key planted", () => {
    const store = fakeStorage();
    plant(store, ["vehicles"]);
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBe('["vehicles"]'); // planted, really
    expect(isEmptyStateForced("vehicles", store)).toBe(false);
    expect(readForcedEmptyPages(store).size).toBe(0);
    expect(readForcedEmptyRaw(store)).toBe("");
  });

  it("returns false under production with the key planted for EVERY page", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = fakeStorage();
    plant(store, ALL_IDS);
    for (const id of ALL_IDS) {
      expect(isEmptyStateForced(id, store), id).toBe(false);
    }
    expect(readForcedEmptyPages(store).size).toBe(0);
    expect(readForcedEmptyRaw(store)).toBe("");
  });

  it("the writers are no-ops under production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = fakeStorage();
    setEmptyStateForced("vehicles", true, store);
    setAllEmptyStatesForced(true, store);
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBeNull();
  });

  it("subscribe attaches nothing under production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const onChange = vi.fn();
    const unsubscribe = subscribeDevOverrides(onChange);
    window.dispatchEvent(new Event(DEV_OVERRIDES_EVENT));
    window.dispatchEvent(new StorageEvent("storage", { key: FORCE_EMPTY_STATE_KEY }));
    expect(onChange).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Alive in development
// ---------------------------------------------------------------------------

describe("in development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("FOUND: a planted page reads as forced, and only that page", () => {
    // The positive case first. Every negative in this file is only meaningful
    // because this one shows the reader can say yes.
    const store = fakeStorage();
    plant(store, ["rentals"]);
    expect(isEmptyStateForced("rentals", store)).toBe(true);
    for (const id of ALL_IDS.filter((x) => x !== "rentals")) {
      expect(isEmptyStateForced(id, store), id).toBe(false);
    }
    expect([...readForcedEmptyPages(store)]).toEqual(["rentals"]);
    expect(readForcedEmptyRaw(store)).toBe('["rentals"]');
  });

  it("sets and clears one page; stores in manifest order; removes the key when empty", () => {
    const store = fakeStorage();
    setEmptyStateForced("payments", true, store);
    setEmptyStateForced("vehicles", true, store);
    // Manifest order, not insertion order — the stored value is deterministic.
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBe('["vehicles","payments"]');
    expect(isEmptyStateForced("vehicles", store)).toBe(true);
    expect(isEmptyStateForced("payments", store)).toBe(true);
    expect(isEmptyStateForced("customers", store)).toBe(false);

    setEmptyStateForced("vehicles", false, store);
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBe('["payments"]');

    setEmptyStateForced("payments", false, store);
    // No overrides leaves no trace.
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBeNull();
  });

  it("all on / all off", () => {
    const store = fakeStorage();
    setAllEmptyStatesForced(true, store);
    expect([...readForcedEmptyPages(store)]).toEqual(ALL_IDS);
    for (const id of ALL_IDS) expect(isEmptyStateForced(id, store), id).toBe(true);

    setAllEmptyStatesForced(false, store);
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBeNull();
    for (const id of ALL_IDS) expect(isEmptyStateForced(id, store), id).toBe(false);
  });

  it("tolerates garbage in the key rather than taking a page down", () => {
    expect(parseForcedEmptyPages(null).size).toBe(0);
    expect(parseForcedEmptyPages("").size).toBe(0);
    expect(parseForcedEmptyPages("not json").size).toBe(0);
    expect(parseForcedEmptyPages('{"vehicles":true}').size).toBe(0);
    expect(parseForcedEmptyPages("[]").size).toBe(0);
    // Unknown ids are dropped; known ones survive beside them.
    expect([...parseForcedEmptyPages('["bogus", 42, null, "vehicles"]')]).toEqual(["vehicles"]);

    const store = fakeStorage();
    store.setItem(FORCE_EMPTY_STATE_KEY, "{{{");
    expect(isEmptyStateForced("vehicles", store)).toBe(false);
    // A write on top of garbage replaces it cleanly.
    setEmptyStateForced("vehicles", true, store);
    expect(store.getItem(FORCE_EMPTY_STATE_KEY)).toBe('["vehicles"]');
  });

  it("survives a storage that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(isEmptyStateForced("vehicles", hostile)).toBe(false);
    expect(readForcedEmptyRaw(hostile)).toBe("");
    expect(() => setEmptyStateForced("vehicles", true, hostile)).not.toThrow();
    expect(() => setAllEmptyStatesForced(true, hostile)).not.toThrow();
    // And a null store — Safari private mode — is simply "nothing".
    expect(isEmptyStateForced("vehicles", null)).toBe(false);
    expect(() => setEmptyStateForced("vehicles", true, null)).not.toThrow();
  });

  it("notifies same-tab subscribers on every write, and stops after unsubscribe", () => {
    const store = fakeStorage();
    const onChange = vi.fn();
    const unsubscribe = subscribeDevOverrides(onChange);

    setEmptyStateForced("vehicles", true, store);
    expect(onChange).toHaveBeenCalledTimes(1);
    setAllEmptyStatesForced(false, store);
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    setEmptyStateForced("vehicles", true, store);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reacts to cross-tab storage events for our key (and a clear), not for others", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeDevOverrides(onChange);

    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    expect(onChange).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent("storage", { key: FORCE_EMPTY_STATE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);

    // `key: null` is storage.clear() in another tab — that wiped ours too.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: FORCE_EMPTY_STATE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 3. The override never widens the lean gate
// ---------------------------------------------------------------------------

describe("the override sits inside the lean gate", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  /** The shape every page composes — see the header of lib/dev-overrides.ts. */
  const gate = (slug: string | null | undefined, count: number, store: Storage) =>
    isLeanTenant(slug) && (count === 0 || isEmptyStateForced("vehicles", store));

  it("teaches the canary with rows once forced (the whole point)", () => {
    const store = fakeStorage();
    plant(store, ["vehicles"]);
    expect(gate("northwind", 12, store)).toBe(true);
    // …and not before it is forced.
    expect(gate("northwind", 12, fakeStorage())).toBe(false);
  });

  it("does nothing for goniko, revtek or jangram even with the key planted in development", () => {
    // Three operators taking bookings right now. A planted key on one of their
    // browsers, in a dev build, on their own tenant, must still change nothing.
    const store = fakeStorage();
    plant(store, ALL_IDS);
    expect(isEmptyStateForced("vehicles", store)).toBe(true); // the key IS live…
    for (const slug of ["goniko", "revtek", "jangram"]) {
      expect(gate(slug, 12, store), `${slug} with rows`).toBe(false);
      expect(gate(slug, 0, store), `${slug} empty`).toBe(false); // …and still no.
    }
  });

  it("does nothing on an unresolved or bogus slug", () => {
    const store = fakeStorage();
    plant(store, ALL_IDS);
    for (const slug of [null, undefined, "", "not-a-real-tenant"]) {
      expect(gate(slug, 12, store), String(slug)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The manifest, and that every page is wired to it
// ---------------------------------------------------------------------------

describe("the page manifest", () => {
  it("names exactly the seven pages that carry a teaching state, in sidebar order", () => {
    expect(ALL_IDS).toEqual([
      "vehicles",
      "customers",
      "rentals",
      "agreements",
      "insurances",
      "invoices",
      "payments",
    ]);
    for (const page of EMPTY_STATE_PAGES) {
      expect(page.href, page.id).toBe(`/${page.id}`);
      expect(page.label.length, page.id).toBeGreaterThan(0);
    }
    expect(isEmptyStatePageId("vehicles")).toBe(true);
    expect(isEmptyStatePageId("dashboard")).toBe(false);
    expect(isEmptyStatePageId(42)).toBe(false);
  });

  /** Where each page id is consumed. Rentals teaches from the v2 list component. */
  const SOURCES: Record<EmptyStatePageId, string> = {
    vehicles: "app/(dashboard)/vehicles/page.tsx",
    customers: "app/(dashboard)/customers/page.tsx",
    rentals: "components/rentals-v2/rentals-list-v2.tsx",
    agreements: "app/(dashboard)/agreements/page.tsx",
    insurances: "app/(dashboard)/insurances/page.tsx",
    invoices: "app/(dashboard)/invoices/page.tsx",
    payments: "app/(dashboard)/payments/page.tsx",
  };

  for (const id of ALL_IDS) {
    it(`${id}: the page reads its own id through the hook, beside the slug gate`, () => {
      const src = readPortalSource(SOURCES[id]);
      // The id is pinned to the file. A page reading the wrong id would toggle
      // the wrong page from /dev and never its own.
      expect(src).toContain(`useForcedEmptyState("${id}")`);
      expect(src).toContain("isLeanTenant(");
    });
  }

  it("the hook subscribes rather than reading once, so a toggle needs no reload", () => {
    const hook = readPortalSource("hooks/use-forced-empty-state.ts");
    expect(hook).toContain("useSyncExternalStore(");
    expect(hook).toContain("subscribeDevOverrides");
    // Server snapshot is the constant `false` — the flag lives in the browser.
    expect(hook).toMatch(/\(\) => false,?\s*\n?\s*\)/);
  });

  it("the /dev page renders the control, below its two actions and above the status line", () => {
    // The hookup is two lines in a file another surface owns — an import and
    // one JSX element — so pin both, and pin the placement: secondary to the
    // two main actions, never above them.
    const page = readPortalSource("components/dev/dev-page.tsx");
    expect(page).toContain("import { EmptyStatePreview } from '@/components/dev/empty-state-preview';");
    expect(page).toContain("<EmptyStatePreview />");
    const at = page.indexOf("<EmptyStatePreview />");
    expect(at).toBeGreaterThan(page.indexOf("{sections.map("));
    expect(at).toBeLessThan(page.indexOf("{status && ("));
  });

  it("every guard is the literal NODE_ENV comparison, development branch first", () => {
    // The fold contract from the module header: a bundler constant-folds the
    // literal but does not inline a helper, so an `isDev()` indirection would
    // leave the storage reads in the production bundle.
    const src = readPortalSource("lib/dev-overrides.ts");
    const guards = src.match(/if \(process\.env\.NODE_ENV === "development"\)/g) ?? [];
    // reader-raw, reader-set, reader-page, set-one, set-all, subscribe.
    expect(guards.length).toBeGreaterThanOrEqual(6);
    expect(src).not.toMatch(/process\.env\.NODE_ENV !== "development"/);
    expect(src).not.toMatch(/const isDev\b|function isDev\b|devOverridesEnabled/);
  });
});
