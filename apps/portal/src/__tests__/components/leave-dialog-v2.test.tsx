/**
 * The v2 "Save your changes?" dialog (`components/settings-v2/leave-dialog-v2.tsx`).
 * v1 keeps `UnsavedChangesDialog` and its wording (unsaved-changes-dialog.test.tsx).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeaveDialogV2 } from "@/components/settings-v2/leave-dialog-v2";

const handlers = () => ({ onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() });

describe("LeaveDialogV2", () => {
  it("asks 'Save your changes?' with Don't save and Save, and a close button to stay", () => {
    const h = handlers();
    render(<LeaveDialogV2 open canSave {...h} />);
    const dialog = screen.getByRole("alertdialog");
    expect(screen.getByRole("heading", { name: "Save your changes?" })).toBeTruthy();
    expect(dialog.textContent).toContain(
      "You have unsaved changes on this page. Save them before you go, or leave without saving.",
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Stay on this page", "Don't save", "Save"]);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("the close button and Escape both stay on the page", () => {
    const h = handlers();
    render(<LeaveDialogV2 open canSave {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Stay on this page" }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(h.onCancel).toHaveBeenCalledTimes(2);
    expect(h.onSave).not.toHaveBeenCalled();
    expect(h.onDiscard).not.toHaveBeenCalled();
  });

  it("without a save for every edit, offers only Don't save and says why", () => {
    render(<LeaveDialogV2 open canSave={false} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Don't save" })).toBeTruthy();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Some of your changes can only be saved on this page. Close this to go back and save them, or leave without saving.",
    );
  });

  it("while saving, every button waits and Escape does not close it", () => {
    const h = handlers();
    render(<LeaveDialogV2 open canSave saving {...h} />);
    const save = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Don't save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Stay on this page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("shows why the last save failed above the buttons", () => {
    render(<LeaveDialogV2 open canSave {...handlers()} error={<p role="alert">Couldn&apos;t save. Try again.</p>} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't save. Try again.");
    const save = screen.getByRole("button", { name: "Save" });
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses pill buttons from ui-v2 (no square v1 buttons)", () => {
    render(<LeaveDialogV2 open canSave {...handlers()} />);
    for (const name of ["Save", "Don't save"]) {
      expect(screen.getByRole("button", { name }).className).toContain("rounded-4xl");
    }
  });
});
