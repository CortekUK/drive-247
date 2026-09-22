/**
 * Agreements v2: the editor overlay as the lanes use it (build-spec D6-D9).
 *
 * Rendered for real: the Radix overlay, the Tiptap editor, the side panel and
 * the live preview. Only the router (the leave guard uses it) and the
 * operator-signature hook (Supabase) are stubbed.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const signatureHook = vi.hoisted(() => ({
  state: { signature: null as string | null, isLoading: false },
  save: vi.fn(async (_dataUrl: string) => ({ persisted: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {}, supabaseUntyped: {} }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null }) }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: () => null }));
vi.mock("@/hooks/use-operator-signature-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-operator-signature-v2")>()),
  useOperatorSignatureV2: () => ({ ...signatureHook.state, save: signatureHook.save }),
}));

import {
  AgreementEditorV2,
  DEFAULT_TEMPLATE_HINT_V2,
  type AgreementEditorV2Props,
} from "@/components/agreements-v2/editor/agreement-editor-v2";
import { SIGNATURE_PLACEMENT_REASON } from "@/components/agreements-v2/editor/editor-extensions";
import { DEFAULT_AGREEMENT_TEMPLATE } from "@/lib/default-agreement-template";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Role queries walk a real Radix + Tiptap tree; they are slow under jsdom.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  const list = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = list;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  signatureHook.state = { signature: null, isLoading: false };
  signatureHook.save.mockReset();
  signatureHook.save.mockResolvedValue({ persisted: true });
});

async function open(props: Partial<AgreementEditorV2Props> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn<(content: string, name: string) => Promise<void>>(async () => {});
  const all: AgreementEditorV2Props = {
    open: true,
    onClose,
    mode: "template",
    initialName: "Standard rental",
    initialContent: "<p>Dear {{customer_name}},</p><p>Welcome.</p>",
    previewData: { customer_name: "Ada Lovelace" },
    onSave,
    ...props,
  };
  const utils = render(<AgreementEditorV2 {...all} />);
  // The Tiptap editor is created after mount.
  await screen.findByRole("textbox", { name: "Agreement text" });
  return { ...utils, onClose: all.onClose as ReturnType<typeof vi.fn>, onSave: all.onSave as typeof onSave };
}

const previewBody = () => document.querySelector('[data-slot="agreement-body"]') as HTMLElement | null;

async function openPanelTab(tab: "Variables" | "Signature fields" | "Your signature") {
  fireEvent.click(screen.getByRole("button", { name: /Fields & variables/ }));
  const trigger = screen.getByRole("tab", { name: tab });
  fireEvent.mouseDown(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "active"));
}

describe("the overlay", () => {
  it("renders nothing while closed", () => {
    render(
      <AgreementEditorV2
        open={false}
        onClose={() => {}}
        mode="template"
        initialName="x"
        initialContent="<p>x</p>"
        previewData={{}}
        onSave={() => {}}
      />,
    );
    expect(document.querySelector('[data-slot="agreement-editor-v2"]')).toBeNull();
  });

  it("is a full-screen surface with the editor on one half and the preview on the other", async () => {
    await open();
    const overlay = document.querySelector('[data-slot="agreement-editor-v2"]') as HTMLElement;
    expect(overlay.className).toMatch(/fixed inset-0/);
    expect(overlay.className).toMatch(/w-screen/);
    expect(screen.getByRole("region", { name: "Edit the agreement" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("shows the live preview with the preview data substituted", async () => {
    await open();
    await waitFor(() => expect(previewBody()?.textContent).toContain("Dear Ada Lovelace,"));
  });

  it("says what saving does, per mode, with the default labels", async () => {
    const { unmount } = await open({ mode: "one-off" });
    expect(screen.getByText("Changes apply to this agreement only — your template stays as it is.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Use for this agreement" })).toBeInTheDocument();
    unmount();

    const second = await open({ mode: "rental-template" });
    expect(screen.getByText("Saving updates this template for every future agreement that uses it.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save to template" })).toBeInTheDocument();
    second.unmount();

    await open({ mode: "template", saveLabel: "Save template" });
    expect(screen.queryByText(/Changes apply to this agreement only/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save template" })).toBeInTheDocument();
  });
});

describe("leaving with unsaved changes", () => {
  it("Cancel with nothing changed just closes", async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel after an edit asks first; staying keeps the edit; Don't Save closes", async () => {
    const { onClose } = await open();
    await openPanelTab("Signature fields");
    fireEvent.click(document.querySelector('aside [data-field="signature"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
    // The tile now reads Placed.
    expect(document.querySelector('aside [data-field="signature"]')).toHaveAttribute("data-state", "placed");

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText("Unsaved Changes")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Don't Save" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape asks too (and first closes an open side panel)", async () => {
    const { onClose } = await open();
    await openPanelTab("Signature fields");
    fireEvent.click(document.querySelector('aside [data-field="initials"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());

    const overlay = document.querySelector('[data-slot="agreement-editor-v2"]') as HTMLElement;
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(screen.getByRole("complementary", { hidden: true })).toHaveAttribute("data-state", "closed");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape with nothing changed closes", async () => {
    const { onClose } = await open();
    fireEvent.keyDown(document.querySelector('[data-slot="agreement-editor-v2"]') as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("saving", () => {
  it("hands back the edited content and the name, then closes", async () => {
    const { onSave, onClose } = await open({ nameEditable: true });
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "  Long-term hire  " } });
    await openPanelTab("Signature fields");
    fireEvent.click(document.querySelector('aside [data-field="date"]') as HTMLElement);
    const save = screen.getByRole("button", { name: "Save template" });
    await waitFor(() => expect(save).toBeEnabled());
    await act(async () => {
      fireEvent.click(save);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const [content, name] = onSave.mock.calls[0];
    expect(name).toBe("Long-term hire");
    expect(content).toContain("{{customer_name}}");
    expect(content).toContain("{{@date1}}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a failed save inline and stays open", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("A template with that name already exists.");
    });
    const { onClose } = await open({ nameEditable: true, onSave });
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Taken" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Not saved. A template with that name already exists.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Agreement text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save template" })).toBeEnabled();
  });

  it("shows progress while saving", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await open({ nameEditable: true, onSave });
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => finish());
  });

  it("a template with nothing changed cannot be saved; a blank name cannot either", async () => {
    await open({ nameEditable: true });
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "   " } });
    expect(screen.getByText("Give the template a name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
  });

  it("a one-off can be used as it is, and unchanged content goes back byte for byte", async () => {
    const initialContent = DEFAULT_AGREEMENT_TEMPLATE;
    const { onSave } = await open({ mode: "one-off", initialContent, initialName: "Standard" });
    const use = screen.getByRole("button", { name: "Use for this agreement" });
    await waitFor(() => expect(use).toBeEnabled());
    await act(async () => {
      fireEvent.click(use);
    });
    expect(onSave).toHaveBeenCalledWith(initialContent, "Standard");
  });

  it("Create new starts from the starter, and cannot be used until something is written", async () => {
    await open({ mode: "one-off", initialContent: "", initialName: "New agreement" });
    const editorText = screen.getByRole("textbox", { name: "Agreement text" });
    await waitFor(() => expect(editorText.textContent).toContain("FOR THE COMPANY"));
    const text = editorText.textContent!;
    // The signatures section, company side first, then the customer's fields.
    expect(text.indexOf("FOR THE COMPANY")).toBeLessThan(text.indexOf("FOR THE CUSTOMER"));
    expect(text).toContain("{{@sig1}}");
    expect(text).toContain("{{@date1}}");
    expect(screen.getByRole("button", { name: "Use for this agreement" })).toBeDisabled();
    // The preview draws the customer's fields as boxes.
    await waitFor(() => expect(previewBody()?.querySelector('.agr-field[data-field="signature"]')).not.toBeNull());
    expect(previewBody()!.querySelector('.agr-field[data-field="date"]')).not.toBeNull();
  });

  it("an agreement with every word deleted cannot be saved", async () => {
    await open({ mode: "one-off", initialContent: "<p>{{customer_name}}</p>" });
    const use = screen.getByRole("button", { name: "Use for this agreement" });
    await waitFor(() => expect(use).toBeEnabled());
    // Tiptap hangs the editor on its DOM node; clear it the way select-all + delete would.
    const dom = screen.getByRole("textbox", { name: "Agreement text" }) as HTMLElement & { editor: { commands: { clearContent: (emit: boolean) => boolean } } };
    await act(async () => {
      dom.editor.commands.clearContent(true);
    });
    expect(await screen.findByText(/The agreement is empty/)).toBeInTheDocument();
    expect(use).toBeDisabled();
  });
});

describe("the operator's signature", () => {
  it("'Use my signature' puts exactly the signature element into the document and the preview", async () => {
    signatureHook.state = { signature: PNG, isLoading: false };
    const { onSave } = await open();
    await openPanelTab("Your signature");
    fireEvent.click(screen.getByRole("button", { name: "Use my signature" }));
    await waitFor(() => expect(previewBody()?.querySelector("img[data-operator-signature]")).not.toBeNull());
    expect(previewBody()!.querySelector("img")!.getAttribute("src")).toBe(PNG);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    });
    const [content] = onSave.mock.calls[0];
    expect(content).toContain(`<img data-operator-signature="true" src="${PNG}" alt="Signature">`);
    expect(content.match(/<img/g)).toHaveLength(1);
  });
});

describe("the side panel", () => {
  it("opens over the preview without replacing it", async () => {
    await open();
    const preview = screen.getByRole("region", { name: "Preview" });
    const panel = within(preview).getByRole("complementary", { hidden: true });
    expect(panel).toHaveAttribute("data-state", "closed");
    fireEvent.click(screen.getByRole("button", { name: /Fields & variables/ }));
    expect(panel).toHaveAttribute("data-state", "open");
    expect(panel.className).toMatch(/absolute inset-y-0 right-0/);
    // The page is still there underneath, the same element.
    expect(within(preview).getByLabelText("Agreement preview")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Close the panel" }));
    expect(panel).toHaveAttribute("data-state", "closed");
  });

  it("clicking a variable inserts it at the cursor, and the preview fills it in", async () => {
    await open({ initialContent: "<p>Hello</p>", previewData: { vehicle_reg: "AB12 CDE" } });
    await openPanelTab("Variables");
    fireEvent.click(document.querySelector('[data-token="{{vehicle_reg}}"]') as HTMLElement);
    await waitFor(() => expect(previewBody()?.textContent).toContain("AB12 CDE"));
  });
});

describe("editing the default template", () => {
  it("template mode says saving changes what rentals send, only for the default", async () => {
    const first = await open({ mode: "template", isDefaultTemplate: true });
    expect(DEFAULT_TEMPLATE_HINT_V2).toBe("This is your default template — saving changes what rentals send from now on.");
    expect(screen.getByText(DEFAULT_TEMPLATE_HINT_V2)).toBeVisible();
    first.unmount();

    await open({ mode: "template" });
    expect(screen.queryByText(DEFAULT_TEMPLATE_HINT_V2)).toBeNull();
  });
});

describe("each signer field once", () => {
  it("a template with a field in it twice cannot be saved, and says why next to Save", async () => {
    const { onSave } = await open({ nameEditable: true, initialContent: "<p>Sign {{@sig1}}</p><p>Again {{@sig1}}</p>" });
    // A rename makes it dirty: it would be saveable but for the duplicate.
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Renamed" } });
    const save = screen.getByRole("button", { name: "Save template" });
    const reason = document.querySelector('[data-slot="duplicate-signer-fields"]') as HTMLElement;
    expect(reason).not.toBeNull();
    expect(reason.textContent).toMatch(/Signature is in the agreement 2 times\. Keep one/);
    expect(save).toBeDisabled();
    expect(save.getAttribute("aria-describedby")).toBe(reason.id);
    // Same header row as the button.
    expect(save.parentElement!.contains(reason)).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a one-off (usable as it is) is refused too", async () => {
    await open({ mode: "one-off", initialContent: "<p>{{@date1}}</p><p>{{@date1}}</p>" });
    await waitFor(() => expect(document.querySelector('[data-slot="duplicate-signer-fields"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: "Use for this agreement" })).toBeDisabled();
  });

  it("with each field once, nothing is said and Save works", async () => {
    await open({ mode: "one-off", initialContent: "<p>{{@sig1}} {{@init1}} {{@date1}}</p>" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use for this agreement" })).toBeEnabled());
    expect(document.querySelector('[data-slot="duplicate-signer-fields"]')).toBeNull();
  });
});

describe("the preview's transform and banner", () => {
  it("previewTransform is applied to the content the preview renders, never to what is saved", async () => {
    const previewTransform = vi.fn((html: string) => html.replace("<p>Welcome.</p>", "<p>Welcome.</p><p>INJECTED CLAUSE for {{customer_name}}</p>"));
    const { onSave } = await open({ nameEditable: true, previewTransform });
    // Substituted after the transform, like the rental Preview.
    await waitFor(() => expect(previewBody()?.textContent).toContain("INJECTED CLAUSE for Ada Lovelace"));
    expect(previewTransform).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Renamed" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    });
    expect(onSave.mock.calls[0][0]).not.toContain("INJECTED CLAUSE");
  });

  it("without a transform, the preview is the content as written", async () => {
    await open();
    await waitFor(() => expect(previewBody()?.textContent).toContain("Welcome."));
    expect(previewBody()!.textContent).not.toContain("INJECTED");
  });

  it("the banner is passed through in every mode; template mode has none unless given", async () => {
    const banner = () => document.querySelector('[data-slot="agreement-banner"]');
    const a = await open({ mode: "template" });
    expect(banner()).toBeNull();
    a.unmount();
    for (const mode of ["template", "one-off", "rental-template"] as const) {
      const b = await open({ mode, previewBanner: "Rental agreement" });
      expect(banner()?.textContent).toBe("RENTAL AGREEMENT");
      b.unmount();
    }
  });
});

describe("the operator's signature inside a table", () => {
  it("is refused at a cursor in a table cell, and the tab says why", async () => {
    signatureHook.state = { signature: PNG, isLoading: false };
    await open({ initialContent: "<table><tbody><tr><td><p>cell text</p></td></tr></tbody></table><p>after</p>" });
    const dom = screen.getByRole("textbox", { name: "Agreement text" }) as HTMLElement & {
      editor: { state: any; commands: { setTextSelection: (pos: number) => boolean } };
    };
    // The operator has clicked into the cell.
    fireEvent.focus(dom);
    let at = -1;
    dom.editor.state.doc.descendants((node: any, pos: number) => {
      if (at === -1 && node.isText && node.text.includes("cell text")) at = pos + 2;
    });
    await act(async () => {
      dom.editor.commands.setTextSelection(at);
    });
    await openPanelTab("Your signature");
    fireEvent.click(screen.getByRole("button", { name: "Use my signature" }));
    expect(await screen.findByText(`Not added. ${SIGNATURE_PLACEMENT_REASON}`)).toBeInTheDocument();
    expect(dom.innerHTML).not.toContain("data-operator-signature");
  });
});
