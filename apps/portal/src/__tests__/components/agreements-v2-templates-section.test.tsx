/**
 * Agreements v2: the templates section (components/agreements-v2/templates-section-v2.tsx).
 *
 * The section, the create card and the picker's name search are real. The
 * templates hook is stubbed at its two hooks (its pure helpers, such as
 * `defaultTemplateFor`, are the real ones), and the editor is lane C's, so it
 * is a stub that records the props the section hands it. Supabase is stubbed
 * only for the one read the section makes itself: the tenant's company details.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { AgreementTemplateV2 } from "@/lib/agreements-v2/types";

const state = vi.hoisted(() => ({
  tenant: {
    id: "tenant-1",
    company_name: "Context Co",
    contact_email: "context@example.com",
    phone: "+1 000",
  } as Record<string, unknown> | null,
  canEdit: true,
  permissionsLoading: false,
  params: new URLSearchParams(),
  templates: [] as AgreementTemplateV2[],
  templatesLoading: false,
  templatesError: null as unknown,
  company: {
    company_name: "Northwind Rentals",
    contact_email: "desk@northwind.test",
    contact_phone: null as string | null,
    phone: "+1 555 0100",
    address: "1 Harbour Road, Portland",
  } as Record<string, unknown> | null,
  editor: null as null | Record<string, any>,
  companyCalls: [] as unknown[][],
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), remove: vi.fn() }));
const refetch = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => state.params,
  usePathname: () => "/agreements",
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: state.tenant }) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({
    canEditSettings: (tab: string) => tab === "templates" && state.canEdit,
    isLoading: state.permissionsLoading,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast }));
vi.mock("@/hooks/use-agreement-templates-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-agreement-templates-v2")>()),
  useAgreementTemplatesV2: () => ({
    templates: state.templates,
    isLoading: state.templatesLoading,
    error: state.templatesError,
    refetch,
  }),
  useAgreementTemplateMutationsV2: () => mutations,
}));
vi.mock("@/components/agreements-v2/editor/agreement-editor-v2", () => ({
  AgreementEditorV2: (props: Record<string, any>) => {
    state.editor = props;
    return props.open ? <div data-testid="editor">{props.initialName}</div> : null;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const calls: unknown[] = [table];
      state.companyCalls.push(calls);
      const b: any = {
        select: (cols: string) => (calls.push(["select", cols]), b),
        eq: (col: string, val: unknown) => (calls.push(["eq", col, val]), b),
        maybeSingle: async () => ({ data: state.company, error: null }),
      };
      return b;
    },
  },
}));

import {
  AgreementTemplatesSectionV2,
  NEW_TEMPLATE_NAME,
  SIGNATURES_SECTION_V2,
  TEMPLATES_SECTION_DESCRIPTION,
  starterContentV2,
  templatePreviewDataV2,
  withSignaturesSectionV2,
} from "@/components/agreements-v2/templates-section-v2";
import { DEFAULT_AGREEMENT_TEMPLATE } from "@/lib/default-agreement-template";
import { injectAgreementClauses } from "@/lib/agreement-injection";
import { renderAgreementHtml } from "@/lib/agreements-v2/render";

const ACK = "<p><strong>By signing below, both parties agree to the terms of this agreement.</strong></p>";
/** The built-in agreement with its underscore-line signatures section cut off (by hand: everything before its last <hr>). */
const BUILT_IN_BODY = DEFAULT_AGREEMENT_TEMPLATE.slice(0, DEFAULT_AGREEMENT_TEMPLATE.lastIndexOf("<hr>")).trimEnd();
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const tpl = (over: Partial<AgreementTemplateV2> & { id: string; name: string }): AgreementTemplateV2 => ({
  content: `<p>${over.name} wording</p>`,
  category: "standard",
  isDefault: false,
  updatedAt: "2026-09-10T12:00:00.000Z",
  ...over,
});

const MAIN = tpl({ id: "t-main", name: "Main agreement", isDefault: true, content: "<h1>Main</h1><p>Our terms.</p>" });
const AIRPORT = tpl({ id: "t-air", name: "Airport pickup" });
const BLANK = tpl({ id: "t-blank", name: "Custom Template", content: "<p></p>" });
const INSTALLMENT = tpl({ id: "t-inst", name: "Installment contract", category: "installment", isDefault: true });

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgreementTemplatesSectionV2 id="templates-root" />
    </QueryClientProvider>,
  );
}

const card = (name: string) => {
  const heading = screen.getByRole("heading", { level: 3, name });
  return heading.closest("li") as HTMLElement;
};

beforeEach(() => {
  state.tenant = { id: "tenant-1", company_name: "Context Co", contact_email: "context@example.com", phone: "+1 000" };
  state.canEdit = true;
  state.permissionsLoading = false;
  state.params = new URLSearchParams();
  state.templates = [MAIN, INSTALLMENT, AIRPORT, BLANK];
  state.templatesLoading = false;
  state.templatesError = null;
  state.company = {
    company_name: "Northwind Rentals",
    contact_email: "desk@northwind.test",
    contact_phone: null,
    phone: "+1 555 0100",
    address: "1 Harbour Road, Portland",
  };
  state.editor = null;
  state.companyCalls = [];
  nav.replace.mockReset();
  nav.push.mockReset();
  mutations.create.mockReset();
  mutations.update.mockReset();
  mutations.setDefault.mockReset();
  mutations.remove.mockReset();
  refetch.mockReset();
  toast.mockReset();
  (Element.prototype as any).scrollIntoView = vi.fn();
});

/* -------------------------------------------------------------------------- */

describe("templatePreviewDataV2 / starterContentV2", () => {
  it("fills the company variables with the tenant's real details and everything else with samples", () => {
    const data = templatePreviewDataV2(
      { company_name: "Bob & Sons <Cars>", contact_email: "hi@bob.test", contact_phone: null, phone: "+44 1", address: "" },
      new Date(2026, 8, 21, 12),
    );
    // Real company details, escaped (values are inserted as HTML).
    expect(data.company_name).toBe("Bob &amp; Sons &lt;Cars&gt;");
    expect(data.tenant_name).toBe("Bob &amp; Sons &lt;Cars&gt;");
    expect(data.company_email).toBe("hi@bob.test");
    // contact_phone, else phone: /api/esign's rule.
    expect(data.company_phone).toBe("+44 1");
    // Not filled in: blank, as the sent agreement prints it, never the sample address.
    expect(data.company_address).toBe("");
    expect(data.agreement_date).toBe("September 21, 2026");
    // No customer yet: the catalogue's sample recipient and sample rental data.
    expect(data.customer_name).toBe("John Smith");
    expect(data.vehicle_make).toBeTruthy();
    expect(Object.values(data)).not.toContain("Acme Car Rentals");
  });

  it("prefers contact_phone over phone", () => {
    expect(templatePreviewDataV2({ company_name: "X", contact_phone: "+1 222", phone: "+1 333" }).company_phone).toBe("+1 222");
  });

  it("a new template starts from the current standard default, else the built-in agreement, and ends with the signatures", () => {
    expect(starterContentV2([AIRPORT, INSTALLMENT, MAIN])).toBe(
      `${MAIN.content}\n\n${ACK}\n<hr>\n${SIGNATURES_SECTION_V2}\n`,
    );
    // The installment default is not the standard one; the built-in's own
    // underscore-line signatures section gives way to the fields.
    const builtIn = `${BUILT_IN_BODY}\n\n<hr>\n${SIGNATURES_SECTION_V2}\n`;
    expect(starterContentV2([AIRPORT, INSTALLMENT])).toBe(builtIn);
    // A default with no wording is no starter.
    expect(starterContentV2([{ ...MAIN, content: "<p> </p>" }])).toBe(builtIn);
  });
});

describe("withSignaturesSectionV2", () => {
  it("the section: the company block, then the customer block, each signer field exactly once", () => {
    expect(SIGNATURES_SECTION_V2.indexOf("FOR THE COMPANY")).toBeGreaterThan(-1);
    expect(SIGNATURES_SECTION_V2.indexOf("FOR THE COMPANY")).toBeLessThan(SIGNATURES_SECTION_V2.indexOf("FOR THE CUSTOMER"));
    expect(SIGNATURES_SECTION_V2.indexOf("{{@sig1}}")).toBeGreaterThan(SIGNATURES_SECTION_V2.indexOf("FOR THE CUSTOMER"));
    expect(count(SIGNATURES_SECTION_V2, "{{@sig1}}")).toBe(1);
    expect(count(SIGNATURES_SECTION_V2, "{{@date1}}")).toBe(1);
    expect(count(SIGNATURES_SECTION_V2, "{{@init1}}")).toBe(0);
  });

  it("replaces the built-in's underscore lines, even after an editor dropped its empty paragraph and newlines", () => {
    const result = withSignaturesSectionV2(DEFAULT_AGREEMENT_TEMPLATE);
    expect(result).not.toContain("Customer Signature:");
    expect(result).not.toContain("Authorized Signature:");
    expect(result).toContain("{{terms_and_conditions}}");
    // It already says "By signing below", so no second sign-off line.
    expect(count(result, "By signing below")).toBe(1);
    expect(count(result, "{{@sig1}}")).toBe(1);

    const roundTripped = DEFAULT_AGREEMENT_TEMPLATE.replace("<p>&nbsp;</p>", "<p></p>").replace(/\n/g, "");
    const again = withSignaturesSectionV2(roundTripped);
    expect(again).not.toContain("Customer Signature:");
    expect(count(again, "{{@sig1}}")).toBe(1);
  });

  it("never touches wording after the built-in's signatures, and never places a field twice", () => {
    const withAppendix = `${DEFAULT_AGREEMENT_TEMPLATE}<p>Appendix A: fuel policy</p>`;
    const appended = withSignaturesSectionV2(withAppendix);
    expect(appended.startsWith(withAppendix.trimEnd())).toBe(true);
    expect(appended).toContain("Appendix A: fuel policy");
    expect(count(appended, "{{@sig1}}")).toBe(1);

    const signed = "<p>Terms.</p><p>Sign here: {{@sig1}}</p>";
    expect(withSignaturesSectionV2(signed)).toBe(signed);
    const initialsOnly = "<p>Terms.</p><p>Initial: {{@init1}}</p>";
    expect(withSignaturesSectionV2(initialsOnly)).toBe(initialsOnly);
    expect(withSignaturesSectionV2("")).toBe(`${ACK}\n<hr>\n${SIGNATURES_SECTION_V2}\n`);
  });

  it("clauses injected at send time land above the signatures, never between the two blocks", () => {
    const injected = injectAgreementClauses(withSignaturesSectionV2("<h1>Agreement</h1><p>Our terms.</p>"), {
      hasMileage: false,
      hasTerms: true,
      hasBonzahAddendum: true,
      hasDepositClause: false,
      hasHandoverTimes: false,
    });
    const company = injected.indexOf("FOR THE COMPANY");
    expect(injected.indexOf("{{terms_and_conditions}}")).toBeGreaterThan(-1);
    expect(injected.indexOf("{{terms_and_conditions}}")).toBeLessThan(injected.indexOf("By signing below"));
    expect(injected.indexOf("{{bonzah_insurance_addendum}}")).toBeGreaterThan(-1);
    expect(injected.indexOf("{{bonzah_insurance_addendum}}")).toBeLessThan(company);
  });

  it("rendered for sending, unfilled company lines drop out and the signer fields survive untouched", () => {
    const html = renderAgreementHtml(
      SIGNATURES_SECTION_V2,
      templatePreviewDataV2({ company_name: "Northwind Rentals" }, new Date(2026, 8, 21, 12)),
      { mode: "send" },
    );
    expect(html).toContain("<p><strong>Company:</strong> Northwind Rentals</p>");
    expect(html).toContain("<p><strong>Date:</strong> September 21, 2026</p>");
    expect(html).not.toContain("<strong>Title:</strong>");
    expect(html).not.toContain("<p><strong>Signature:</strong> </p>");
    expect(html).toContain("<p><strong>Signature:</strong> {{@sig1}}</p>");
    expect(html).toContain("<p><strong>Date signed:</strong> {{@date1}}</p>");
  });
});

describe("AgreementTemplatesSectionV2: the list", () => {
  it('is headed "Templates" and says what the default is for', () => {
    renderSection();
    expect(screen.getByRole("heading", { level: 2, name: "Templates" })).toBeInTheDocument();
    expect(screen.getByText(TEMPLATES_SECTION_DESCRIPTION)).toBeInTheDocument();
    expect(TEMPLATES_SECTION_DESCRIPTION).toBe("Your default template is the one sent from rentals.");
    expect(document.getElementById("templates-root")).not.toBeNull();
  });

  it("shows every template in one list, and no second create card (it sits beside the graph)", () => {
    renderSection();
    const list = screen.getByRole("list", { name: "Agreement templates" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-template-id"))).toEqual(["t-main", "t-inst", "t-air", "t-blank"]);
    expect(within(list).queryByText("Create your template")).toBeNull();
    expect(screen.queryByText(/Shared with me|Created by me/)).toBeNull();
  });

  it("marks the defaults, labels only non-standard categories, and shows when each was updated", () => {
    renderSection();
    expect(within(card("Main agreement")).getByText("Default")).toBeInTheDocument();
    expect(within(card("Main agreement")).queryByText("Standard")).toBeNull();
    expect(within(card("Installment contract")).getByText("Default")).toBeInTheDocument();
    expect(within(card("Installment contract")).getByText("Installment Plan")).toBeInTheDocument();
    expect(within(card("Airport pickup")).queryByText("Default")).toBeNull();
    expect(within(card("Airport pickup")).getByText("Updated Sep 10, 2026")).toBeInTheDocument();
  });

  it("Edit on every card; Set as default only on templates that are not the default and have wording", () => {
    renderSection();
    for (const name of ["Main agreement", "Installment contract", "Airport pickup", "Custom Template"]) {
      expect(within(card(name)).getByRole("button", { name: `Edit ${name}` })).toBeInTheDocument();
    }
    expect(within(card("Main agreement")).queryByRole("button", { name: /Set .* as default/ })).toBeNull();
    expect(within(card("Installment contract")).queryByRole("button", { name: /Set .* as default/ })).toBeNull();
    expect(within(card("Custom Template")).queryByRole("button", { name: /Set .* as default/ })).toBeNull();
    expect(within(card("Airport pickup")).getByRole("button", { name: "Set Airport pickup as default" })).toBeInTheDocument();
  });

  it("searches by name, with a no-match state that clears", () => {
    renderSection();
    const search = screen.getByRole("searchbox", { name: "Search templates by name" });
    fireEvent.change(search, { target: { value: "AIRPORT" } });
    const items = within(screen.getByRole("list", { name: "Agreement templates" })).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-template-id"))).toEqual(["t-air"]);
    // Wording is not searched: "terms" appears only in Main's body.
    fireEvent.change(search, { target: { value: "terms" } });
    expect(screen.queryByRole("list", { name: "Agreement templates" })).toBeNull();
    const noMatch = screen.getByRole("status");
    expect(noMatch).toHaveTextContent(/No templates match/);
    fireEvent.click(within(noMatch).getByRole("button", { name: "Clear search" }));
    // All four templates are back (the list holds templates only; the create card sits beside the graph).
    expect(within(screen.getByRole("list", { name: "Agreement templates" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it('with no templates: a "No templates yet" empty state whose action creates one from the built-in', async () => {
    state.templates = [];
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: NEW_TEMPLATE_NAME, content: "<p>x</p>" }));
    renderSection();
    expect(screen.getByRole("heading", { name: "No templates yet" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create your template" }));
    await waitFor(() => expect(mutations.create).toHaveBeenCalledTimes(1));
    expect(mutations.create).toHaveBeenCalledWith({
      name: NEW_TEMPLATE_NAME,
      content: `${BUILT_IN_BODY}\n\n<hr>\n${SIGNATURES_SECTION_V2}\n`,
    });
  });

  it("loading, and a failed read with a retry", () => {
    state.templatesLoading = true;
    const { unmount } = renderSection();
    expect(screen.getByRole("status", { name: "" }).getAttribute("data-settings-state")).toBe("loading");
    expect(screen.queryByRole("list", { name: "Agreement templates" })).toBeNull();
    unmount();

    state.templatesLoading = false;
    state.templates = [];
    state.templatesError = { message: "Failed to fetch" };
    renderSection();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your templates");
    fireEvent.click(within(alert).getByRole("button", { name: "Try loading your templates again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("read only: the list without any edit action, and a view-only notice", () => {
    state.canEdit = false;
    renderSection();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Main agreement" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /as default/ })).toBeNull();
    expect(screen.queryByText("Create your template")).toBeNull();
  });
});

describe("AgreementTemplatesSectionV2: delete", () => {
  it("every non-default template has Delete; it asks first, then removes that one", async () => {
    mutations.remove.mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete Airport pickup" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Delete “Airport pickup”\?/);
    expect(mutations.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith("t-air"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Template deleted" })));
  });

  it("the default's Delete is disabled and says why — rentals send it", () => {
    renderSection();
    const del = screen.getByRole("button", { name: "Delete Main agreement" });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", expect.stringMatching(/default template can.t be deleted/i));
  });

  it("Cancel deletes nothing", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete Airport pickup" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(mutations.remove).not.toHaveBeenCalled();
  });

  it("a failed delete is said", async () => {
    mutations.remove.mockRejectedValue(new Error("That template could not be deleted."));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete Airport pickup" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete template" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not delete the template", variant: "destructive" })),
    );
  });

  it("read-only users get no Delete", () => {
    state.canEdit = false;
    renderSection();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });
});

describe("AgreementTemplatesSectionV2: set as default", () => {
  it("asks first, names what changes, and only then calls setDefault", async () => {
    mutations.setDefault.mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set Airport pickup as default" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Make “Airport pickup” the default?");
    expect(dialog).toHaveTextContent("It becomes the agreement sent from rentals.");
    expect(dialog).toHaveTextContent("“Main agreement” stays in your templates, no longer the default.");
    expect(mutations.setDefault).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as default" }));
    await waitFor(() => expect(mutations.setDefault).toHaveBeenCalledWith("t-air"));
    expect(mutations.setDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Default template changed" })));
  });

  it("Cancel changes nothing", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set Airport pickup as default" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutations.setDefault).not.toHaveBeenCalled();
  });

  it("a failure is said, not swallowed", async () => {
    mutations.setDefault.mockRejectedValue(new Error("That template was not found."));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set Airport pickup as default" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Set as default" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not change the default", description: "That template was not found.", variant: "destructive" }),
      ),
    );
  });
});

describe("AgreementTemplatesSectionV2: the editor", () => {
  it("Edit opens the template editor on the saved row, previewing with the tenant's real company details", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    expect(screen.getByTestId("editor")).toHaveTextContent("Airport pickup");
    const props = state.editor!;
    expect(props.open).toBe(true);
    expect(props.mode).toBe("template");
    expect(props.nameEditable).toBe(true);
    expect(props.saveLabel).toBe("Save template");
    expect(props.initialName).toBe("Airport pickup");
    expect(props.initialContent).toBe(AIRPORT.content);
    // Once the company read answers, the preview carries the tenant's details.
    await waitFor(() => expect(state.editor!.previewData.company_name).toBe("Northwind Rentals"));
    expect(state.editor!.previewData.company_email).toBe("desk@northwind.test");
    expect(state.editor!.previewData.company_phone).toBe("+1 555 0100");
    expect(state.editor!.previewData.company_address).toBe("1 Harbour Road, Portland");
    expect(state.editor!.previewData.customer_name).toBe("John Smith");
    // That read is the tenant's own row, by id.
    const read = state.companyCalls.find((c) => c[0] === "tenants")!;
    expect(read).toContainEqual(["select", "company_name, contact_email, contact_phone, phone, address"]);
    expect(read).toContainEqual(["eq", "id", "tenant-1"]);
  });

  it("before the company read answers, TenantContext's details stand in (never the sample company)", () => {
    state.company = null;
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    expect(state.editor!.previewData.company_name).toBe("Context Co");
    expect(state.editor!.previewData.company_email).toBe("context@example.com");
    expect(state.editor!.previewData.company_phone).toBe("+1 000");
  });

  it("Save updates that template (name and content) and closes the editor", async () => {
    mutations.update.mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    await act(async () => {
      await state.editor!.onSave("<p>New wording {{@sig1}}</p>", "Airport pickup v2");
    });
    expect(mutations.update).toHaveBeenCalledWith("t-air", { content: "<p>New wording {{@sig1}}</p>", name: "Airport pickup v2" });
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Template saved" }));
  });

  it("a failed save says why, rejects so the editor keeps the edits, and stays open", async () => {
    mutations.update.mockRejectedValue(new Error('A template named "Main agreement" already exists.'));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    let rejected: unknown = null;
    await act(async () => {
      await state.editor!.onSave("<p>x</p>", "Main agreement").catch((e: unknown) => {
        rejected = e;
      });
    });
    expect(rejected).toBeInstanceOf(Error);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not save the template", description: 'A template named "Main agreement" already exists.' }),
    );
  });

  it("a template with no wording is not saved", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Main agreement" }));
    let rejected = false;
    await act(async () => {
      await state.editor!.onSave("<p>  </p>", "Main agreement").catch(() => {
        rejected = true;
      });
    });
    expect(rejected).toBe(true);
    expect(mutations.update).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("Create your template makes an untitled standard template from the default's wording, then edits it", async () => {
    const starter = `${MAIN.content}\n\n${ACK}\n<hr>\n${SIGNATURES_SECTION_V2}\n`;
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: "Untitled agreement (2)", content: starter }));
    // Started the way the card beside the graph starts it.
    state.params = new URLSearchParams("view=templates&new=1");
    renderSection();
    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("Untitled agreement (2)"));
    expect(mutations.create).toHaveBeenCalledTimes(1);
    expect(mutations.create).toHaveBeenCalledWith({ name: "Untitled agreement", content: starter });
    // The editor opens on what was stored, under the name the hook gave it.
    expect(state.editor!.initialContent).toBe(starter);
    // Saving it updates the row that was created.
    mutations.update.mockResolvedValue(undefined);
    await act(async () => {
      await state.editor!.onSave("<p>Mine</p>", "Weekend terms");
    });
    expect(mutations.update).toHaveBeenCalledWith("t-new", { content: "<p>Mine</p>", name: "Weekend terms" });
  });

  it("a failed create is said, and opens nothing", async () => {
    mutations.create.mockRejectedValue(new Error("No tenant is loaded."));
    state.params = new URLSearchParams("view=templates&new=1");
    renderSection();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not create the template" })));
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("Close closes the editor without saving", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    act(() => state.editor!.onClose());
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(mutations.update).not.toHaveBeenCalled();
  });
});

describe("AgreementTemplatesSectionV2: a new template closed without saving", () => {
  const createNew = async () => {
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: NEW_TEMPLATE_NAME, content: MAIN.content }));
    mutations.remove.mockResolvedValue(undefined);
    state.params = new URLSearchParams("view=templates&new=1");
    const utils = renderSection();
    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    return utils;
  };

  it("Cancel / Escape on a never-saved new template deletes the row it made", async () => {
    await createNew();
    await act(async () => state.editor!.onClose());
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(mutations.remove).toHaveBeenCalledTimes(1);
    expect(mutations.remove).toHaveBeenCalledWith("t-new");
    expect(toast).not.toHaveBeenCalled();
  });

  it("saved once, it is kept: save, then close, deletes nothing", async () => {
    await createNew();
    mutations.update.mockResolvedValue(undefined);
    const onClose = state.editor!.onClose;
    await act(async () => {
      await state.editor!.onSave("<p>Mine {{@sig1}}</p>", "Weekend terms");
    });
    // The editor calls the close it was rendered with once the save resolves.
    await act(async () => onClose());
    expect(mutations.update).toHaveBeenCalledWith("t-new", { content: "<p>Mine {{@sig1}}</p>", name: "Weekend terms" });
    expect(mutations.remove).not.toHaveBeenCalled();
  });

  it("a failed save, then Cancel, still cleans up", async () => {
    await createNew();
    mutations.update.mockRejectedValue(new Error("Network down"));
    await act(async () => {
      await state.editor!.onSave("<p>x</p>", "X").catch(() => {});
    });
    await act(async () => state.editor!.onClose());
    expect(mutations.remove).toHaveBeenCalledWith("t-new");
  });

  it("closing the editor on an existing template deletes nothing", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    await act(async () => state.editor!.onClose());
    expect(mutations.remove).not.toHaveBeenCalled();
  });

  it("a failed clean-up is only logged, never a toast", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createNew();
    mutations.remove.mockRejectedValue(new Error("offline"));
    await act(async () => state.editor!.onClose());
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaving the page with a never-saved new template open deletes it too, once", async () => {
    const { unmount } = await createNew();
    unmount();
    await Promise.resolve();
    expect(mutations.remove).toHaveBeenCalledTimes(1);
    expect(mutations.remove).toHaveBeenCalledWith("t-new");
  });
});

describe("AgreementTemplatesSectionV2: the default's editor says what saving does", () => {
  it("passes isDefaultTemplate for the default, and not for another template", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit Main agreement" }));
    expect(state.editor!.isDefaultTemplate).toBe(true);
    act(() => state.editor!.onClose());
    fireEvent.click(screen.getByRole("button", { name: "Edit Airport pickup" }));
    expect(state.editor!.isDefaultTemplate).toBe(false);
  });
});

describe("AgreementTemplatesSectionV2: the URL", () => {
  it("?view=templates scrolls the section into view once, and not again when new comes off the URL", async () => {
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    state.params = new URLSearchParams("view=templates");
    const { rerender } = renderSection();
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    // Adding then removing ?new is not a new visit.
    state.params = new URLSearchParams("view=templates&new=1");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    state.params = new URLSearchParams("view=templates");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    await Promise.resolve();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("?new=1 starts one create and takes new off the URL, keeping the rest", async () => {
    state.params = new URLSearchParams("view=templates&new=1");
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: NEW_TEMPLATE_NAME, content: MAIN.content }));
    const { rerender } = renderSection();
    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    expect(nav.replace).toHaveBeenCalledWith("/agreements?view=templates", { scroll: false });
    // A re-render with the URL not yet updated must not create a second one.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    await Promise.resolve();
    expect(mutations.create).toHaveBeenCalledTimes(1);
  });

  it("closing the editor while ?new=1 is still in the URL does not create again", async () => {
    // The mocked URL never loses `new`, as when the replace has not landed yet.
    state.params = new URLSearchParams("view=templates&new=1");
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: NEW_TEMPLATE_NAME, content: MAIN.content }));
    renderSection();
    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    act(() => state.editor!.onClose());
    expect(screen.queryByTestId("editor")).toBeNull();
    await Promise.resolve();
    expect(mutations.create).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("?new=1 waits for the templates, so the starter is the tenant's default", async () => {
    state.params = new URLSearchParams("new=1");
    state.templatesLoading = true;
    state.templates = [];
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 />
      </QueryClientProvider>,
    );
    expect(mutations.create).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    state.templatesLoading = false;
    state.templates = [MAIN];
    mutations.create.mockResolvedValue(tpl({ id: "t-new", name: NEW_TEMPLATE_NAME, content: MAIN.content }));
    view.rerender(
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({
        name: NEW_TEMPLATE_NAME,
        content: `${MAIN.content}\n\n${ACK}\n<hr>\n${SIGNATURES_SECTION_V2}\n`,
      }),
    );
    expect(nav.replace).toHaveBeenCalledWith("/agreements", { scroll: false });
  });

  it("?new=1 for someone without the grant creates nothing, and still clears the URL", async () => {
    state.canEdit = false;
    state.params = new URLSearchParams("view=templates&new=1");
    renderSection();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/agreements?view=templates", { scroll: false }));
    expect(mutations.create).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("?view=templates scrolls the section into view once it has loaded, once", () => {
    state.params = new URLSearchParams("view=templates");
    state.templatesLoading = true;
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    const scroll = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    expect(scroll).not.toHaveBeenCalled();
    state.templatesLoading = false;
    view.rerender(
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("templates-root"));
    view.rerender(
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 id="templates-root" />
      </QueryClientProvider>,
    );
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("a reload of the list after the scroll does not scroll again", () => {
    state.params = new URLSearchParams("view=templates");
    const client = new QueryClient();
    const ui = () => (
      <QueryClientProvider client={client}>
        <AgreementTemplatesSectionV2 />
      </QueryClientProvider>
    );
    const view = render(ui());
    const scroll = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    expect(scroll).toHaveBeenCalledTimes(1);
    state.templatesLoading = true;
    view.rerender(ui());
    state.templatesLoading = false;
    view.rerender(ui());
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("without ?view=templates it never scrolls", () => {
    renderSection();
    expect(Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
