/**
 * Team lead, Sep 20 2026, with a screenshot of Settings → General → Driver
 * requirements: the "ID document" dropdown opens as a dark, translucent,
 * OS-looking menu on a light page.
 *
 * It was already the Radix/shadcn Select. What was wrong was its DEFAULT TONE:
 * `ui-v2`'s SelectContent and DropdownMenuContent paint a translucent panel
 * over a blur, which is right on the dark, image-led screens they were drawn
 * for and reads as an operating-system menu on a light, text-heavy Settings
 * page. Both now take `tone="surface"` — the page's own popover, border and
 * highlight tokens — and every dropdown and row menu a v2 tenant can reach on
 * Settings (and on Team, which the Settings index opens) passes it.
 *
 * Pinned three ways, because each catches a different way of losing it:
 *   1. the primitives' contract, RENDERED, in both tones. The `dark` default
 *      is half of this: it is what keeps every menu outside Settings — and
 *      every v1 tenant's markup — exactly what it was.
 *   2. one real settings control opened (Regional → Currency), so the tone is
 *      pinned on a screen rather than only on the primitive.
 *   3. a sweep of the call sites, so a dropdown ADDED to one of these screens
 *      later cannot quietly default back to the dark panel.
 *
 * Deliberately NOT swept: the Bonzah application wizard
 * (`components/settings/bonzah-onboarding/steps/`) and the two /users dialogs.
 * They are reachable on v2 but are all-v1 forms, whose v1 SelectContent is
 * already the page's own opaque `bg-popover` — not the dark panel, and not a
 * native <select> — and the codebase's own rule is that v1 and v2 parts are
 * never mixed inside one dialog.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-rental-settings", () => ({
  useRentalSettings: () => ({ hasLoaded: true, error: null, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { BusinessRegionalPanel } from "@/components/settings-v2/business-settings-states";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);

// Radix's popper measures with these; jsdom has neither, and the shared setup's
// ResizeObserver is an arrow function, which floating-ui cannot construct.
const SetupResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

/* -------------------------------------------------------------------------- */
/* 1. The primitives                                                           */
/* -------------------------------------------------------------------------- */

describe("ui-v2 SelectContent tone", () => {
  const mount = (tone?: "dark" | "surface") =>
    render(
      <Select open defaultValue="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent tone={tone}>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
  const content = () => document.querySelector('[data-slot="select-content"]');

  it("defaults to the dark panel, so every menu outside Settings is what it was", () => {
    mount();
    expect(content()?.getAttribute("data-tone")).toBe("dark");
    // The forced-dark island, its translucency, and the blur behind it.
    expect(classes(content())).toEqual(expect.arrayContaining(["dark", "bg-popover/70"]));
    expect(classes(content())).toContain("data-[tone=dark]:before:backdrop-blur-2xl");
  });

  it('tone="surface" is the page\'s own opaque popover, with no forced dark and no blur', () => {
    mount("surface");
    expect(content()?.getAttribute("data-tone")).toBe("surface");
    expect(classes(content())).toEqual(expect.arrayContaining(["border", "border-border", "bg-popover"]));
    expect(classes(content())).not.toContain("dark");
    expect(classes(content())).not.toContain("bg-popover/70");
    // The highlight and the highlighted label are left to the page's tokens
    // (light: purple bar / near-black text; dark: brand bar / ivory text), so
    // the panel must not redefine either the way the dark island does.
    expect(content()?.getAttribute("class")).not.toContain("--accent-foreground");
    expect(content()?.getAttribute("class")).not.toContain("[--v2-hover:");
  });
});

describe("ui-v2 DropdownMenuContent tone", () => {
  const mount = (tone?: "dark" | "surface") =>
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent tone={tone}>
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  const content = () => document.querySelector('[data-slot="dropdown-menu-content"]');

  it("defaults to the translucent panel, so every row menu outside Settings is what it was", () => {
    mount();
    expect(content()?.getAttribute("data-tone")).toBe("dark");
    expect(classes(content())).toContain("bg-popover/70");
    expect(classes(content())).toContain("data-[tone=dark]:before:backdrop-blur-2xl");
  });

  it('tone="surface" is the page\'s own opaque popover, with no blur', () => {
    mount("surface");
    expect(content()?.getAttribute("data-tone")).toBe("surface");
    expect(classes(content())).toEqual(expect.arrayContaining(["border", "border-border", "bg-popover"]));
    expect(classes(content())).not.toContain("bg-popover/70");
  });

  it("keeps the item highlight on --v2-hover in both tones", () => {
    // The tone changes the panel, never how an item is highlighted.
    for (const tone of ["dark", "surface"] as const) {
      mount(tone);
      expect(content()?.getAttribute("class")).toContain(
        "[&_[data-slot$=-item][data-highlighted]]:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.15))]",
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A real settings control                                                  */
/* -------------------------------------------------------------------------- */

describe("Settings → General → Regional", () => {
  const form = {
    currency_code: "USD",
    distance_unit: "miles" as const,
    timezone: "Europe/London",
  };

  it("the currency menu opens on the page's surface, not as a dark OS menu", () => {
    render(
      <BusinessRegionalPanel
        form={form as never}
        onFormChange={vi.fn()}
        savedCurrency="USD"
        isDirty={false}
        canEdit
        ready
        onRetryLoad={vi.fn()}
        onSave={vi.fn(async () => {})}
        onDiscard={vi.fn()}
      />,
    );
    const trigger = document.getElementById("v2_currency_code")!;
    act(() => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });
    const content = document.querySelector('[data-slot="select-content"]');
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-tone")).toBe("surface");
    expect(classes(content)).not.toContain("dark");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The call sites                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Files whose every dropdown is a v2 one, on a screen a v2 tenant reaches from
 * Settings. `users-table-v2` is the Team page's row menu, which the Settings
 * index links to.
 */
const V2_ONLY_FILES = [
  "components/settings-v2/business-rules-pages.tsx",
  "components/settings-v2/business-settings-states.tsx",
  "components/settings-v2/fees-deposit-v2.tsx",
  "components/settings-v2/notification-states-v2.tsx",
  "components/settings-v2/payment-modes-v2.tsx",
  "components/settings-v2/pricing-rules-v2.tsx",
  "components/settings-v2/extras-table-v2.tsx",
  "components/settings-v2/promo-codes-table-v2.tsx",
  "components/admin-v2/users-table-v2.tsx",
];

/**
 * Files that draw BOTH designs, so only the v2-aliased tag is swept: the v1
 * tag beside it must keep taking no tone at all, or v1's markup changes.
 */
const MIXED_FILES = [
  "app/(dashboard)/settings/page.tsx",
  "components/settings/extras-settings.tsx",
  "components/settings/push-notification-settings.tsx",
];

describe("every dropdown a v2 tenant reaches on Settings asks for the surface", () => {
  it.each(V2_ONLY_FILES)("%s", (file) => {
    const src = read(file);
    // Not vacuous: each of these files still has a dropdown to tone.
    expect(src).toContain('tone="surface"');
    expect(src).not.toMatch(/<SelectContent(?![^>]*\btone="surface")/);
    expect(src).not.toMatch(/<DropdownMenuContent(?![^>]*\btone="surface")/);
  });

  it.each(MIXED_FILES)("%s: the v2 tag carries the tone, the v1 tag beside it does not", (file) => {
    const src = read(file);
    expect(src).toContain('tone="surface"');
    // Every v2-aliased content tag passes it…
    expect(src).not.toMatch(/<SelectContentV2(?![^>]*\btone="surface")/);
    // …including the one handed to a shared dialog through a parts map, which
    // must be bound rather than passed straight through (v1 has no such prop).
    expect(src).not.toMatch(/SelectContent:\s*SelectContentV2\s*[,}]/);
    // The v1 tag is untouched: no tone reaches a v1 SelectContent.
    expect(src).not.toMatch(/<SelectContent\s+tone=/);
  });

  it("none of these screens renders a native <select>", () => {
    for (const file of [...V2_ONLY_FILES, ...MIXED_FILES]) {
      expect(read(file), file).not.toMatch(/<select[\s>]/);
    }
  });
});
