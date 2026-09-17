/**
 * The address field's suggestions menu, in both designs.
 *
 * The component is shared: the same file draws the address box on v1 Settings,
 * the rental pickup/return dialog and v2 Locations. So this pins BOTH — v2 gets
 * the rounded menu and the brand-tinted hover, and v1's classes stay exactly the
 * string they have always been (a grey hover, `rounded-md`, `border-border/50`).
 *
 * HARNESS: `react-dom/client` + `act`, same as business-settings-states.test.tsx
 * (the repo lacks @testing-library/dom).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-google-maps-loader", () => ({ useGoogleMapsLoader: () => ({ isLoaded: true }) }));
vi.mock("@/lib/google-places-session", () => ({
  PlacesSessionManager: class {
    getToken() {
      return undefined;
    }
    refreshToken() {}
  },
}));

import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { V2Provider } from "@/lib/v2-context";

const prediction = (placeId: string, main: string, secondary: string) => ({
  placePrediction: {
    placeId,
    mainText: { text: main },
    secondaryText: { text: secondary },
    text: { text: `${main}, ${secondary}` },
  },
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).google = {
    maps: {
      places: {
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi.fn(async () => ({
            suggestions: [prediction("p1", "12 King Street", "Leeds, UK"), prediction("p2", "12 King Road", "Bristol, UK")],
          })),
        },
      },
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as any).google;
});

/** Focus the field with an address already in it: that asks for suggestions without the 300ms debounce. */
async function openSuggestions(v2: boolean) {
  const field = <LocationAutocomplete value="12 King" onChange={() => {}} />;
  act(() => root.render(v2 ? <V2Provider flags={{ chrome: true }}>{field}</V2Provider> : field));
  const input = container.querySelector("input")!;
  await act(async () => {
    input.focus();
  });
  const menu = container.querySelector<HTMLDivElement>("div.absolute.z-50");
  if (!menu) throw new Error("no suggestions menu");
  return { menu, items: Array.from(menu.querySelectorAll("button")) };
}

describe("the address suggestions menu", () => {
  it("v1 keeps the classes it always had", async () => {
    const { menu, items } = await openSuggestions(false);
    expect(menu.className).toBe("absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto");
    expect(items).toHaveLength(2);
    expect(items[0].className).toBe(
      "group w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-start gap-2 transition-colors border-b border-border/50 last:border-0",
    );
    expect(items[0].querySelector("svg")!.getAttribute("class")).toBe(
      "lucide lucide-map-pin w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-accent-foreground/70 flex-shrink-0",
    );
    expect(items[0].textContent).toContain("12 King Street");
    expect(items[0].textContent).toContain("Leeds, UK");
  });

  it("v2 rounds the menu and hovers with the brand tint, keyboard focus included", async () => {
    const { menu, items } = await openSuggestions(true);
    expect(menu.className).toContain("rounded-xl");
    expect(menu.className).not.toContain("rounded-md");
    const item = items[0].className;
    expect(item).toContain("hover:bg-primary/10");
    expect(item).toContain("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
    // Tabbing through the list highlights the same way a pointer does.
    expect(item).toContain("focus-visible:bg-primary/10");
    expect(item).toContain("dark:focus-visible:bg-[hsl(var(--v2-hover,var(--muted)))]");
    // No grey hover, and no slash opacity on the border (it paints nothing in dark v2).
    expect(item).not.toContain("hover:bg-accent");
    expect(item).not.toContain("accent-foreground");
    expect(item).toContain("border-b border-border last:border-0");
    expect(item).not.toContain("border-border/50");
    // Same two suggestions, same text: only the dressing changed.
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain("12 King Road");
  });
});
