/**
 * The shared unsaved-changes dialog, and the v2 Settings "Save & Leave" that
 * uses it (`app/(dashboard)/settings/page.tsx`).
 *
 * v1 callers never pass `error`, so the dialog must render exactly what it did.
 * v2 Settings passes the reason a leave-save failed, which stays on screen with
 * the dialog instead of fading with the toast.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";

const noop = () => {};

describe("UnsavedChangesDialog", () => {
  it("without an error renders only the title, the sentence and the buttons", () => {
    render(<UnsavedChangesDialog open onCancel={noop} onDiscard={noop} onSave={noop} />);
    const dialog = screen.getByRole("alertdialog");
    // Header and footer, nothing between them.
    expect(dialog.children).toHaveLength(2);
    expect(dialog.textContent).toBe(
      "Unsaved ChangesYou have unsaved changes that will be lost if you leave this page. What would you like to do?CancelDon't SaveSave & Leave",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error above the buttons while the dialog stays open", () => {
    const onSave = vi.fn();
    render(
      <UnsavedChangesDialog
        open
        onCancel={noop}
        onDiscard={noop}
        onSave={onSave}
        error={<p role="alert">Couldn&apos;t save. You don&apos;t have permission to change this.</p>}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't save. You don't have permission to change this.");
    const save = screen.getByRole("button", { name: "Save & Leave" });
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    save.click();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("v2 Settings Save & Leave", () => {
  const page = readFileSync(join(__dirname, "..", "..", "app", "(dashboard)", "settings", "page.tsx"), "utf8");
  const start = page.indexOf("const saveAllDirtyForms = useCallback(");
  const end = page.indexOf("const {\n    isDialogOpen: unsavedDialogOpen,", start);
  const body = page.slice(start, end);

  it("saves General the way the General page does: the checked tenants write before the org settings", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const v2Save = body.indexOf("await BusinessV2.saveGeneralSettingsV2({");
    const v1OrgWrite = body.indexOf("await updateSettingsAsync({");
    expect(v2Save).toBeGreaterThan(-1);
    // The v2 branch returns before the v1 order (org first) is reached.
    expect(body.slice(body.lastIndexOf("if (v2Chrome) {", v2Save), v1OrgWrite)).toMatch(/return;\s*\}\s*$/);
    expect(body).toMatch(/\.update\(patch as never\)\.eq\('id', tenant\?\.id as string\)\.select\('id'\)/);
  });

  it("keeps the failure for the dialog, and the one v2 leave dialog shows it", () => {
    expect(body).toMatch(/if \(v2Chrome\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*setV2LeaveSaveError\(err\);/);
    const shown = page.match(
      /error=\{v2LeaveSaveError \? <SettingsSaveState status="error" error=\{v2LeaveSaveError\} \/> : null\}/g,
    );
    expect(shown).toHaveLength(1);
    const dialog = page.slice(page.indexOf("<LeaveDialogV2"));
    expect(dialog.slice(0, dialog.indexOf("/>\n"))).toContain("error={v2LeaveSaveError ?");
  });
});
