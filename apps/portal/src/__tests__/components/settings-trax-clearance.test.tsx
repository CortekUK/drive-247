/**
 * D6 REVERSED: the v2 settings column no longer reacts to the Trax panel.
 *
 * This suite used to prove the opposite. The panel floats over the
 * bottom-right corner (trax-panel.tsx, z-40) and puts `data-trax-panel="open"`
 * on <html> while it is open; a 1160px settings column ran underneath it, so
 * the column was made to stop short of the panel and its rows to stack while
 * it was too narrow. The overlap that avoided was real — but SETTINGS WAS THE
 * ONLY PLACE THAT DID IT. On rentals, customers, vehicles and the dashboard
 * the panel simply floats over the content, so opening Trax re-laid out one
 * area of the portal and left every other one alone. That inconsistency is
 * what got reported (2026-09-24: "when the trax is open in other pages it
 * comes above them not shrink the content but in setting it reduce the size to
 * fit ... follow the same thing in setting"), and the overlap never was: the
 * operator can move or close the panel.
 *
 * So both hooks are now empty strings, and these tests hold them empty. They
 * are kept rather than deleted because the SEAM is still there — the constants
 * are interpolated into ~21 page columns — and an empty constant is invisible
 * in a rendered class list, so nothing else would notice it quietly coming
 * back or being dropped.
 *
 * The compile-the-real-CSS approach is kept too: it is the only way to prove a
 * class contributes NOTHING, since jsdom cannot evaluate media queries.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import {
  SETTINGS_COLUMN_BESIDE_TRAX,
  SETTINGS_ROW_STACKS_BESIDE_TRAX,
  SettingsRow,
} from "@/components/settings-v2/settings-kit";

const TRAX_ATTR = "data-trax-panel";

/** Compile exactly these classes with Tailwind's default screens (the portal overrides none). */
async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }], corePlugins: { preflight: false } }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("the settings column does not move for the Trax panel", () => {
  it("contributes no classes at all", () => {
    expect(SETTINGS_COLUMN_BESIDE_TRAX).toBe("");
    // `cn()` drops an empty string, so a column that interpolates this renders
    // exactly the class list it would without it.
    expect(SETTINGS_COLUMN_BESIDE_TRAX.split(/\s+/).filter(Boolean)).toEqual([]);
  });

  it("compiles to no CSS — nothing keyed on the panel, and no max-width", async () => {
    const css = await compile(SETTINGS_COLUMN_BESIDE_TRAX || "sr-only");
    // `sr-only` is a stand-in so Tailwind has something to emit; what matters
    // is that nothing panel-scoped or width-related comes out.
    expect(css).not.toContain(TRAX_ATTR);
    expect(css).not.toContain("max-width: min(1160px");
    expect(css).not.toContain("--trax-width");
  });
});

describe("a settings row keeps its grid whatever Trax is doing", () => {
  it("stacking hook contributes nothing", () => {
    expect(SETTINGS_ROW_STACKS_BESIDE_TRAX).toBe("");
  });

  it("keeps the two-column grid, with no panel-scoped rules on it", () => {
    const { container } = render(
      <SettingsRow label="Minimum driver age">
        <input aria-label="age" />
      </SettingsRow>,
    );
    const grid = container.firstElementChild!.firstElementChild!;
    const classes = grid.className.split(/\s+/);
    // The row's own layout is untouched by any of this.
    expect(classes).toEqual(
      expect.arrayContaining(["md:grid", "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]", "md:items-center"]),
    );
    // Nothing on the row reacts to the panel any more.
    expect(grid.className).not.toContain(TRAX_ATTR);
  });

  it("emits no display switch keyed on the panel", async () => {
    const css = await compile(SETTINGS_ROW_STACKS_BESIDE_TRAX || "sr-only");
    expect(css).not.toContain(TRAX_ATTR);
    expect(css).not.toContain("display: flex");
  });
});

describe("the seam is still wired, so restoring the behaviour is one edit", () => {
  it("both hooks are still exported, as strings", () => {
    // If someone deletes these, ~21 call sites lose the hook silently — an
    // empty string leaves no trace in the DOM to notice its absence by.
    expect(typeof SETTINGS_COLUMN_BESIDE_TRAX).toBe("string");
    expect(typeof SETTINGS_ROW_STACKS_BESIDE_TRAX).toBe("string");
  });
});
