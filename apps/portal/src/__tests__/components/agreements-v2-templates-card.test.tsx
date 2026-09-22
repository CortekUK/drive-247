/**
 * Agreements v2: the "Create your template" card
 * (components/agreements-v2/create-template-card-v2.tsx).
 *
 * The card is real, and so is the featured card shell it is built from: what
 * matters is the title the team lead asked for, that a click creates, that a
 * card without the grant (or with a create already running) does nothing and
 * says why, and that it fits HeroRow's card slot (no desktop minimum height).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CREATE_TEMPLATE_BUSY_SUBTITLE,
  CREATE_TEMPLATE_DISABLED_SUBTITLE,
  CREATE_TEMPLATE_SUBTITLE,
  CreateTemplateCardV2,
} from "@/components/agreements-v2/create-template-card-v2";
import { HeroRow } from "@/components/shared/hero-chart-v2";

describe("CreateTemplateCardV2", () => {
  it('is titled "Create your template" with a one-sentence subtitle, and a click creates', () => {
    const onCreate = vi.fn();
    render(<CreateTemplateCardV2 onCreate={onCreate} />);
    const button = screen.getByRole("button", { name: /Create your template/ });
    expect(button).toHaveTextContent(CREATE_TEMPLATE_SUBTITLE);
    expect(CREATE_TEMPLATE_SUBTITLE).toMatch(/^[^.]+\.$/);
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("without the grant it is disabled, says who can create one, and never calls onCreate", () => {
    const onCreate = vi.fn();
    const { container } = render(<CreateTemplateCardV2 onCreate={onCreate} disabled />);
    const button = screen.getByRole("button", { name: /Create your template/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(CREATE_TEMPLATE_DISABLED_SUBTITLE);
    expect(button).not.toHaveTextContent(CREATE_TEMPLATE_SUBTITLE);
    fireEvent.click(button);
    expect(onCreate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-disabled="true"]')).not.toBeNull();
  });

  it("while a create runs it is busy and cannot start a second one", () => {
    const onCreate = vi.fn();
    render(<CreateTemplateCardV2 onCreate={onCreate} busy />);
    const button = screen.getByRole("button", { name: /Create your template/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent(CREATE_TEMPLATE_BUSY_SUBTITLE);
    fireEvent.click(button);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("drops the shell's desktop minimum height (HeroRow's card slot), and a caller can drop the stacked one too", () => {
    const { container, rerender } = render(<CreateTemplateCardV2 onCreate={() => {}} />);
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.tagName).toBe("SECTION");
    expect(shell.className).toContain("lg:min-h-0");
    // The stacked layout keeps the featured card's own minimum…
    expect(shell.className).toContain("min-h-[15rem]");
    // …unless the caller (the templates grid) overrides it; tailwind-merge keeps one.
    rerender(<CreateTemplateCardV2 onCreate={() => {}} className="min-h-0" />);
    const merged = (container.firstElementChild as HTMLElement).className.split(/\s+/);
    expect(merged).toContain("min-h-0");
    expect(merged).not.toContain("min-h-[15rem]");
  });

  it("sits in HeroRow's card slot as the grid item itself (no wrapper of its own)", () => {
    const { container } = render(<HeroRow chart={<div>chart</div>} card={<CreateTemplateCardV2 onCreate={() => {}} />} />);
    const slot = container.querySelector("[data-hero-card]") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.children).toHaveLength(1);
    expect(slot.firstElementChild?.tagName).toBe("SECTION");
    expect(slot.firstElementChild?.getAttribute("data-tour")).toBe("agreements-create-template");
  });
});

describe("the templates lane's v2 style tripwires", () => {
  it.each([
    "components/agreements-v2/create-template-card-v2.tsx",
    "components/agreements-v2/templates-section-v2.tsx",
    "components/agreements-v2/template-picker-v2.tsx",
  ])("%s: no muted hover wash, no dark primary wash, no slashed border-border, never names the vendor", (file) => {
    const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
    expect(src).not.toMatch(/(^|[\s"'`:])hover:bg-muted(\/\d+)?(?=[\s"'`])/);
    expect(src).not.toMatch(/dark:bg-primary\/(10|15)\b/);
    expect(src).not.toMatch(/border-border\/\d+/);
    // D3: the product talks about agreements, never the signing provider.
    expect(src).not.toMatch(/BoldSign/i);
  });
});
