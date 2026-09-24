/**
 * Where the v2 leave guard, the page save bar and the breadcrumb removal are
 * wired in. The settings page is too large to mount here, so these read the
 * source; the behaviour itself is covered by use-leave-guard-v2.test.tsx,
 * leave-dialog-v2.test.tsx and settings-kit-v2.test.tsx.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("settings page (v2): the leave guard", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2End = page.indexOf("\n  return (", page.indexOf("<LeaveDialogV2", v2Start));
  const v2 = page.slice(v2Start, v2End);

  it("v1 keeps its own hook for every other tenant; v2 turns it off and uses the v2 guard", () => {
    expect(page).toContain("useUnsavedChangesWarning({ hasChanges: hasUnsavedChanges && !v2Chrome, onSave: saveAllDirtyForms });");
    expect(page).toContain("const v2LeaveGuard = useLeaveGuardV2({\n    enabled: v2Chrome,");
    expect(page).toContain("onDiscard: resetV2PageEdits,");
  });

  it("calls the guard before the v1 early returns, so the hook order never changes", () => {
    const hook = page.indexOf("useLeaveGuardV2({");
    const firstEarlyReturn = page.indexOf("if (!v2Chrome && error && !settings) {");
    expect(hook).toBeGreaterThan(-1);
    expect(firstEarlyReturn).toBeGreaterThan(hook);
  });

  it("drives dirty from registered sections, not the strict page-wide rentalFormDirty", () => {
    const start = page.indexOf("const v2PageHasEdits =");
    const decl = page.slice(start, page.indexOf(";", start));
    expect(decl).toContain("sections: v2DirtySections,");
    expect(decl).not.toContain("rentalFormDirty");
    expect(page).toContain("isDirty: v2PageHasEdits,");
  });

  it("Locations saves through the page: save and discard registered under \"locations\", clean reported on save, reset and close", () => {
    const locations = read("components/settings-v2/locations-v2.tsx");
    expect(locations).toContain(
      '  useRegisterLeaveSave(\n    pageSave && !readOnly && data.hasSettingsData ? registerSave : undefined,\n    "locations",\n    isDirty,\n    save,\n    discard,\n  );',
    );
    // Closing the page reports clean (its edits go with it).
    expect(locations).toContain("useEffect(() => () => latestDirtyChange.current?.(false), []);");
    // Save and Reset: the dirty flag is derived from the form against what is
    // saved, so it reports false once either lands.
    const settings = read("components/settings/location-settings.tsx");
    expect(settings).toContain("if (v2) onDirtyChangeV2?.(v2Dirty);");
    expect(v2).toContain("return <LocationSettings onDirtyChangeV2={setLocationsDirty} registerSave={registerV2SectionSave} />;");
  });

  it("clears Locations' unsaved flag once another page opens (v2 only, before the v1 early returns)", () => {
    // A backup: Locations reports clean on save, reset and close itself. This
    // keeps a Don't save out of it from leaving the index warning and General's
    // save bar dirty if that report is ever missed.
    const effect = "useEffect(() => {\n    if (v2Chrome && v2Page !== 'locations') setLocationsDirty(false);\n  }, [v2Chrome, v2Page]);";
    const at = page.indexOf(effect);
    expect(at).toBeGreaterThan(-1);
    expect(page.indexOf("if (!v2Chrome && error && !settings) {")).toBeGreaterThan(at);
  });

  it("saves a registered General panel once, through its own save", () => {
    expect(page).toContain("if (generalFormDirty && !(v2Chrome && v2SectionSaves.current['general-regional'])) {");
    // The booking-site colours used to register a save here too. The section
    // was removed on Sep 24 2026 (the CMS owns those colours), so on v2 nothing
    // makes the branding form dirty and the plain v1 branch is all that is left.
    expect(page).toContain("if (brandingFormDirty) {");
    expect(v2).not.toContain("booking-site-colours");
    // The regional panel (now General's first section) hands the page its save.
    const regional = v2.slice(v2.indexOf("<BusinessV2.BusinessRegionalPanel"), v2.indexOf("case 'driver-requirements':"));
    expect(regional).toMatch(/registerSave=\{registerV2SectionSave\}\s*\/>/);
  });

  it("settles every section's save before reporting, then re-reads the rental row once when several saved", () => {
    const save = page.slice(page.indexOf("const saveAllDirtyForms = useCallback("), page.indexOf("const {\n    isDialogOpen: unsavedDialogOpen,"));
    expect(save).toContain("const results = await Promise.allSettled(saves);");
    expect(save).toContain("if (v2Saves.length > 1) void refetchRentalSettings();");
    expect(save).toContain("if (failed) throw failed.reason;");
    // v1 keeps Promise.all, reached only when v2Chrome is false.
    expect(save).toMatch(/if \(v2Chrome\) \{[\s\S]*return true;\n      \}\n      await Promise\.all\(saves\);/);
  });

  it("the v2 branch has no breadcrumb, no index back-callback and no chip row", () => {
    expect(v2).toContain("<SettingsPageHeader title={pageMeta.title} description={pageMeta.description} />");
    expect(page).not.toContain("openSettingsIndex");
    expect(page).not.toContain("SETTINGS_INDEX");
    expect(v2).not.toContain("rootLabel=");
    expect(v2).not.toContain("onBack=");
    expect(v2).not.toContain("md:pt-8");
    // The permission-wait skeleton and the page wrapper share one column, 26px
    // from the top. (It no longer steps aside for the Trax panel — that
    // behaviour was reversed on 2026-09-24 so Settings matches every other v2
    // page, where the panel floats over the content. See settings-kit.tsx.)
    expect(v2.match(/<div className=\{V2_SETTINGS_PAGE_COLUMN\}>/g)).toHaveLength(2);

    /*
     * The PARTS of the column, not the whole literal.
     *
     * This pinned the exact template string and broke twice in two days, on two
     * changes that were both right and both unrelated to the leave guard this
     * suite is about: `pb-16` → `pb-6` (64px of padding sat under a sticky save
     * bar) and `min-h-full` (sticky needs a full-height container to hold the
     * bar at the bottom edge). An exact match turns every future layout tweak
     * into a failure here, so it checks what must actually hold instead.
     */
    const column = page.match(/const V2_SETTINGS_PAGE_COLUMN = `([^`]*)`/)?.[1];
    expect(column, "V2_SETTINGS_PAGE_COLUMN is a template literal").toBeTruthy();
    expect(column).toContain("max-w-[1160px]");
    expect(column).toContain("md:pt-[26px]");
    // Small bottom padding: the save bar is the column's last child.
    expect(column).toMatch(/\bpb-[0-8]\b/);
    /*
     * The beside-Trax hook must stay interpolated even though it is an EMPTY
     * string today. That is the whole reason this line is worth asserting: with
     * nothing to see in the rendered class list, dropping the interpolation
     * would be invisible until someone restored the panel behaviour and found
     * it silently disconnected.
     */
    expect(column).toContain("${SETTINGS_COLUMN_BESIDE_TRAX}");
  });

  it("v1's tab switch handlers are back to their original form", () => {
    expect(page).toContain(
      "  const handleTabDiscardAndSwitch = useCallback(() => {\n    setShowTabWarning(false);\n    if (pendingTab) {\n      setActiveTab(pendingTab);",
    );
    expect(page).toContain("      const success = await saveAllDirtyForms();\n      if (success && pendingTab) {");
  });
});

describe("the guarded router in the v2 chrome", () => {
  it("global search, Trax and the sidebar's Portal / Website switch ask before leaving", () => {
    const search = read("components/shared/layout/global-search.tsx");
    expect(search).toContain("const router = useGuardedRouter();");
    expect(search).not.toContain('import { useRouter } from "next/navigation";');
    // The panel's Open Support asks before leaving, and closes only once
    // leaving is agreed (trax-panel-leave-guard.test.tsx covers the behaviour).
    const trax = read("components/trax/trax-panel.tsx");
    expect(trax).toContain(
      "    const href = supportHref(target);\n    runThroughLeaveGuard(href, () => {\n      router.push(href);\n      closeSheet();\n    });",
    );
    expect(trax.match(/router\.push\(/g)).toHaveLength(1);
    const sidebar = read("components/shared/layout/app-sidebar-v2.tsx");
    expect(sidebar).toContain(
      "runThroughLeaveGuard(target, () => {\n        setActiveView(next);\n        router.push(target);\n      });",
    );
  });

  it("the sidebar search scene's Enter push asks before leaving", () => {
    const scene = read("components/shared/layout/sidebar-search-scene.tsx");
    expect(scene).toContain('import { useGuardedRouter } from "@/lib/leave-guard";');
    expect(scene).toContain("const router = useGuardedRouter();");
    expect(scene).not.toContain("useRouter");
    expect(scene).toContain("router.push(topHit.url);");
  });

  it("Trax's minimise and leave-full-page exits ask before leaving, and only then touch the panel", () => {
    const provider = read("components/trax/trax-provider.tsx");
    expect(provider).toContain('import { runThroughLeaveGuard } from "@/lib/leave-guard";');
    expect(provider).toContain(
      '  const minimiseToPanel = useCallback(() => {\n    const target = returnPath || "/";\n    runThroughLeaveGuard(target, () => {\n      setSheetOpen(true);\n      router.push(target);\n    });\n  }, [router, returnPath]);',
    );
    expect(provider).toContain(
      '  const leaveFullPage = useCallback(() => {\n    const target = returnPath || "/";\n    runThroughLeaveGuard(target, () => {\n      setSheetOpen(false);\n      router.push(target);\n    });\n  }, [router, returnPath]);',
    );
    // Every push in the provider is one of those two, inside the guard.
    expect(provider.match(/router\.push\(/g)).toHaveLength(2);
  });
});

describe("no breadcrumbs on the other v2 settings pages", () => {
  it.each([
    "components/settings-v2/email-templates-v2.tsx",
    "components/settings-v2/agreement-templates-v2.tsx",
    "components/blacklist-v2/global-blacklist-page-v2.tsx",
  ])("%s: header without section/rootLabel/onBack, 26px top padding", (file) => {
    const src = read(file);
    const header = src.slice(src.indexOf("<SettingsPageHeader"), src.indexOf("/>", src.indexOf("<SettingsPageHeader")));
    expect(header).not.toContain("section=");
    expect(header).not.toContain("rootLabel=");
    expect(header).not.toContain("onBack=");
    expect(src).not.toContain("md:pt-8");
    expect(src).toContain("md:pt-[26px]");
  });

  it("the full-screen template editors keep their back arrow, with a bold title", () => {
    const shell = read("components/settings-v2/template-editor-shell-v2.tsx");
    expect(shell).toContain("<IconActionButton action={{ label: backLabel, icon: ArrowLeft, onClick: onBack }} />");
    expect(shell).toContain("font-heading text-lg font-bold tracking-tight");
  });
});
