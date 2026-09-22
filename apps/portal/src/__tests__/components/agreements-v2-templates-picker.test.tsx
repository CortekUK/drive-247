/**
 * Agreements v2: the template picker (components/agreements-v2/template-picker-v2.tsx),
 * used by the Send agreement dialog and the v2 rental's Agreement stage.
 *
 * Rendered for real. The fixture is given out of order on purpose (a
 * non-default first) so "default first" is the picker's doing, not the input's.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  TemplatePickerV2,
  matchTemplatesByNameV2,
  orderTemplatesForPickerV2,
} from "@/components/agreements-v2/template-picker-v2";
import type { AgreementTemplateV2 } from "@/lib/agreements-v2/types";

const t = (over: Partial<AgreementTemplateV2> & { id: string; name: string }): AgreementTemplateV2 => ({
  content: `<p>${over.name} wording</p>`,
  category: "standard",
  isDefault: false,
  updatedAt: null,
  ...over,
});

const TEMPLATES: AgreementTemplateV2[] = [
  t({ id: "a", name: "Airport pickup" }),
  t({ id: "g", name: "Ghulam's terms", content: "<p>Mentions airport in the body</p>" }),
  t({ id: "d", name: "Main agreement", isDefault: true }),
  t({ id: "i", name: "Installment contract", category: "installment", isDefault: true }),
];

const options = () => screen.getAllByRole("option");
const optionNames = () => options().map((o) => o.getAttribute("data-template-id"));

describe("orderTemplatesForPickerV2 / matchTemplatesByNameV2", () => {
  it("puts defaults first and keeps the given order inside each group", () => {
    expect(orderTemplatesForPickerV2(TEMPLATES).map((x) => x.id)).toEqual(["d", "i", "a", "g"]);
  });

  it("matches the name only, ignoring case and surrounding spaces", () => {
    expect(matchTemplatesByNameV2(TEMPLATES, "  AIRPORT ").map((x) => x.id)).toEqual(["a"]);
    expect(matchTemplatesByNameV2(TEMPLATES, "ghulam").map((x) => x.id)).toEqual(["g"]);
    expect(matchTemplatesByNameV2(TEMPLATES, "").map((x) => x.id)).toEqual(["a", "g", "d", "i"]);
  });
});

describe("TemplatePickerV2", () => {
  it("lists the defaults first with a Default badge; a category label only where it is not standard", () => {
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={() => {}} />);
    expect(optionNames()).toEqual(["d", "i", "a", "g"]);
    const [main, installment, airport] = options();
    expect(within(main).getByText("Default")).toBeInTheDocument();
    expect(within(main).queryByText("Standard")).toBeNull();
    expect(within(installment).getByText("Default")).toBeInTheDocument();
    expect(within(installment).getByText("Installment Plan")).toBeInTheDocument();
    expect(within(airport).queryByText("Default")).toBeNull();
  });

  it("marks the selected template, and a click picks one", () => {
    const onSelect = vi.fn();
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId="a" onSelect={onSelect} />);
    const selected = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.map((o) => o.getAttribute("data-template-id"))).toEqual(["a"]);
    fireEvent.click(options()[3]);
    expect(onSelect).toHaveBeenCalledWith("g");
  });

  it("searches by name: body text does not match, and no match offers a way back", () => {
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={() => {}} />);
    const search = screen.getByRole("searchbox", { name: "Search templates by name" });
    fireEvent.change(search, { target: { value: "airport" } });
    expect(optionNames()).toEqual(["a"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    const noMatch = screen.getByRole("status");
    expect(noMatch).toHaveTextContent(/No templates match/);
    fireEvent.click(within(noMatch).getByRole("button", { name: "Clear search" }));
    expect(optionNames()).toEqual(["d", "i", "a", "g"]);
  });

  it("keyboard: arrows move the highlight from the search field, Enter picks it", () => {
    const onSelect = vi.fn();
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={onSelect} />);
    const search = screen.getByRole("searchbox");
    const listbox = screen.getByRole("listbox", { name: "Agreement templates" });
    // Nothing selected: the first row is highlighted, and the field says so.
    expect(search.getAttribute("aria-activedescendant")).toBe(options()[0].id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(options()[2]).toHaveAttribute("data-active", "true");
    expect(search.getAttribute("aria-activedescendant")).toBe(options()[2].id);
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options()[2].id);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("i");
    // Past either end it stays put.
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("d");
  });

  it("keyboard on the list itself: Home/End jump, Space picks", () => {
    const onSelect = vi.fn();
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId="i" onSelect={onSelect} />);
    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("tabindex", "0");
    // Starts on the selected row.
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options()[1].id);
    fireEvent.keyDown(listbox, { key: "End" });
    fireEvent.keyDown(listbox, { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith("g");
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("d");
  });

  it("a new search starts on its first match", () => {
    const onSelect = vi.fn();
    render(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={onSelect} />);
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.change(search, { target: { value: "a" } });
    fireEvent.keyDown(search, { key: "Enter" });
    // "a" matches Main agreement, Installment contract, Airport pickup, Ghulam's terms: the first is the default.
    expect(onSelect).toHaveBeenLastCalledWith("d");
  });

  it('offers "Create new" only when the caller handles it', () => {
    const onCreateNew = vi.fn();
    const { rerender } = render(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /Create new/ })).toBeNull();
    rerender(<TemplatePickerV2 templates={TEMPLATES} selectedId={null} onSelect={() => {}} onCreateNew={onCreateNew} />);
    fireEvent.click(screen.getByRole("button", { name: /Create new/ }));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('with no templates: a "No templates yet" empty state whose one action is Create new', () => {
    const onCreateNew = vi.fn();
    const { rerender } = render(<TemplatePickerV2 templates={[]} selectedId={null} onSelect={() => {}} onCreateNew={onCreateNew} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "No templates yet" })).toBeInTheDocument();
    const create = screen.getAllByRole("button", { name: /Create new/ });
    expect(create).toHaveLength(1);
    fireEvent.click(create[0]);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    // Without a create handler there is nothing to press.
    rerender(<TemplatePickerV2 templates={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("heading", { name: "No templates yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
