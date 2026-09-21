/**
 * v2 dialogs grow from the centre.
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
 * `slide-in-from-left-1/2` and `slide-in-from-top-1/2` (and their exit pair) set
 * those variables to -50%, so the keyframe carries the centring and the only
 * visible change is opacity and scale. They are compensation, not a slide.
 *
 * jsdom does not run animations, so the classes are compiled with the real
 * Tailwind and the variables it emits are checked. The v1 kit
 * (components/ui/dialog.tsx) has always carried the same compensation, so v1
 * tenants were never affected and are not touched here.
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

const V2_DIALOGS = [
  ["components/ui-v2/dialog.tsx", "dialog-content"],
  ["components/ui-v2/alert-dialog.tsx", "alert-dialog-content"],
] as const;

describe("v2 dialogs: the centring survives the open animation", () => {
  it("the enter and exit translate variables are -50%, which is the centring itself", async () => {
    const css = await compile(
      "slide-in-from-left-1/2 slide-in-from-top-1/2 slide-out-to-left-1/2 slide-out-to-top-1/2"
    );
    expect(declarations(css, "slide-in-from-left-1\\/2")).toContain("--tw-enter-translate-x: -50%");
    expect(declarations(css, "slide-in-from-top-1\\/2")).toContain("--tw-enter-translate-y: -50%");
    expect(declarations(css, "slide-out-to-left-1\\/2")).toContain("--tw-exit-translate-x: -50%");
    expect(declarations(css, "slide-out-to-top-1\\/2")).toContain("--tw-exit-translate-y: -50%");
  });

  it("the enter keyframe really does replace the element's transform", async () => {
    // Why the compensation is needed at all: the keyframe declares a transform
    // of its own, built from those variables.
    const css = await compile("animate-in zoom-in-95");
    const keyframes = postcss.parse(css).toString();
    expect(keyframes).toContain("--tw-enter-translate-x");
    expect(keyframes).toMatch(/@keyframes enter[\s\S]*transform:\s*translate3d\(/);
  });

  it.each(V2_DIALOGS)("%s centres while it animates, both opening and closing", (file) => {
    const src = read(file);
    for (const cls of [
      "data-[state=open]:slide-in-from-left-1/2",
      "data-[state=open]:slide-in-from-top-1/2",
      "data-[state=closed]:slide-out-to-left-1/2",
      "data-[state=closed]:slide-out-to-top-1/2",
    ]) {
      expect(src).toContain(cls);
    }
    // The centring itself, and the zoom that should be the only visible motion.
    expect(src).toContain("-translate-x-1/2 -translate-y-1/2");
    expect(src).toContain("data-[state=open]:zoom-in-95");
  });

  it.each(V2_DIALOGS)("%s does not slide from an edge", (file) => {
    const src = read(file);
    // Any other slide distance would be a real slide, which is what the team
    // lead asked us to stop doing.
    const slides = src.match(/slide-(in-from|out-to)-(left|right|top|bottom)-[^\s"]+/g) ?? [];
    for (const slide of slides) expect(slide).toMatch(/-(left|top)-1\/2$/);
  });

  it("the v1 kit keeps its own compensation, so v1 tenants are unchanged", () => {
    const v1 = read("components/ui/dialog.tsx");
    expect(v1).toContain("data-[state=open]:slide-in-from-left-1/2");
    expect(v1).toContain("data-[state=open]:slide-in-from-top-[48%]");
  });
});
