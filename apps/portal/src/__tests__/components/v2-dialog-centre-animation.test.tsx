/**
 * Dialogs rise into the centre (the Trax motion, `MOTION_DIALOG` in
 * src/lib/motion.ts).
 *
 * A dialog is centred with `top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`.
 * `animate-in` then runs tailwindcss-animate's `enter` keyframe, whose `from`
 * declares its own `transform: translate3d(var(--tw-enter-translate-x,0),
 * var(--tw-enter-translate-y,0),0) scale3d(...)`. A keyframe's transform
 * replaces the element's, so unless the enter/exit translate variables are set
 * the dialog animates from `translate3d(0,0,0)` — its top-left corner on the
 * centre of the screen — and snaps back when the animation ends. On screen that
 * reads as the dialog flying in from the bottom right.
 *
 * `slide-in-from-left-1/2` keeps x at -50%, and
 * `slide-in-from-bottom-[calc(-50%_+_0.75rem)]` starts y 12px below the centred
 * position (the exit pair mirrors both). So the keyframe carries the centring
 * and the only visible change is opacity and a 12px rise — no zoom.
 *
 * jsdom does not run animations, so the classes are compiled with the real
 * Tailwind and the variables it emits are checked. v1 and v2 dialogs share the
 * one constant.
 */
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// These utilities come from tailwindcss-animate, the plugin the portal builds
// with, so the compile has to load it exactly as tailwind.config.ts does.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const animate = require("tailwindcss-animate");

async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
      corePlugins: { preflight: false },
      plugins: [animate],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

/** The declarations of the first rule whose selector contains `needle`. */
function declarations(css: string, needle: string): string {
  let found = "";
  postcss.parse(css).walkRules((rule) => {
    if (!found && rule.selector.includes(needle)) found = rule.nodes.map(String).join("; ");
  });
  return found;
}

const DIALOGS = [
  "components/ui-v2/dialog.tsx",
  "components/ui-v2/alert-dialog.tsx",
  "components/ui/dialog.tsx",
  "components/ui/alert-dialog.tsx",
] as const;

/** The MOTION_DIALOG class string, read from source. */
const motionDialog = (): string => {
  const m = read("lib/motion.ts").match(/export const MOTION_DIALOG =\s*"([^"]+)"/);
  expect(m, "MOTION_DIALOG not found in lib/motion.ts").not.toBeNull();
  return m![1];
};

describe("dialogs: the centring survives the open animation", () => {
  it("x stays at -50%, and y starts 12px below the centre", async () => {
    const css = await compile(
      "slide-in-from-left-1/2 slide-in-from-bottom-[calc(-50%_+_0.75rem)] slide-out-to-left-1/2 slide-out-to-bottom-[calc(-50%_+_0.75rem)]"
    );
    expect(declarations(css, "slide-in-from-left-1\\/2")).toContain("--tw-enter-translate-x: -50%");
    expect(declarations(css, "slide-in-from-bottom-")).toMatch(/--tw-enter-translate-y: calc\(-50% \+ 0\.75rem\)/);
    expect(declarations(css, "slide-out-to-left-1\\/2")).toContain("--tw-exit-translate-x: -50%");
    expect(declarations(css, "slide-out-to-bottom-")).toMatch(/--tw-exit-translate-y: calc\(-50% \+ 0\.75rem\)/);
  });

  it("the enter keyframe really does replace the element's transform", async () => {
    // Why the compensation is needed at all: the keyframe declares a transform
    // of its own, built from those variables.
    const css = await compile("animate-in fade-in-0");
    const keyframes = postcss.parse(css).toString();
    expect(keyframes).toContain("--tw-enter-translate-x");
    expect(keyframes).toMatch(/@keyframes enter[\s\S]*transform:\s*translate3d\(/);
  });

  it("MOTION_DIALOG centres while it animates, both opening and closing, at 200ms", () => {
    const cls = motionDialog().split(/\s+/);
    for (const token of [
      "data-[state=open]:slide-in-from-left-1/2",
      "data-[state=open]:slide-in-from-bottom-[calc(-50%_+_0.75rem)]",
      "data-[state=open]:duration-200",
      "data-[state=open]:ease-out",
      "data-[state=closed]:slide-out-to-left-1/2",
      "data-[state=closed]:slide-out-to-bottom-[calc(-50%_+_0.75rem)]",
      "data-[state=closed]:duration-200",
      "data-[state=closed]:ease-in",
      "motion-reduce:!animate-none",
    ]) {
      expect(cls, token).toContain(token);
    }
    expect(cls.filter((c) => c.includes("zoom-"))).toEqual([]);
  });

  it.each(DIALOGS)("%s is centred and takes its motion from MOTION_DIALOG", (file) => {
    const src = read(file);
    expect(src).toMatch(/-translate-x-1\/2 -translate-y-1\/2|translate-x-\[-50%\] translate-y-\[-50%\]/);
    expect(src).toContain("MOTION_DIALOG");
    // No bespoke slide or zoom left in the file itself.
    expect(src).not.toMatch(/(slide-(in-from|out-to)|zoom-(in|out))-/);
  });
});
