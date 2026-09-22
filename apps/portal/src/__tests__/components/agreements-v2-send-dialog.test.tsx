/**
 * Agreements v2: the Send agreement dialog (components/agreements-v2/send-agreement-dialog-v2.tsx).
 *
 * Rendered for real with the real template picker. The editor and the preview
 * are stand-ins that record their props, and the network is a spy: the only
 * thing this dialog may call is `sendAgreementV2`.
 *
 * Pinned (D12, D13 and the video frames):
 *  - details → template → preview, Back and Next, and a reset on close;
 *  - CC takes Enter, commas and a pasted run of addresses, validates each, and
 *    every chip can be removed;
 *  - the title follows the chosen template until the operator edits it;
 *  - the default template is pre-selected;
 *  - the preview shows the real recipient and company, through the send
 *    pipeline, with the title as its banner;
 *  - Edit and Create new open the editor on a COPY and never write a
 *    template; Create new never creates one;
 *  - Send says it uses credits, disables while sending, shows failures inline,
 *    and on success toasts, calls onSent and closes.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgreementTemplateV2 } from "@/lib/agreements-v2/types";

const state = vi.hoisted(() => ({
  templates: [] as AgreementTemplateV2[],
  editorProps: null as any,
  editorResult: "",
  previewProps: null as any,
  dbCalls: [] as Array<{ table: string; method: string }>,
}));

const api = vi.hoisted(() => ({ sendAgreementV2: vi.fn(), resendAgreementV2: vi.fn(), syncAgreementsV2: vi.fn(), fetchAgreementDocumentV2: vi.fn(), checkAgreementsReadyV2: vi.fn() }));
vi.mock("@/lib/agreements-v2/api-client", () => api);

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({
    tenant: { id: "tenant-1", company_name: "Northwind (context)", contact_email: "ctx@northwind.test", phone: "1", timezone: null },
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const api: any = {};
    for (const method of ["select", "eq", "insert", "update", "upsert", "delete"]) {
      api[method] = () => {
        state.dbCalls.push({ table, method });
        return api;
      };
    }
    api.maybeSingle = async () => ({
      data: { company_name: "Northwind Rentals", contact_email: "hello@northwind.test", contact_phone: null, phone: "+1 555 0100", address: "1 Harbour Road" },
      error: null,
    });
    return api;
  };
  return { supabase: { from: (table: string) => chain(table) }, supabaseUntyped: { from: (table: string) => chain(table) } };
});

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), setDefault: vi.fn() }));
vi.mock("@/hooks/use-agreement-templates-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-agreement-templates-v2")>()),
  useAgreementTemplatesV2: () => ({ templates: state.templates, isLoading: false, error: null, refetch: vi.fn() }),
  useAgreementTemplateMutationsV2: () => mutations,
}));

vi.mock("@/components/agreements-v2/templates-section-v2", () => ({
  TEMPLATE_PREVIEW_COMPANY_COLUMNS: "company_name, contact_email, contact_phone, phone, address",
  templateCompanyV2QueryKey: (id: string | undefined) => ["agreement-template-company-v2", id],
  withSignaturesSectionV2: (html: string) => `${html}<h2>Signatures</h2><p>STARTER {{@sig1}}</p>`,
}));

vi.mock("@/components/agreements-v2/editor/agreement-editor-v2", () => ({
  AgreementEditorV2: (props: any) => {
    state.editorProps = props;
    return (
      <div data-testid="editor">
        <button type="button" onClick={() => props.onSave(state.editorResult, props.initialName)}>
          editor-save
        </button>
        <button type="button" onClick={() => props.onClose()}>
          editor-close
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/agreements-v2/agreement-preview-v2", () => ({
  AgreementPreviewV2: (props: any) => {
    state.previewProps = props;
    return <pre data-testid="preview">{props.html}</pre>;
  },
}));

import { SendAgreementDialogV2, addCcAddressesV2 } from "@/components/agreements-v2/send-agreement-dialog-v2";

const TEMPLATES: AgreementTemplateV2[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "NDA", content: "<p>NDA for {{customer_name}}.</p><p>{{@sig1}}</p>", category: "standard", isDefault: false, updatedAt: null },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    name: "Standard rental",
    content: "<p>Hello {{customer_name}} from {{company_name}}.</p><p>Unfilled: {{vehicle_reg}}</p><p>{{@sig1}} {{@date1}}</p>",
    category: "standard",
    isDefault: true,
    updatedAt: null,
  },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Blank", content: "<p></p>", category: "standard", isDefault: false, updatedAt: null },
];

function renderDialog(props: Partial<React.ComponentProps<typeof SendAgreementDialogV2>> = {}) {
  const onOpenChange = vi.fn();
  const onSent = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (open: boolean) => (
    <QueryClientProvider client={client}>
      <SendAgreementDialogV2 open={open} onOpenChange={onOpenChange} onSent={onSent} {...props} />
    </QueryClientProvider>
  );
  const utils = render(ui(true));
  return { ...utils, onOpenChange, onSent, rerenderOpen: (open: boolean) => utils.rerender(ui(open)) };
}

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp | string, value: string) => fireEvent.change(field(label), { target: { value } });
const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

function fillDetails() {
  type(/Recipient name/, "Ada Lovelace");
  type(/Recipient email/, "ada@example.com");
}

async function toPreview() {
  fillDetails();
  click(/^Next/);
  await screen.findByRole("listbox");
  click(/^Next/);
  await screen.findByTestId("preview");
}

beforeEach(() => {
  state.templates = TEMPLATES;
  state.editorProps = null;
  state.previewProps = null;
  state.editorResult = "";
  state.dbCalls = [];
  api.sendAgreementV2.mockReset().mockResolvedValue({ id: "row-1", status: "sent" });
  api.checkAgreementsReadyV2.mockReset().mockResolvedValue({ ready: true });
  toast.mockReset();
  for (const m of Object.values(mutations)) m.mockReset();
});

const noTemplateWrites = () => {
  for (const m of Object.values(mutations)) expect(m).not.toHaveBeenCalled();
  expect(state.dbCalls.filter((c) => ["insert", "update", "upsert", "delete"].includes(c.method))).toEqual([]);
  expect(state.dbCalls.filter((c) => c.table === "agreement_templates")).toEqual([]);
};

describe("step 1: details", () => {
  it("asks for the recipient before moving on", () => {
    renderDialog();
    click(/^Next/);
    expect(screen.getByText("Enter the recipient’s name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field(/Recipient name/)).toHaveAttribute("aria-invalid", "true");
  });

  it("CC: Enter and comma add a chip, a pasted run adds several, bad ones stay with a reason", () => {
    renderDialog();
    type(/Recipient email/, "ada@example.com");
    const cc = field(/^CC$/);
    fireEvent.change(cc, { target: { value: "boss@example.com" } });
    fireEvent.keyDown(cc, { key: "Enter" });
    fireEvent.change(cc, { target: { value: "legal@example.com" } });
    fireEvent.keyDown(cc, { key: "," });
    fireEvent.paste(cc, { clipboardData: { getData: () => "a@x.com, b@y.com c@z.com;nope ADA@example.com" } });

    for (const email of ["boss@example.com", "legal@example.com", "a@x.com", "b@y.com", "c@z.com"]) {
      expect(screen.getByRole("button", { name: `Remove ${email}` })).toBeInTheDocument();
    }
    expect(cc.value).toBe("nope, ADA@example.com");
    expect(screen.getByText("nope is not a valid email address.")).toBeInTheDocument();

    click("Remove legal@example.com");
    expect(screen.queryByRole("button", { name: "Remove legal@example.com" })).toBeNull();
    expect(screen.getByText("Enter one or more email addresses, separated by a comma.")).toBeInTheDocument();
  });

  it("will not move on while the CC box holds an address it could not add", () => {
    renderDialog();
    fillDetails();
    type(/^CC$/, "not-an-email");
    click(/^Next/);
    expect(screen.getByText("not-an-email is not a valid email address.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the title follows the default template until it is edited, and the message has its help line", () => {
    renderDialog();
    expect(field(/Document title/).value).toBe("Standard rental");
    expect(screen.getByText("Included in the email the recipient gets, and shown where they sign.")).toBeInTheDocument();
    type(/Document title/, "Consulting agreement");
    expect(field(/Document title/).value).toBe("Consulting agreement");
  });
});

describe("step 2: template", () => {
  it("pre-selects the default, and picking another retitles an unedited title", async () => {
    renderDialog();
    fillDetails();
    click(/^Next/);
    const list = await screen.findByRole("listbox");
    const selected = within(list).getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.getAttribute("data-template-id")).toBe("aaaaaaaa-0000-4000-8000-000000000002");

    fireEvent.click(within(list).getAllByRole("option").find((o) => o.getAttribute("data-template-id") === "aaaaaaaa-0000-4000-8000-000000000001")!);
    click(/^Back/);
    expect(field(/Document title/).value).toBe("NDA");
  });

  it("an edited title is kept when the template changes", async () => {
    renderDialog();
    fillDetails();
    type(/Document title/, "My title");
    click(/^Next/);
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getAllByRole("option").find((o) => o.getAttribute("data-template-id") === "aaaaaaaa-0000-4000-8000-000000000001")!);
    click(/^Back/);
    expect(field(/Document title/).value).toBe("My title");
  });

  it("will not preview a template with no wording", async () => {
    renderDialog();
    fillDetails();
    click(/^Next/);
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getAllByRole("option").find((o) => o.getAttribute("data-template-id") === "aaaaaaaa-0000-4000-8000-000000000003")!);
    click(/^Next/);
    expect(screen.getByRole("alert").textContent).toMatch(/no wording/);
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

describe("step 3: preview and send", () => {
  it("previews the real recipient and company through the send pipeline, titled", async () => {
    renderDialog();
    await toPreview();
    const html = screen.getByTestId("preview").textContent ?? "";
    expect(html).toContain("Hello Ada Lovelace from Northwind Rentals.");
    // A variable an individual agreement has nothing for is HIGHLIGHTED in the
    // preview, so the operator sees what will go out blank (render.ts
    // markMissing). It used to vanish silently, which hid exactly that.
    expect(html).toMatch(/<span data-unresolved="vehicle_reg"[^>]*>\{\{vehicle_reg\}\}<\/span>/);
    expect(html).toContain("{{@sig1}}");
    expect(html).toContain("{{@date1}}");
    expect(state.previewProps.banner).toBe("Standard rental");
    expect(screen.getByText("Sending uses e-sign credits.")).toBeInTheDocument();
  });

  it("sends the chosen template's wording, the details and the CC; toasts, calls onSent, closes", async () => {
    const { onOpenChange, onSent } = renderDialog();
    fillDetails();
    type(/^CC$/, "boss@example.com");
    type(/Message/, "  Please sign by Friday.  ");
    click(/^Next/);
    await screen.findByRole("listbox");
    click(/^Next/);
    await screen.findByTestId("preview");
    await act(async () => click(/Send agreement/));

    expect(api.sendAgreementV2).toHaveBeenCalledTimes(1);
    expect(api.sendAgreementV2).toHaveBeenCalledWith({
      templateId: "aaaaaaaa-0000-4000-8000-000000000002",
      contentHtml: TEMPLATES[1].content,
      title: "Standard rental",
      message: "Please sign by Friday.",
      recipientName: "Ada Lovelace",
      recipientEmail: "ada@example.com",
      cc: ["boss@example.com"],
      // The same company details the preview filled in; the client renders
      // the final html and the PDF from these (lib/agreements-v2/api-client.ts).
      company: {
        companyName: "Northwind Rentals",
        companyEmail: "hello@northwind.test",
        companyPhone: "+1 555 0100",
        companyAddress: "1 Harbour Road",
      },
      timeZone: undefined,
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Agreement sent" }));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    noTemplateWrites();
  });

  it("disables Send while it is sending", async () => {
    let resolve!: (v: unknown) => void;
    api.sendAgreementV2.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderDialog();
    await toPreview();
    click(/Send agreement/);
    const button = await screen.findByRole("button", { name: /Sending/ });
    expect(button).toBeDisabled();
    await act(async () => resolve({ id: "row-1", status: "sent" }));
  });

  it("no credits: says so inline and stays open (the failed row is in the list, so onSent fires)", async () => {
    api.sendAgreementV2.mockResolvedValueOnce({ id: "row-1", status: "credit_failed" });
    const { onOpenChange, onSent } = renderDialog();
    await toPreview();
    await act(async () => click(/Send agreement/));
    expect(screen.getByRole("alert").textContent).toMatch(/not enough e-sign credits/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("a thrown error is shown inline", async () => {
    api.sendAgreementV2.mockRejectedValueOnce(new Error("Your role can view agreements but not send them."));
    const { onOpenChange } = renderDialog();
    await toPreview();
    await act(async () => click(/Send agreement/));
    expect(screen.getByRole("alert").textContent).toMatch(/Your role can view agreements but not send them/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("each signer field once", () => {
  it("a template with a signer field twice cannot be sent, and says why", async () => {
    state.templates = [
      { ...TEMPLATES[1], content: "<p>Hello {{customer_name}}.</p><p>{{@sig1}}</p><p>Again {{@sig1}}</p>" },
    ];
    renderDialog();
    await toPreview();
    const send = screen.getByRole("button", { name: /Send agreement/ });
    expect(send).toBeDisabled();
    const reason = document.querySelector('[data-slot="duplicate-signer-fields"]') as HTMLElement;
    expect(reason.textContent).toMatch(/Signature is in the agreement 2 times\. Keep one/);
    expect(send.getAttribute("aria-describedby")).toBe(reason.id);
    await act(async () => fireEvent.click(send));
    expect(api.sendAgreementV2).not.toHaveBeenCalled();
  });

  it("an edit that repeats a field is refused; editing it back to one makes Send work", async () => {
    renderDialog();
    await toPreview();
    expect(screen.getByRole("button", { name: /Send agreement/ })).toBeEnabled();
    click(/^Edit$/);
    await screen.findByTestId("editor");
    state.editorResult = "<p>{{@date1}}</p><p>{{@date1}}</p><p>{{@sig1}}</p>";
    fireEvent.click(screen.getByRole("button", { name: "editor-save" }));
    await screen.findByTestId("preview");
    expect(screen.getByRole("button", { name: /Send agreement/ })).toBeDisabled();
    expect(document.querySelector('[data-slot="duplicate-signer-fields"]')!.textContent).toMatch(/Date signed is in the agreement 2 times/);

    click(/^Edit$/);
    await screen.findByTestId("editor");
    state.editorResult = "<p>{{@date1}}</p><p>{{@sig1}}</p>";
    fireEvent.click(screen.getByRole("button", { name: "editor-save" }));
    await screen.findByTestId("preview");
    expect(document.querySelector('[data-slot="duplicate-signer-fields"]')).toBeNull();
    await act(async () => click(/Send agreement/));
    expect(api.sendAgreementV2).toHaveBeenCalledWith(expect.objectContaining({ contentHtml: "<p>{{@date1}}</p><p>{{@sig1}}</p>" }));
  });
});

describe("one-off edits never touch a template", () => {
  it("Edit opens the editor on a copy, and what is sent is the edit, from that template", async () => {
    renderDialog();
    await toPreview();
    click(/^Edit$/);
    const editor = await screen.findByTestId("editor");
    expect(editor).toBeInTheDocument();
    expect(state.editorProps).toMatchObject({
      mode: "one-off",
      initialContent: TEMPLATES[1].content,
      saveLabel: "Use for this agreement",
      nameEditable: false,
    });
    expect(state.editorProps.previewData.customer_name).toBe("Ada Lovelace");
    // The send dialog is out of the way while the editor is up.
    expect(screen.queryByRole("dialog", { name: /Send agreement/ })).toBeNull();

    state.editorResult = "<p>EDITED for {{customer_name}}</p><p>{{@sig1}}</p>";
    fireEvent.click(screen.getByRole("button", { name: "editor-save" }));
    const preview = await screen.findByTestId("preview");
    expect(preview.textContent).toContain("EDITED for Ada Lovelace");
    expect(screen.getByText(/The template is unchanged/)).toBeInTheDocument();

    await act(async () => click(/Send agreement/));
    expect(api.sendAgreementV2).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "aaaaaaaa-0000-4000-8000-000000000002", contentHtml: state.editorResult }),
    );
    // The template itself still has its own wording.
    expect(TEMPLATES[1].content).toContain("Hello {{customer_name}}");
    noTemplateWrites();
  });

  it("Create new starts from the signatures section and sends it with no template, creating none", async () => {
    renderDialog();
    fillDetails();
    click(/^Next/);
    await screen.findByRole("listbox");
    click(/Create new/);
    await screen.findByTestId("editor");
    expect(state.editorProps.mode).toBe("one-off");
    expect(state.editorProps.initialContent).toContain("STARTER {{@sig1}}");

    state.editorResult = "<p>Bespoke terms</p><p>{{@sig1}}</p>";
    fireEvent.click(screen.getByRole("button", { name: "editor-save" }));
    await screen.findByTestId("preview");
    expect(state.previewProps.banner).toBe("Agreement");

    await act(async () => click(/Send agreement/));
    expect(api.sendAgreementV2).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: null, contentHtml: "<p>Bespoke terms</p><p>{{@sig1}}</p>", title: "Agreement" }),
    );
    noTemplateWrites();
  });

  it("closing the editor without saving changes nothing", async () => {
    renderDialog();
    await toPreview();
    click(/^Edit$/);
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "editor-close" }));
    const preview = await screen.findByTestId("preview");
    expect(preview.textContent).toContain("Hello Ada Lovelace");
  });
});

describe("reset", () => {
  it("starts over when closed and opened again", async () => {
    const { rerenderOpen } = renderDialog();
    await toPreview();
    rerenderOpen(false);
    rerenderOpen(true);
    await waitFor(() => expect(field(/Recipient name/).value).toBe(""));
    expect(field(/Recipient email/).value).toBe("");
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

describe("addCcAddressesV2", () => {
  it("adds valid, new, non-recipient addresses and caps the list at ten", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}@example.com`);
    const r = addCcAddressesV2(nine, "x@example.com y@example.com P0@example.com me@example.com", "me@example.com");
    expect(r.list).toHaveLength(10);
    expect(r.list.at(-1)).toBe("x@example.com");
    expect(r.rejected).toEqual(["y@example.com", "me@example.com"]);
    expect(r.error).toBe("You can copy in at most 10 people.");
  });
});

describe("readiness, asked when the dialog opens", () => {
  it("says up front what is missing, still lets you prepare and preview, and never sends", async () => {
    api.checkAgreementsReadyV2.mockResolvedValue({
      ready: false,
      reason: "database",
      message: "Sending agreements that aren't linked to a rental needs a one-time database update that hasn't been applied yet.",
    });
    renderDialog();
    // On step 1 — not after three steps.
    const note = await screen.findByText(/can.t be sent yet/);
    expect(note.closest('[data-slot="send-not-ready"]')).toHaveTextContent(/one-time database update/);
    await toPreview();
    const sendButton = screen.getByRole("button", { name: /Send agreement/ });
    expect(sendButton).toBeDisabled();
    fireEvent.click(sendButton);
    expect(api.sendAgreementV2).not.toHaveBeenCalled();
  });

  it("says so when the agreements service has not been deployed yet", async () => {
    api.checkAgreementsReadyV2.mockResolvedValue({
      ready: false,
      reason: "service",
      message: "Sending isn't switched on yet: the agreements service hasn't been deployed.",
    });
    renderDialog();
    const note = await screen.findByText(/can.t be sent yet/);
    expect(note.closest('[data-slot="send-not-ready"]')).toHaveTextContent(/agreements service hasn.t been deployed/);
    await toPreview();
    expect(screen.getByRole("button", { name: /Send agreement/ })).toBeDisabled();
    expect(api.sendAgreementV2).not.toHaveBeenCalled();
  });

  it("when ready, shows no note and sends as normal", async () => {
    renderDialog();
    await toPreview();
    expect(document.querySelector('[data-slot="send-not-ready"]')).toBeNull();
    expect(screen.getByRole("button", { name: /Send agreement/ })).not.toBeDisabled();
  });

  it("if the check itself cannot be reached, nothing is blocked (the send reports its own error)", async () => {
    api.checkAgreementsReadyV2.mockRejectedValue(new Error("offline"));
    renderDialog();
    await toPreview();
    expect(document.querySelector('[data-slot="send-not-ready"]')).toBeNull();
    expect(screen.getByRole("button", { name: /Send agreement/ })).not.toBeDisabled();
  });
});

describe("the blanks note on an individual agreement", () => {
  it("says the highlighted details come from a rental, and what to do", async () => {
    const { individualUnresolvedNoteV2 } = await import("@/components/agreements-v2/send-agreement-dialog-v2");
    const many = individualUnresolvedNoteV2(25);
    expect(many).toMatch(/^25 highlighted details in this template come from a rental/);
    expect(many).toMatch(/isn't linked to a rental, so they are left blank/);
    expect(many).toMatch(/Use Edit to remove or change them, or pick a template written for this/);
    expect(individualUnresolvedNoteV2(1)).toMatch(/^1 highlighted detail .* so it is left blank\. Use Edit to remove or change it/);
  });
});
