/**
 * The car page's number boxes (sheet 4.6): letters and negative numbers are
 * refused with a reason and never published; plain numbers still are.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberInput } from "@/components/vehicles-v2/kit";

const box = (onChange = vi.fn()) => {
  render(<NumberInput value={50} onChange={onChange} />);
  return { input: screen.getByRole("textbox"), onChange };
};

describe("NumberInput", () => {
  it("refuses a negative number", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "-20" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Can't be less than 0");
  });

  it("never saves a lone minus sign as 0 while -20 is typed", () => {
    const { input, onChange } = box();
    for (const v of ["-", "-2", "-20"]) fireEvent.change(input, { target: { value: v } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Can't be less than 0");
  });

  it("waits on a half-typed decimal point", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "." } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ".5" } });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });

  it("refuses letters instead of saving 0", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Numbers only");
  });

  it("publishes a plain number and clears the message", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(input, { target: { value: "47.35" } });
    expect(onChange).toHaveBeenLastCalledWith(47.35);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves a single digit straight away, 0 included", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("refuses a decimal in a whole-number box, with a plain reason", () => {
    const onChange = vi.fn();
    render(<NumberInput value={700} onChange={onChange} integer />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "12.5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Whole numbers only");
  });

  it("typing 12.5 key by key ends back at the starting value, not 12", () => {
    const onChange = vi.fn();
    render(<NumberInput value={700} onChange={onChange} integer />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    for (const v of ["1", "12", "12.", "12.5"]) fireEvent.change(input, { target: { value: v } });
    expect(onChange).toHaveBeenLastCalledWith(700);
    expect(screen.getByRole("alert")).toHaveTextContent("Whole numbers only");
  });

  it("still lets a box be cleared", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
