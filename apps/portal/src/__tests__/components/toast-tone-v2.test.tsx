/**
 * The failed-save toast, v1 and v2 (northwind).
 *
 * Team lead, Sep 20 2026: the inline field notes and the save bar were toned to
 * a faded red earlier; the toast was missed and still painted the solid
 * `bg-destructive` fill with white text, so a refused save shouted from the
 * corner of the screen. The Toaster now sends v1's `destructive` through a
 * `v2Destructive` variant for v2 tenants only.
 *
 * Two things are pinned here:
 *   - v1's markup, which must not move by a character;
 *   - the v2 tone, AND its contrast, computed from the tokens in
 *     styles/v2-theme.css rather than from numbers typed into this file.
 *
 * HARNESS: `react-dom/client` + `act`, same as the other v2 settings suites.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { V2Provider } from "@/lib/v2-context";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/** Renders the Toaster for one tenant and raises one toast through it. */
function raise(v2: boolean, props: Record<string, unknown>) {
  act(() =>
    root.render(
      <V2Provider flags={v2 ? { chrome: true } : {}}>
        <Toaster />
      </V2Provider>,
    ),
  );
  act(() => {
    toast(props as never);
  });
  // Radix portals each toast into the viewport, which mounts on the first pass.
  return document.querySelector("li") as HTMLElement;
}

const classes = (el: Element | null) => (el?.className ?? "").split(/\s+/).filter(Boolean);
const refusal = { title: "Couldn't save your changes", description: "Enter your pickup address.", variant: "destructive" };

/* -------------------------------------------------------------------------- */
/* v1 is untouched                                                             */
/* -------------------------------------------------------------------------- */

describe("v1: the destructive toast is exactly what it was", () => {
  it("keeps the solid fill, the marker class, its radius and its dimmed description", () => {
    const li = raise(false, refusal);
    expect(classes(li)).toEqual(
      expect.arrayContaining(["destructive", "group", "border-destructive", "bg-destructive", "text-destructive-foreground", "rounded-lg"]),
    );
    // None of the v2 tone leaks in.
    expect(classes(li)).not.toContain("v2-toast-danger");
    expect(classes(li)).not.toContain("bg-destructive/10");
    expect(classes(li)).not.toContain("panel-ink-danger");
    expect(classes(li)).not.toContain("rounded-2xl");

    const description = Array.from(li.querySelectorAll("div")).find((d) => d.textContent === refusal.description)!;
    expect(description.className).toBe("text-sm opacity-90");

    const close = li.querySelector("[toast-close]") as HTMLElement;
    expect(classes(close)).toEqual(expect.arrayContaining(["rounded-md", "group-[.destructive]:text-red-300"]));
  });

  it("the ordinary toast is untouched too", () => {
    const li = raise(false, { title: "Saved" });
    expect(classes(li)).toEqual(expect.arrayContaining(["border-border", "bg-card", "text-card-foreground", "rounded-lg"]));
  });
});

/* -------------------------------------------------------------------------- */
/* v2 wears the faded red                                                      */
/* -------------------------------------------------------------------------- */

describe("v2: a refused save is said, not shouted", () => {
  it("is the faded tint with the readable ink, at the v2 radius, with no alarm icon", () => {
    const li = raise(true, refusal);
    expect(classes(li)).toEqual(
      expect.arrayContaining(["v2-toast-danger", "rounded-2xl", "border-transparent", "bg-destructive/10", "text-destructive", "panel-ink-danger"]),
    );
    // The solid fill, its white ink and the marker class that drives the close
    // button's red-300 are all gone.
    expect(classes(li)).not.toContain("bg-destructive");
    expect(classes(li)).not.toContain("text-destructive-foreground");
    expect(classes(li)).not.toContain("destructive");
    expect(classes(li)).not.toContain("rounded-lg");

    // The only drawing on it is the close button's ×: no warning triangle.
    const icons = li.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0].closest("[toast-close]")).not.toBeNull();

    const close = li.querySelector("[toast-close]") as HTMLElement;
    expect(classes(close)).toContain("rounded-xl");
    expect(classes(close)).not.toContain("rounded-md");
  });

  it("the reason reads at full strength, not at the dimmed 90%", () => {
    const li = raise(true, refusal);
    const description = Array.from(li.querySelectorAll("div")).find((d) => d.textContent === refusal.description)!;
    expect(description.className).toBe("text-sm opacity-100");
  });

  it("an ordinary v2 toast is left alone", () => {
    const li = raise(true, { title: "Saved" });
    expect(classes(li)).toEqual(expect.arrayContaining(["border-border", "bg-card", "text-card-foreground"]));
    expect(classes(li)).not.toContain("v2-toast-danger");
  });
});

/* -------------------------------------------------------------------------- */
/* The contrast, from the tokens themselves                                    */
/* -------------------------------------------------------------------------- */

const css = readFileSync(resolve(__dirname, "../..", "styles/v2-theme.css"), "utf8");

/** The body of the first rule with this exact selector. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

/** `--name: 357 100% 45%;` inside a rule body, as [h, s, l]. */
function token(body: string, name: string): [number, number, number] {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
  return parseHsl(match![1]);
}

function parseHsl(value: string): [number, number, number] {
  const [h, s, l] = value.trim().replace(/[%)]/g, "").replace("hsl(", "").split(/\s+/).map(Number);
  return [h, s, l];
}

/** The 8-bit colour a browser resolves the token to, rounded as one is. */
function toRgb([h, s, l]: [number, number, number]): number[] {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = light - c / 2;
  return [r + m, g + m, b + m].map((channel) => Math.round(channel * 255));
}

/** `over` laid on `under` at `alpha`. */
const composite = (over: number[], under: number[], alpha: number) =>
  over.map((channel, i) => channel * alpha + under[i] * (1 - alpha));

function contrast(a: number[], b: number[]): number {
  const relative = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((v) => {
      const channel = v / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the faded toast is readable in both modes", () => {
  // The fill is `--card` with `--destructive` laid over it at the alpha in the
  // rule, so the ink's contrast is one fixed number whatever the toast floats
  // over. Read the alpha out of the rule rather than assuming 10%.
  const toastRule = ruleBody(".v2-theme .v2-toast-danger");
  const alpha = Number(/hsl\(var\(--destructive\) \/ ([\d.]+)\)/.exec(toastRule)![1]);
  const inkOf = (prefix: string) =>
    parseHsl(/color:\s*hsl\(([^)]+)\)/.exec(ruleBody(`${prefix}.v2-theme .panel-ink-danger`))![1]);

  it("lays the tint over the card colour, not straight onto the page", () => {
    expect(toastRule).toContain("background-color: hsl(var(--card));");
    expect(alpha).toBe(0.1);
  });

  it.each([
    // #b81e26 on #fde6e7.
    { mode: "light", theme: ".v2-theme", inkPrefix: "", expected: 5.4 },
    // #ff8587 on #2e1f1f.
    { mode: "dark", theme: ".dark .v2-theme", inkPrefix: ".dark ", expected: 6.72 },
  ])("$mode: the reason measures $expected:1 on the tint", ({ theme, inkPrefix, expected }) => {
    const mode = ruleBody(theme);
    const fill = composite(toRgb(token(mode, "destructive")), toRgb(token(mode, "card")), alpha);
    const measured = contrast(toRgb(inkOf(inkPrefix)), fill);
    expect(Number(measured.toFixed(2))).toBe(expected);
    expect(measured).toBeGreaterThanOrEqual(4.5);
  });
});
