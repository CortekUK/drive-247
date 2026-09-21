/**
 * D6: the v2 settings column and its rows beside the floating Trax panel.
 *
 * The panel floats over the bottom-right corner (trax-panel.tsx, z-40) and
 * puts `data-trax-panel="open"` on <html> while it is open. A settings column
 * 1160px wide ran underneath it, so the panel sat over the middle of a
 * section and over Save changes. The column now stops short of the open
 * panel, and rows stack while it is too narrow for the 420px label column.
 *
 * jsdom cannot evaluate media queries, so the classes are compiled with the
 * real Tailwind (the version the portal builds with) and the CSS it emits is
 * checked: which selector and media query each rule sits behind, and the
 * value. That is what proves the change is a no-op with Trax closed and on v1
 * (which never mounts TraxPanel, so <html> never carries the attribute).
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

const TRAX_OPEN = "[html[data-trax-panel=open]_&]";

/** Compile exactly these classes with Tailwind's default screens (the portal overrides none). */
async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }], corePlugins: { preflight: false } }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

/** Every rule in the CSS as [media query or "", selector, declarations], whitespace squashed. */
function rules(css: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  postcss.parse(css).walkRules((rule) => {
    const parent = rule.parent as postcss.AtRule | undefined;
    const media = parent?.type === "atrule" ? `${parent.name} ${parent.params}` : "";
    out.push([media.replace(/\s+/g, " "), rule.selector.replace(/\s+/g, " "), rule.nodes.map(String).join("; ")]);
  });
  return out;
}

describe("SETTINGS_COLUMN_BESIDE_TRAX", () => {
  it("only animates the column, or applies while the Trax panel is open on md and up", () => {
    for (const cls of SETTINGS_COLUMN_BESIDE_TRAX.split(/\s+/)) {
      const scoped = cls.startsWith(`md:${TRAX_OPEN}:`);
      const motion = ["transition-[max-width]", "duration-200", "ease-linear", "motion-reduce:transition-none"].includes(cls);
      expect(scoped || motion, cls).toBe(true);
    }
  });

  it("compiles to a max-width behind md AND html[data-trax-panel=open]: 1160px at most, the room left of the panel, 20rem at least", async () => {
    const css = rules(await compile(SETTINGS_COLUMN_BESIDE_TRAX));
    const widths = css.filter(([, , decl]) => decl.startsWith("max-width"));
    expect(widths).toHaveLength(1);
    const [media, selector, decl] = widths[0];
    expect(media).toBe("media (min-width: 768px)");
    expect(selector.startsWith("html[data-trax-panel=open] ")).toBe(true);
    // The floating panel's width (never the expanded overlay's), plus the 1rem
    // `--trax-offset` adds, taken off the column's containing width.
    expect(decl).toBe("max-width: min(1160px, max(20rem, calc(100% - var(--trax-width,440px) - 1rem)))");
    // Nothing else changes the layout: only the transition rules remain.
    const others = css.filter(([, , d]) => !d.startsWith("max-width"));
    for (const [, , d] of others) expect(d).toMatch(/^transition-(property|duration|timing-function)/);
  });
});

describe("SettingsRow beside the Trax panel", () => {
  it("keeps its grid, and adds only rules scoped to an open Trax panel", () => {
    const { container } = render(
      <SettingsRow label="Minimum driver age">
        <input aria-label="age" />
      </SettingsRow>,
    );
    const grid = container.firstElementChild!.firstElementChild!;
    const classes = grid.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["md:grid", "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]", "md:items-center"]));
    expect(classes).toEqual(expect.arrayContaining(SETTINGS_ROW_STACKS_BESIDE_TRAX.split(" ")));
    for (const cls of SETTINGS_ROW_STACKS_BESIDE_TRAX.split(" ")) expect(cls).toContain(`:${TRAX_OPEN}:`);
  });

  it("stacks (flex, full-width children) only while the panel is open on a screen up to 1440px wide", async () => {
    const css = rules(await compile(SETTINGS_ROW_STACKS_BESIDE_TRAX));
    expect(css.map(([media, selector, decl]) => [media, selector.split(" ")[0], decl])).toEqual([
      ["media (max-width: 1440px)", "html[data-trax-panel=open]", "display: flex"],
      ["media (max-width: 1440px)", "html[data-trax-panel=open]", "align-items: stretch"],
    ]);
  });

  it("wins over the md grid when both apply (a more specific selector)", async () => {
    const css = rules(await compile(`md:grid md:items-center ${SETTINGS_ROW_STACKS_BESIDE_TRAX}`));
    const grid = css.find(([, , d]) => d === "display: grid")!;
    const stack = css.find(([, , d]) => d === "display: flex")!;
    // .md\:grid is one class; the stacking rule is `html[attr] .class`.
    expect(grid[1].split(" ")).toHaveLength(1);
    expect(stack[1].split(" ")).toHaveLength(2);
  });
});
