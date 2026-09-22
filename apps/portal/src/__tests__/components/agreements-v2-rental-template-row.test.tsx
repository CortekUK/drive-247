/**
 * Agreements v2 in the rental flow: the v2 Agreement stage's "Selected
 * template" row (rental-detail/agreement-template-row-v2.tsx) inside the REAL
 * stage (rental-detail/stage-agreement.tsx).
 *
 * What is pinned:
 *  - the row pre-selects the template /api/esign would send for this rental's
 *    category (standard / PAYG / installment, falling back to standard);
 *  - a send with that template selected is byte-for-byte today's request, and
 *    `templateId` travels only when the operator picked a different one;
 *  - off the agreements canary there is no row and nothing changes;
 *  - Edit is gated on canEditSettings('templates'), opens the editor in
 *    rental-template mode with THIS rental's data, and saves to the template;
 *  - Preview renders the template with this rental's details and the route's
 *    banner.
 *
 * The templates hook's pure helpers (defaultTemplateFor) are the real ones; its
 * two hooks, the picker, the preview and the editor (other lanes' modules) are
 * stubs that record what the row hands them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { AgreementTemplateV2 } from "@/lib/agreements-v2/types";

const state = vi.hoisted(() => ({
  agreementsV2: true,
  canEditTemplates: true,
  templates: [] as AgreementTemplateV2[],
  livePlan: false,
  editor: null as null | Record<string, any>,
  preview: null as null | { html: string; banner?: string },
  reads: [] as { table: string; filters: [string, unknown][] }[],
}));
const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(async () => {}), setDefault: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

const TENANT = {
  id: "tenant-1",
  company_name: "Northwind",
  currency_code: "USD",
  monthly_tier_days: 30,
  distance_unit: "miles",
  integration_bonzah: false,
  timezone: "America/New_York",
};

vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: TENANT }) }));
vi.mock("@/lib/v2-context", () => ({ useV2: (area: string) => (area === "agreements" ? state.agreementsV2 : true) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: (tab: string) => tab === "templates" && state.canEditTemplates }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast }));
vi.mock("@/hooks/use-rental-agreements", () => ({ useRentalAgreements: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/use-agreement-templates-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-agreement-templates-v2")>()),
  useAgreementTemplatesV2: () => ({ templates: state.templates, isLoading: false, error: null, refetch: vi.fn() }),
  useAgreementTemplateMutationsV2: () => mutations,
}));
vi.mock("@/components/agreements-v2/template-picker-v2", () => ({
  TemplatePickerV2: (props: { templates: AgreementTemplateV2[]; selectedId: string | null; onSelect(id: string): void }) => (
    <div data-testid="picker">
      {props.templates.map((t) => (
        <button key={t.id} type="button" aria-pressed={t.id === props.selectedId} onClick={() => props.onSelect(t.id)}>
          pick {t.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/agreements-v2/agreement-preview-v2", () => ({
  AgreementPreviewV2: (props: { html: string; banner?: string }) => {
    state.preview = props;
    return <div data-testid="preview">{props.html}</div>;
  },
}));
vi.mock("@/components/agreements-v2/editor/agreement-editor-v2", () => ({
  AgreementEditorV2: (props: Record<string, any>) => {
    state.editor = props;
    return props.open ? (
      <div data-testid="editor">
        {/* As the real editor: success closes it, a throw keeps it open. */}
        <button
          type="button"
          onClick={async () => {
            await props.onSave("<p>Edited for this tenant</p>", props.initialName);
            props.onClose();
          }}
        >
          {props.saveLabel}
        </button>
      </div>
    ) : null;
  },
}));

const ROWS: Record<string, Record<string, unknown> | null> = {
  customers: {
    id: "cust-1",
    name: "Renter One",
    email: "renter@example.com",
    phone: "+1 555 0101",
    address_city: "Portland",
    license_number: "D1234",
  },
  vehicles: {
    id: "veh-1",
    reg: "NW-123",
    make: "Tesla",
    model: "Model 3",
    year: 2024,
    daily_mileage: 100,
    weekly_mileage: null,
    monthly_mileage: null,
    excess_mileage_rate: 0.5,
  },
  tenants: { company_name: "Northwind Rentals", contact_email: "desk@northwind.test", contact_phone: "+1 555 0100", address: "1 Harbour Road" },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, filters: [] as [string, unknown][] };
      state.reads.push(read);
      const many = () => {
        if (table === "installment_plans") return { data: state.livePlan ? [{ id: "plan-1" }] : [], error: null };
        return { data: [], error: null };
      };
      const b: any = {
        select: () => b,
        eq: (col: string, val: unknown) => (read.filters.push([col, val]), b),
        in: (col: string, val: unknown) => (read.filters.push([col, val]), b),
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: ROWS[table] ?? null, error: null }),
        single: () => Promise.resolve({ data: ROWS[table] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(many()).then(ok, bad),
      };
      return b;
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  },
}));

import { StageAgreement } from "@/components/rentals-v2/rental-detail/stage-agreement";
import { pickableTemplatesV2 } from "@/components/rentals-v2/rental-detail/agreement-template-row-v2";
import { renderAgreementHtml } from "@/lib/agreements-v2/render";

const tpl = (id: string, name: string, category: AgreementTemplateV2["category"], isDefault: boolean): AgreementTemplateV2 => ({
  id,
  name,
  category,
  isDefault,
  content: `<h2>${name}</h2><p>Between {{company_name}} and {{customer_name}} for {{vehicle_reg}}.</p><p>Signature: {{@sig1}}</p>`,
  updatedAt: null,
});

const TEMPLATES = [
  tpl("tpl-std-default", "Standard A", "standard", true),
  tpl("tpl-std-other", "Standard B", "standard", false),
  tpl("tpl-payg-default", "PAYG D", "payg", true),
  tpl("tpl-inst-default", "Installment D", "installment", true),
];

const RENTAL_ID = "11111111-2222-3333-4444-555555555555";

function detail(overrides: Record<string, unknown> = {}) {
  const rental = {
    id: RENTAL_ID,
    rental_number: "RNT-1",
    status: "Active",
    start_date: "2026-09-21",
    end_date: "2026-09-24",
    pickup_time: "10:00:00",
    return_time: "10:00:00",
    customer_id: "cust-1",
    vehicle_id: "veh-1",
    tenant_id: TENANT.id,
    has_installment_plan: false,
    is_pay_as_you_go: false,
    customers: null,
    vehicles: null,
    ...overrides,
  };
  return {
    rental,
    customer: { id: "cust-1", name: "Renter One", email: "renter@example.com", phone: null } as any,
    vehicle: { id: "veh-1", reg: "NW-123", make: "Tesla", model: "Model 3" } as any,
    customerName: "Renter One",
    vehicleName: "Model 3",
    vehicleLabel: "Model 3 · NW-123",
    dateRangeShort: null,
    dateRangeLong: null,
    days: 3,
    status: { value: "Active", label: "Active", tone: "primary" },
    rentalNumber: "RNT-1",
  } as any;
}

/** The exact body the stage sent before this row existed. */
const TODAY_BODY = JSON.stringify({
  rentalId: RENTAL_ID,
  customerEmail: "renter@example.com",
  customerName: "Renter One",
  tenantId: TENANT.id,
  agreementType: "original",
});

let fetchMock: ReturnType<typeof vi.fn>;

function renderStage(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StageAgreement detail={detail(overrides)} onStage={vi.fn()} refetch={vi.fn()} />
    </QueryClientProvider>
  );
}

const selectedName = () => screen.getByTestId("selected-template-name").textContent;
const sentBodies = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/esign").map(([, init]) => String((init as RequestInit).body));

async function send() {
  fireEvent.click(screen.getByRole("button", { name: /send the agreement/i }));
  await waitFor(() => expect(sentBodies().length).toBeGreaterThan(0));
  return sentBodies().at(-1)!;
}

async function pick(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
  fireEvent.click(await screen.findByRole("button", { name: `pick ${name}` }));
  await waitFor(() => expect(screen.queryByTestId("picker")).toBeNull());
}

beforeEach(() => {
  state.agreementsV2 = true;
  state.canEditTemplates = true;
  state.templates = TEMPLATES;
  state.livePlan = false;
  state.editor = null;
  state.preview = null;
  state.reads.length = 0;
  mutations.update.mockClear();
  toast.mockClear();
  fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true }) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pre-selects the template /api/esign would send", () => {
  it.each([
    ["a standard rental", {}, false, "Standard A"],
    ["a PAYG rental", { is_pay_as_you_go: true }, false, "PAYG D"],
    ["a rental on a live installment plan", { has_installment_plan: true }, true, "Installment D"],
    ["a rental flagged for a plan that is no longer live", { has_installment_plan: true }, false, "Standard A"],
    ["a PAYG rental flagged for a dead plan", { has_installment_plan: true, is_pay_as_you_go: true }, false, "PAYG D"],
  ])("%s", async (_label, overrides, livePlan, expected) => {
    state.livePlan = livePlan;
    renderStage(overrides);
    await waitFor(() => expect(selectedName()).toBe(expected));
    expect(screen.getByText("Default")).toBeTruthy();
    // ...and sending it names no template: the route picks the same one itself.
    expect(await send()).toBe(TODAY_BODY);
  });

  it("falls back to the standard default when the category has none, as the route does", async () => {
    state.templates = TEMPLATES.filter((t) => t.category !== "payg");
    renderStage({ is_pay_as_you_go: true });
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    expect(await send()).toBe(TODAY_BODY);
  });

  it("with no template at all it says the built-in agreement is sent", async () => {
    state.templates = [];
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("The built-in agreement"));
    expect((screen.getByRole("button", { name: /^change$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(await send()).toBe(TODAY_BODY);
  });

  it("the installment plan is read for this rental and this tenant only", async () => {
    state.livePlan = true;
    renderStage({ has_installment_plan: true });
    await waitFor(() => expect(selectedName()).toBe("Installment D"));
    const plan = state.reads.find((r) => r.table === "installment_plans")!;
    expect(plan.filters).toEqual([
      ["rental_id", RENTAL_ID],
      ["tenant_id", TENANT.id],
      ["status", ["active", "pending"]],
    ]);
  });
});

describe("templateId travels only when the selection differs from the route's choice", () => {
  it("a different template is sent as templateId, appended to today's body", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    await pick("Standard B");
    expect(selectedName()).toBe("Standard B");
    expect(screen.queryByText("Default")).toBeNull();

    const body = await send();
    expect(JSON.parse(body)).toEqual({ ...JSON.parse(TODAY_BODY), templateId: "tpl-std-other" });
    expect(body).toBe(`${TODAY_BODY.slice(0, -1)},"templateId":"tpl-std-other"}`);
  });

  it("on a PAYG rental, the standard default is a different template, so it is named", async () => {
    renderStage({ is_pay_as_you_go: true });
    await waitFor(() => expect(selectedName()).toBe("PAYG D"));
    await pick("Standard A");
    expect(JSON.parse(await send()).templateId).toBe("tpl-std-default");
  });

  it("picking the default back is not a change", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    await pick("Standard B");
    await pick("Standard A");
    expect(await send()).toBe(TODAY_BODY);
  });

  it("'Use the default' clears the pick", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    await pick("Standard B");
    fireEvent.click(screen.getByRole("button", { name: /use the default/i }));
    expect(selectedName()).toBe("Standard A");
    expect(await send()).toBe(TODAY_BODY);
  });
});

describe("a template with no wording is never offered, and never named in a send", () => {
  const blank = (id: string, name: string, content: string): AgreementTemplateV2 => ({
    id,
    name,
    category: "standard",
    isDefault: false,
    content,
    updatedAt: null,
  });

  it("pickableTemplatesV2 drops blank templates by isBlankHtml's rule (an image alone is wording)", () => {
    const list = [
      TEMPLATES[0],
      blank("b1", "Empty doc", "<p></p>"),
      blank("b2", "Nbsp", "<p>&nbsp;</p>"),
      blank("b3", "Nothing", ""),
      blank("img", "Image only", '<p><img src="x.png"></p>'),
    ];
    expect(pickableTemplatesV2(list).map((t) => t.id)).toEqual(["tpl-std-default", "img"]);
  });

  it("Change lists only templates with wording", async () => {
    state.templates = [...TEMPLATES, blank("tpl-blank", "Blank one", "<p></p>")];
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    await screen.findByTestId("picker");
    expect(screen.queryByRole("button", { name: "pick Blank one" })).toBeNull();
    expect(screen.getByRole("button", { name: "pick Standard B" })).toBeTruthy();
  });

  it("Change is disabled when every template is blank, and the send names none", async () => {
    state.templates = [blank("tpl-blank", "Blank one", "<p></p>")];
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("The built-in agreement"));
    expect((screen.getByRole("button", { name: /^change$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(await send()).toBe(TODAY_BODY);
  });

  it("a picked template that is emptied afterwards is not sent: the default goes, with no templateId", async () => {
    const { rerender } = renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    await pick("Standard B");
    expect(selectedName()).toBe("Standard B");
    // Standard B loses its wording (another tab) and the list re-reads.
    state.templates = TEMPLATES.map((t) => (t.id === "tpl-std-other" ? { ...t, content: "<p></p>" } : t));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <StageAgreement detail={detail()} onStage={vi.fn()} refetch={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    expect(await send()).toBe(TODAY_BODY);
  });
});

describe("off the agreements canary nothing changes", () => {
  it("renders no row, and sends today's body", async () => {
    state.agreementsV2 = false;
    renderStage();
    expect(screen.queryByText("Selected template")).toBeNull();
    expect(screen.queryByTestId("selected-template-name")).toBeNull();
    expect(await send()).toBe(TODAY_BODY);
    expect(state.reads.some((r) => r.table === "installment_plans")).toBe(false);
  });
});

describe("Edit", () => {
  it("is not offered without canEditSettings('templates')", async () => {
    state.canEditTemplates = false;
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeTruthy();
  });

  it("opens the editor on the selected template with this rental's data, and saves to that template", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    await pick("Standard B");
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByTestId("editor");

    const props = state.editor!;
    expect(props.mode).toBe("rental-template");
    expect(props.saveLabel).toBe("Save to template");
    expect(props.initialName).toBe("Standard B");
    expect(props.initialContent).toBe(TEMPLATES[1].content);
    expect(props.nameEditable).toBe(false);
    expect(props.previewBanner).toBe("ORIGINAL RENTAL AGREEMENT");
    await waitFor(() => expect(state.editor!.previewData.customer_name).toBe("Renter One"));
    expect(state.editor!.previewData.vehicle_reg).toBe("NW-123");
    expect(state.editor!.previewData.company_name).toBe("Northwind Rentals");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to template" }));
    });
    expect(mutations.update).toHaveBeenCalledWith("tpl-std-other", { content: "<p>Edited for this tenant</p>" });
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
  });
});

describe("Edit and Preview show the same document", () => {
  async function previewAndEdit() {
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(state.preview?.html).toContain("Renter One"));
    const preview = state.preview!;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("preview")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByTestId("editor");
    await waitFor(() => expect(state.editor!.previewData.customer_name).toBe("Renter One"));
    return { preview, editor: state.editor! };
  }

  it.each([
    ["a template with the signature tag", TEMPLATES[0].content],
    // No {{@sig1}} and a mileage variable: the injected clauses and the added
    // signature block are exactly what the bare template lacks.
    ["a template without it", "<h2>Plain</h2><p>{{customer_name}} rents {{vehicle_reg}}.</p>"],
  ])("%s: the editor's previewTransform renders what Preview renders, with the same banner", async (_label, content) => {
    state.templates = TEMPLATES.map((t, i) => (i === 0 ? { ...t, content } : t));
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    const { preview, editor } = await previewAndEdit();

    expect(typeof editor.previewTransform).toBe("function");
    // The editor renders renderAgreementHtml(previewTransform(content), previewData, preview mode).
    const editorHtml = renderAgreementHtml(editor.previewTransform(editor.initialContent), editor.previewData, { mode: "preview" });
    expect(editorHtml).toBe(preview.html);
    expect(editor.previewBanner).toBe(preview.banner);
    // The injection is real, not identity: the bare template renders differently.
    expect(renderAgreementHtml(editor.initialContent, editor.previewData, { mode: "preview" })).not.toBe(preview.html);
    expect(preview.html).toContain("{{@sig1}}");
    // Saving still saves the operator's own wording, never the transformed one.
    expect(editor.initialContent).toBe(content);
  });
});

describe("Preview", () => {
  it("renders the selected template with this rental's details and the route's banner", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(state.preview?.html).toContain("Renter One"));
    expect(state.preview!.banner).toBe("ORIGINAL RENTAL AGREEMENT");
    expect(state.preview!.html).toContain("NW-123");
    expect(state.preview!.html).toContain("Northwind Rentals");
    // The signer tag reaches the preview untouched.
    expect(state.preview!.html).toContain("{{@sig1}}");
    // The customer and vehicle are read within this tenant.
    for (const table of ["customers", "vehicles"]) {
      const read = state.reads.filter((r) => r.table === table).at(-1)!;
      expect(read.filters).toContainEqual(["tenant_id", TENANT.id]);
    }
  });
});

describe("the stage's copy", () => {
  it("no longer says creating a rental does not send an agreement", async () => {
    renderStage();
    await waitFor(() => expect(selectedName()).toBe("Standard A"));
    expect(screen.queryByText(/creating the rental does not send one/i)).toBeNull();
    expect(screen.getByText(/a rental created in the portal sends its agreement automatically/i)).toBeTruthy();
  });
});
