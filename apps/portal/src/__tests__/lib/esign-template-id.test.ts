/**
 * /api/esign, additive change 1 (build-spec D14): ONE optional body field,
 * `templateId`, sent by the v2 rental stage only when the operator picked a
 * template other than the one the route picks by itself.
 *
 *   absent   the template is picked exactly as before: the same query, the
 *            same fallback, byte for byte (pinned against HEAD's text below).
 *   present  the template is read by id AND the rental's own tenant, before any
 *            credit is spent; a miss is a 400 "Template not found"; a hit is
 *            rendered through exactly the path the active template takes.
 *   blank    a chosen template with no wording (isBlankHtml's rule) is a 400
 *            "That template has no wording yet.", before any credit is spent.
 *
 * The POST handler itself runs here, against an in-memory Supabase. No
 * BoldSign key is set, so the handler stops at "BoldSign not configured"
 * AFTER it has rendered the PDF and BEFORE any credit or network call: the
 * whole template decision happens inside that window, and nothing can reach
 * BoldSign from this suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeOnly, readPortalSource } from "../helpers/edge-source";

type Filter = [op: string, column: string, value: unknown];
type Call = { table: string; op: "select" | "insert" | "update" | "upsert" | "delete"; filters: Filter[]; payload?: unknown };

const state = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown }[],
  rpc: [] as { fn: string; args: unknown }[],
  templates: [] as { id: string; tenant_id: string; template_category: string; is_active: boolean; template_content: string }[],
  rental: null as Record<string, unknown> | null,
}));

vi.mock("@supabase/supabase-js", () => {
  const resolveCall = (call: Call, mode: "single" | "maybeSingle" | "many") => {
    const eq = (col: string) => call.filters.find(([op, c]) => op === "eq" && c === col)?.[2];
    if (call.op !== "select") return { data: null, error: null };
    switch (call.table) {
      case "rentals":
        return { data: state.rental, error: null };
      case "tenants":
        return {
          data: { slug: "acme", company_name: "Acme Rentals", boldsign_mode: "test", currency_code: "USD", portal_experience: null },
          error: null,
        };
      case "agreement_templates": {
        const rows = state.templates.filter(
          (t) =>
            (eq("id") === undefined || t.id === eq("id")) &&
            (eq("tenant_id") === undefined || t.tenant_id === eq("tenant_id")) &&
            (eq("template_category") === undefined || t.template_category === eq("template_category")) &&
            (eq("is_active") === undefined || t.is_active === eq("is_active"))
        );
        if (mode === "many") return { data: rows, error: null };
        if (mode === "single" && rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: rows[0] ?? null, error: null };
      }
      default:
        return { data: mode === "many" ? [] : null, error: null };
    }
  };

  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    state.calls.push(call as never);
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === "insert" || name === "update" || name === "upsert" || name === "delete") {
        call.op = name;
        call.payload = args[0];
      } else if (["eq", "neq", "in", "is", "gte", "lte", "gt", "lt"].includes(name)) {
        call.filters.push([name, String(args[0]), args[1]]);
      }
      return builder;
    };
    for (const name of ["select", "eq", "neq", "in", "is", "gte", "lte", "gt", "lt", "order", "limit", "insert", "update", "upsert", "delete", "range"]) {
      builder[name] = chain(name);
    }
    builder.single = () => Promise.resolve(resolveCall(call, "single"));
    builder.maybeSingle = () => Promise.resolve(resolveCall(call, "maybeSingle"));
    builder.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(resolveCall(call, "many")).then(ok, bad);
    return builder;
  };

  const client = {
    from,
    rpc: (fn: string, args: unknown) => {
      state.rpc.push({ fn, args });
      return Promise.resolve({ data: { success: true }, error: null });
    },
  };
  return { createClient: () => client };
});

// A passthrough spy: the content the handler renders is its first argument.
vi.mock("@/lib/agreement-injection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agreement-injection")>();
  return { ...actual, injectAgreementClauses: vi.fn(actual.injectAgreementClauses) };
});

import { POST } from "@/app/api/esign/route";
import { injectAgreementClauses } from "@/lib/agreement-injection";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const ACTIVE = "<p>ACTIVE STANDARD TEMPLATE for {{customer_name}}</p>";
const CHOSEN = "<p>CHOSEN TEMPLATE for {{customer_name}}</p>";
const FOREIGN = "<p>ANOTHER TENANT'S TEMPLATE</p>";

const BASE_BODY = {
  rentalId: "11111111-2222-3333-4444-555555555555",
  customerEmail: "renter@example.com",
  customerName: "Renter One",
  tenantId: TENANT,
  agreementType: "original",
};

const post = async (body: Record<string, unknown>) => {
  const response = await POST({ json: async () => body } as never);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
};

const templateReads = () => (state.calls as Call[]).filter((c) => c.table === "agreement_templates" && c.op === "select");
const renderedContent = () => vi.mocked(injectAgreementClauses).mock.calls.map((c) => c[0]);

const savedEnv: Record<string, string | undefined> = {};
const KEYS = ["BOLDSIGN_TEST_API_KEY", "BOLDSIGN_LIVE_API_KEY", "BOLDSIGN_API_KEY"];

beforeEach(() => {
  state.calls.length = 0;
  state.rpc.length = 0;
  state.rental = {
    id: BASE_BODY.rentalId,
    tenant_id: TENANT,
    customer_id: "cust-1",
    start_date: "2026-09-21",
    end_date: "2026-09-28",
    customers: { id: "cust-1", name: "Renter One", email: "renter@example.com" },
    vehicles: { id: "veh-1", make: "Tesla", model: "Model 3", reg: "NW-1" },
  };
  state.templates = [
    { id: "tpl-active", tenant_id: TENANT, template_category: "standard", is_active: true, template_content: ACTIVE },
    { id: "tpl-chosen", tenant_id: TENANT, template_category: "standard", is_active: false, template_content: CHOSEN },
    { id: "tpl-foreign", tenant_id: OTHER, template_category: "standard", is_active: false, template_content: FOREIGN },
  ];
  vi.mocked(injectAgreementClauses).mockClear();
  for (const k of KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("No network from this suite.");
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/esign without templateId: exactly today's template choice", () => {
  it("renders the tenant's active template for the category, and never reads a template by id", async () => {
    const res = await post(BASE_BODY);

    expect(renderedContent()).toEqual([ACTIVE]);
    const reads = templateReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.filters.some(([, c]) => c === "id")).toBe(false);
      expect(read.filters).toContainEqual(["eq", "tenant_id", TENANT]);
      expect(read.filters).toContainEqual(["eq", "is_active", true]);
    }
    // It went as far as the missing BoldSign key: nothing charged, nothing sent.
    expect(res).toEqual({ status: 500, json: { ok: false, error: "BoldSign not configured" } });
    expect(state.rpc).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/esign with templateId", () => {
  it("renders the chosen template in place of the active one, read by id and the rental's tenant", async () => {
    const res = await post({ ...BASE_BODY, templateId: "tpl-chosen" });

    expect(renderedContent()).toEqual([CHOSEN]);
    const byId = templateReads().filter((c) => c.filters.some(([, col]) => col === "id"));
    expect(byId).toHaveLength(1);
    expect(byId[0].filters).toEqual([
      ["eq", "id", "tpl-chosen"],
      ["eq", "tenant_id", TENANT],
    ]);
    expect(res.status).toBe(500); // the missing key, i.e. the same path onwards
    expect(state.rpc).toEqual([]);
  });

  it("a template of another tenant is 'Template not found', before any credit and before rendering", async () => {
    const res = await post({ ...BASE_BODY, templateId: "tpl-foreign" });

    expect(res).toEqual({ status: 400, json: { ok: false, error: "Template not found" } });
    expect(renderedContent()).toEqual([]);
    expect(state.rpc).toEqual([]);
    expect((state.calls as Call[]).filter((c) => c.op !== "select")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unknown id is 'Template not found'", async () => {
    const res = await post({ ...BASE_BODY, templateId: "no-such-template" });
    expect(res).toEqual({ status: 400, json: { ok: false, error: "Template not found" } });
    expect(renderedContent()).toEqual([]);
  });

  it("a body tenant that is not the rental's tenant is refused without reading any template", async () => {
    const res = await post({ ...BASE_BODY, tenantId: OTHER, templateId: "tpl-foreign" });
    expect(res).toEqual({ status: 400, json: { ok: false, error: "Template not found" } });
    expect(templateReads()).toEqual([]);
  });

  it("a rental that does not exist is refused", async () => {
    state.rental = null;
    const res = await post({ ...BASE_BODY, templateId: "tpl-chosen" });
    expect(res).toEqual({ status: 400, json: { ok: false, error: "Template not found" } });
  });

  it.each([
    ["TipTap's empty document", "<p></p>"],
    ["a non-breaking space", "<p>&nbsp;</p>"],
    ["whitespace and empty tags", "  <p> </p>\n<h2></h2>  "],
    ["nothing at all", ""],
  ])("a template with no wording (%s) is refused before any credit, and the built-in text is never sent", async (_label, content) => {
    state.templates.push({ id: "tpl-blank", tenant_id: TENANT, template_category: "standard", is_active: false, template_content: content });
    const res = await post({ ...BASE_BODY, templateId: "tpl-blank" });

    expect(res).toEqual({ status: 400, json: { ok: false, error: "That template has no wording yet." } });
    // Nothing rendered (neither the blank template nor the active one), nothing
    // charged, nothing written, nothing sent.
    expect(renderedContent()).toEqual([]);
    expect(state.rpc).toEqual([]);
    expect((state.calls as Call[]).filter((c) => c.op !== "select")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an image-only template is not blank (the same rule as the v2 picker's isBlankHtml)", async () => {
    const IMAGE_ONLY = '<p><img src="https://example.com/terms.png"></p>';
    state.templates.push({ id: "tpl-image", tenant_id: TENANT, template_category: "standard", is_active: false, template_content: IMAGE_ONLY });
    const res = await post({ ...BASE_BODY, templateId: "tpl-image" });
    expect(res.status).toBe(500); // past the check, onwards to the missing BoldSign key
    expect(renderedContent()).toEqual([IMAGE_ONLY]);
  });

  it("without templateId, a blank ACTIVE template is not refused: today's behaviour is untouched", async () => {
    state.templates = state.templates.map((t) => (t.id === "tpl-active" ? { ...t, template_content: "<p></p>" } : t));
    const res = await post(BASE_BODY);
    expect(res).toEqual({ status: 500, json: { ok: false, error: "BoldSign not configured" } });
  });

  it("the chosen template goes through the same rules as the active one (signature tag, disclaimer)", async () => {
    // Same rendering branch: the content reaches injectAgreementClauses with the
    // same options object shape the active template gets.
    await post(BASE_BODY);
    const activeOpts = vi.mocked(injectAgreementClauses).mock.calls[0][1];
    vi.mocked(injectAgreementClauses).mockClear();
    await post({ ...BASE_BODY, templateId: "tpl-chosen" });
    const chosenOpts = vi.mocked(injectAgreementClauses).mock.calls[0][1];
    expect(chosenOpts).toEqual(activeOpts);
  });
});

/* ── source pins ───────────────────────────────────────────────────────── */

const SRC = readPortalSource("app/api/esign/route.ts");

/**
 * HEAD's template selection, verbatim (route.ts at 5a664cbb). A request
 * without templateId runs this, so it must still be in the file character for
 * character.
 */
const HEAD_TEMPLATE_QUERY = `            const explicit = body.agreementType;
            const templateCategory = explicit === 'extension'
                ? 'extension'
                : explicit === 'installment'
                    ? 'installment'
                    : explicit === 'payg'
                        ? 'payg'
                        : (rental?.has_installment_plan && installment) ? 'installment'
                            : rental?.is_pay_as_you_go ? 'payg' : 'standard';
            let { data: templateData } = await supabase
                .from('agreement_templates')
                .select('template_content')
                .eq('tenant_id', body.tenantId)
                .eq('template_category', templateCategory)
                .eq('is_active', true)
                .single();

            // Fallback to standard template if no category-specific template configured
            if (!templateData && templateCategory !== 'standard') {
                const { data: fallback } = await supabase
                    .from('agreement_templates')
                    .select('template_content')
                    .eq('tenant_id', body.tenantId)
                    .eq('template_category', 'standard')
                    .eq('is_active', true)
                    .single();
                templateData = fallback;
            }
`;

describe("route.ts source: the change is additive", () => {
  it("templateId is an OPTIONAL member of ESignRequest", () => {
    const iface = SRC.slice(SRC.indexOf("interface ESignRequest"), SRC.indexOf("}", SRC.indexOf("interface ESignRequest")));
    expect(iface).toMatch(/\n\s*templateId\?: string;/);
    expect(iface).not.toMatch(/\n\s*templateId: string;/);
  });

  it("HEAD's template query and fallback are still in the file, untouched", () => {
    expect(SRC).toContain(HEAD_TEMPLATE_QUERY);
  });

  it("the explicit template only ever REPLACES the result, after the untouched query", () => {
    const code = codeOnly(SRC);
    const at = {
      lookup: code.indexOf("if (body.templateId) {"),
      miss: code.indexOf("return NextResponse.json({ ok: false, error: 'Template not found' }, { status: 400 });"),
      query: code.indexOf("const explicit = body.agreementType;"),
      override: code.indexOf("if (requestedTemplate) templateData = requestedTemplate;"),
      render: code.indexOf("if (templateData?.template_content) {"),
      deduct: code.indexOf("deduct_credits"),
    };
    for (const [k, v] of Object.entries(at)) expect(v, k).toBeGreaterThan(-1);
    expect(at.lookup).toBeLessThan(at.miss);
    expect(at.miss).toBeLessThan(at.query);
    expect(at.query).toBeLessThan(at.override);
    expect(at.override).toBeLessThan(at.render);
    expect(at.miss).toBeLessThan(at.deduct);
    // templateId is read in exactly one place.
    expect(code.match(/body\.templateId/g)).toHaveLength(2); // the gate and the .eq('id', …)
  });
});
