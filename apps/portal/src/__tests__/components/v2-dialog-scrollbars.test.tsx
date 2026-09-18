/**
 * No visible scrollbar inside a dialog, on v2 only.
 *
 * Team lead, Sep 18 2026, watching his own screen recording: a dialog (the
 * feedback one, and the setup one behind it) carried a native scrollbar track
 * down its right edge — "our sidebar / side scroll should not appear in any
 * dialog".
 *
 * The distinction this file exists to defend is HIDDEN vs CLIPPED. Hiding the
 * bar is two paint properties; clipping the overflow is `overflow: hidden`, and
 * that silently truncates exactly the long dialogs the rule was written for and
 * takes Page Down / End away from a keyboard user. So the rule must set the two
 * scrollbar properties and must NEVER touch `overflow` — asserted below, not
 * assumed.
 *
 * Two halves, because one test cannot see both:
 *   - the RENDER half proves the markup still offers a scroll container, and
 *     that it carries `role="dialog"`, which is the hook the CSS reaches for;
 *   - the SOURCE half proves the rule exists, stays under `.v2-theme` (so the
 *     ~56 v1 tenants are untouched), and names no Tailwind utility with a dot
 *     (that file `@apply`s utilities, so `.overflow-y-auto` as a selector is a
 *     circular dependency that 500s every page).
 *
 * jsdom has no cascade and no scrollbars, which is why the second half reads
 * the stylesheet rather than a computed style — the same approach
 * `v2-cursor-hover-polish.test.ts` takes for the cursor and hover rules.
 *
 * Verified separately in headless Chrome against the real compiled stylesheet:
 * with `.v2-theme` on <body>, every scrollable element inside a `[role=dialog]`
 * computes `scrollbar-width: none` while `scrollHeight > clientHeight` stays
 * true and `End` still scrolls it; with `.v2-theme` removed, every one of them
 * computes `auto`, and an element outside a dialog computes `auto` either way.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import {
  Dialog as V1Dialog,
  DialogContent as V1DialogContent,
  DialogTitle as V1DialogTitle,
} from "@/components/ui/dialog";
import { V2Provider } from "@/lib/v2-context";

const theme = readFileSync(
  join(__dirname, "..", "..", "styles", "v2-theme.css"),
  "utf8",
);
const css = theme.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every `selector { declarations }` pair in the stylesheet whose selector
 * mentions `needle`.
 *
 * Brace-depth aware rather than one regex: this file has `@media` blocks that
 * also carry `[role="dialog"]` selectors, and a flat `\{([^{}]*)\}` pattern
 * silently swallows the rule before one.
 */
function rulesMentioning(needle: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  let head = "";
  let depth = 0;
  let body = "";
  for (const ch of css) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) body = "";
      else body += ch;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const selector = head.trim();
        // An at-rule's body is a list of rules, not declarations, so it is
        // skipped rather than reported. Nothing this file asserts on lives
        // inside one — the scrollbar rules are all top level.
        if (!selector.startsWith("@") && selector.includes(needle)) {
          out.push({ selector, body });
        }
        head = "";
      } else {
        body += ch;
      }
    } else if (depth === 0) {
      head += ch;
    } else {
      body += ch;
    }
  }
  return out;
}

/** Split a selector LIST on its top-level commas — `:is(a, b)` is one part. */
function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/* ------------------------------- harness -------------------------------- */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe("v2 dialogs hide the scrollbar without clipping the overflow", () => {
  it("a tall dialog still renders a scroll container carrying role=dialog", () => {
    act(() => {
      root.render(
        <V2Provider flags={{ theme: true }}>
          <Dialog open>
            <DialogContent className="max-h-[60vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Send feedback to Drive247</DialogTitle>
                <DialogDescription>Tell us what is not working.</DialogDescription>
              </DialogHeader>
              {Array.from({ length: 60 }, (_, i) => (
                <p key={i}>Line {i} of a dialog far taller than the viewport.</p>
              ))}
            </DialogContent>
          </Dialog>
        </V2Provider>,
      );
    });

    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel).not.toBeNull();

    // The hook the stylesheet reaches for. Without `role="dialog"` on the
    // panel the rule below matches nothing and the bar comes back.
    expect(panel!.getAttribute("role")).toBe("dialog");

    // The overflow is still THERE: the panel scrolls, it does not clip. A
    // regression to `overflow-hidden` here would hide the bar by hiding the
    // content, which is the failure mode this whole file guards.
    expect(panel!.className).toContain("overflow-y-auto");
    expect(panel!.className).not.toContain("overflow-hidden");
    expect(panel!.className).toContain("max-h-[60vh]");
  });

  it("reaches the v1 dialog primitive too, which is what the two on the recording use", () => {
    // `feedback-dialog.tsx` and `setup-reminder-dialog.tsx` — the dialog with
    // the scrollbar and the one behind it — both render through
    // `components/ui/dialog`, not ui-v2, on a v2 tenant as much as a v1 one,
    // and both put `max-h-[85vh] overflow-y-auto` on the panel. Neither file is
    // touched by this fix, so this pins the only thing that makes that work:
    // the v1 primitive is Radix too, so it carries the same role hook.
    act(() => {
      root.render(
        <V2Provider flags={{ theme: true }}>
          <V1Dialog open>
            <V1DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
              <V1DialogTitle>Finish setting up</V1DialogTitle>
              {Array.from({ length: 40 }, (_, i) => (
                <p key={i}>Step {i}</p>
              ))}
            </V1DialogContent>
          </V1Dialog>
        </V2Provider>,
      );
    });

    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain("overflow-y-auto");
  });
});

describe("the v2-theme rule that hides them", () => {
  const dialogRules = rulesMentioning('[role="dialog"]').filter((r) =>
    /scrollbar/.test(r.selector + r.body),
  );

  it("covers the dialog element AND anything scrolling inside it", () => {
    // The scroll container is usually NOT the dialog element: the shared
    // contract puts `overflow-y-auto` on an inner body (FEATURE_DIALOG_UI.body,
    // SYSTEM_DIALOG_UI.body), and a dialog with a table inside scrolls deeper
    // still. A rule that only matched the panel would miss both.
    const selectors = dialogRules.map((r) => r.selector).join("\n");
    expect(selectors).toContain('[role="dialog"]');
    expect(selectors).toContain('[role="alertdialog"]');
    expect(selectors).toMatch(/\[role="(alert)?dialog"\]\)?\s+\*/);
  });

  it("sets both scrollbar properties and the webkit pseudo-element", () => {
    const bodies = dialogRules.map((r) => r.body).join("\n");
    expect(bodies).toMatch(/scrollbar-width:\s*none/);
    expect(bodies).toMatch(/-ms-overflow-style:\s*none/);

    const webkit = dialogRules.filter((r) =>
      r.selector.includes("::-webkit-scrollbar"),
    );
    expect(webkit.length).toBeGreaterThan(0);
    expect(webkit.map((r) => r.body).join("\n")).toMatch(/display:\s*none/);
  });

  it("never touches overflow — hiding the bar, not the content", () => {
    // Deliberately EVERY dialog rule in the file, not just the ones that
    // currently mention a scrollbar. The failure this guards is someone
    // "fixing" a stubborn bar by swapping the two paint properties for
    // `overflow: hidden`, which removes the rule from the scrollbar set and
    // would walk straight past a narrower filter.
    const everyDialogRule = [
      ...rulesMentioning('[role="dialog"]'),
      ...rulesMentioning('[role="alertdialog"]'),
    ];
    expect(everyDialogRule.length).toBeGreaterThan(0);
    for (const rule of everyDialogRule) {
      expect(rule.body).not.toMatch(/(^|[\s;])overflow(-[xy])?\s*:/);
    }
  });

  it("stays scoped to .v2-theme, so the v1 tenants keep their scrollbars", () => {
    expect(dialogRules.length).toBeGreaterThan(0);
    for (const rule of dialogRules) {
      for (const part of selectorParts(rule.selector)) {
        expect(part.startsWith(".v2-theme")).toBe(true);
      }
    }
  });

  it("names no Tailwind utility as a class selector", () => {
    // `.overflow-y-auto`-style selectors in this file are a Tailwind circular
    // dependency and take every page to a 500.
    for (const rule of dialogRules) {
      expect(rule.selector).not.toMatch(/\.(overflow|scrollbar|max-h|rounded)-/);
    }
  });
});
