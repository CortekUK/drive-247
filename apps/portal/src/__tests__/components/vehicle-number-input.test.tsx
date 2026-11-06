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

  it("still lets a box be cleared", () => {
    const { input, onChange } = box();
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
