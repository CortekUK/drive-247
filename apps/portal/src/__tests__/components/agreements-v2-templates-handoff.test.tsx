/**
 * Agreements v2: the hand-off in the v1 Settings template pages
 * (app/(dashboard)/settings/agreement-templates/page.tsx and edit/page.tsx).
 *
 * `useV2('agreements')` sends both routes to the Agreements tab's templates
 * (build-spec D1). Everyone else renders exactly what they did: the v2
 * Settings screens behind `useV2('chrome')`, and v1 for every other tenant.
 * The pages are rendered for real; the template hook, the v2 Settings screens
 * and the rich-text editor are stubs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const state = vi.hoisted(() => ({
  v2: { agreements: false, chrome: false } as Record<string, boolean>,
  params: new URLSearchParams(),
  hasTemplates: true,
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }));
const selection = vi.hoisted(() => ({ initializeDefault: vi.fn(), initializeCustom: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => state.params }));
vi.mock("@/lib/v2-context", () => ({ useV2: (area: string) => state.v2[area] === true }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", slug: "acme" } }) }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => {} }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => ({ settings: { pay_as_you_go_enabled: false } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-unsaved-changes-warning", () => ({
  useUnsavedChangesWarning: () => ({ isDialogOpen: false, confirmLeave: vi.fn(), saveAndLeave: vi.fn(), cancelLeave: vi.fn(), isSaving: false }),
}));
vi.mock("@/components/shared/unsaved-changes-dialog", () => ({ UnsavedChangesDialog: () => null }));
vi.mock("@/components/settings/tiptap-editor", () => ({ TipTapEditor: () => <div data-testid="v1-tiptap" /> }));
vi.mock("@/components/settings-v2/agreement-templates-v2", () => ({
  AgreementTemplatesPageV2: () => <div data-testid="settings-v2-chooser" />,
  AgreementTemplateEditorV2: () => <div data-testid="settings-v2-editor" />,
}));
vi.mock("@/hooks/use-agreement-templates", () => {
  const row = (name: string) => ({
    id: name,
    template_name: name,
    template_content: "<p>Wording</p>",
    template_category: "standard",
    is_active: name === "Default Template",
    updated_at: null,
  });
  return {
    DEFAULT_TEMPLATE_NAME: "Default Template",
    CUSTOM_TEMPLATE_NAME: "Custom Template",
    useTemplateSelection: () => ({
      defaultTemplate: state.hasTemplates ? row("Default Template") : null,
      customTemplate: state.hasTemplates ? row("Custom Template") : null,
      activeType: "default",
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      initializeDefault: selection.initializeDefault,
      isInitializingDefault: false,
      initializeCustom: selection.initializeCustom,
      isInitializingCustom: false,
      setActiveByType: vi.fn(),
      isSettingActive: false,
      resetDefault: vi.fn(),
      isResetting: false,
      clearCustom: vi.fn(),
      isClearing: false,
      updateContentAsync: vi.fn(),
      isUpdating: false,
      resetDefaultAsync: vi.fn(),
    }),
  };
});

import AgreementTemplatesPage from "@/app/(dashboard)/settings/agreement-templates/page";
import EditAgreementTemplatePage from "@/app/(dashboard)/settings/agreement-templates/edit/page";

beforeEach(() => {
  state.v2 = { agreements: false, chrome: false };
  state.params = new URLSearchParams();
  state.hasTemplates = true;
  nav.replace.mockReset();
  nav.push.mockReset();
  selection.initializeDefault.mockReset();
  selection.initializeCustom.mockReset();
});

describe.each([
  ["/settings/agreement-templates", () => <AgreementTemplatesPage />, "Agreement Templates", "settings-v2-chooser"],
  ["/settings/agreement-templates/edit", () => <EditAgreementTemplatePage />, "Edit Standard Default Template", "settings-v2-editor"],
])("%s", (_route, page, v1Heading, v2Screen) => {
  it("Agreements v2: goes to the Agreements tab's templates, and shows neither Settings screen", () => {
    state.v2 = { agreements: true, chrome: true };
    state.params = new URLSearchParams("type=custom&category=standard");
    render(page());
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/agreements?view=templates");
    expect(screen.getByRole("status")).toHaveTextContent("Opening agreement templates");
    expect(screen.queryByTestId("settings-v2-chooser")).toBeNull();
    expect(screen.queryByTestId("settings-v2-editor")).toBeNull();
    expect(screen.queryByTestId("v1-tiptap")).toBeNull();
  });

  it("v2 chrome without the agreements area: the v2 Settings screen, and no redirect", () => {
    state.v2 = { agreements: false, chrome: true };
    render(page());
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId(v2Screen)).toBeInTheDocument();
  });

  it("v1: the v1 screen, and no redirect", () => {
    render(page());
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: v1Heading })).toBeInTheDocument();
    expect(screen.queryByTestId("settings-v2-chooser")).toBeNull();
    expect(screen.queryByTestId("settings-v2-editor")).toBeNull();
    expect(screen.queryByText("Opening agreement templates")).toBeNull();
  });
});

describe("the redirect never writes", () => {
  it("the v1 chooser seeds missing template rows on mount; the v2 hand-off never reaches it", () => {
    state.hasTemplates = false;
    state.v2 = { agreements: true, chrome: true };
    render(<AgreementTemplatesPage />);
    expect(selection.initializeDefault).not.toHaveBeenCalled();
    expect(selection.initializeCustom).not.toHaveBeenCalled();
  });

  it("(control) v1 still seeds them, exactly as before", async () => {
    state.hasTemplates = false;
    render(<AgreementTemplatesPage />);
    expect(screen.getByText("Agreement Templates")).toBeInTheDocument();
    await vi.waitFor(() => expect(selection.initializeDefault).toHaveBeenCalled());
  });
});
