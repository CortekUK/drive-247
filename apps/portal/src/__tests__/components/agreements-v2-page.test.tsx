/**
 * Agreements v2: the page (components/agreements-v2/agreements-page-v2.tsx).
 *
 * The overview, the templates section, the send dialog and the view dialog are
 * other files with their own tests; here they are stubs that record what the
 * page hands them. The list table and the filter panel are real, because what
 * matters here is that the search and the filters really narrow the rows, and
 * that Resend goes to the right place, with the right payload, only after a
 * confirmation, and only for someone allowed to send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

const state = vi.hoisted(() => ({
  tenant: { id: "tenant-1" } as { id: string } | null,
  canEdit: true,
  canEditSettings: true,
  params: new URLSearchParams(),
  list: { rows: [] as AgreementRowV2[], isLoading: false, error: null as unknown, refetch: vi.fn() },
  search: null as any,
  overview: null as any,
  sendDialog: null as any,
  viewDialog: null as any,
  agreementType: "original" as string | null,
  supabaseCalls: [] as unknown[][],
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({ syncAgreementsV2: vi.fn(), resendAgreementV2: vi.fn(), fetchAgreementDocumentV2: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => state.params }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: state.tenant }) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({
    canEdit: (tab: string) => tab === "agreements" && state.canEdit,
    canEditSettings: (tab: string) => tab === "templates" && state.canEditSettings,
  }),
}));
vi.mock("@/hooks/use-forced-empty-state", () => ({ useForcedEmptyState: () => false }));
vi.mock("@/lib/lean-context", () => ({ useIsLean: () => true }));
vi.mock("@/hooks/use-toast", () => ({ toast }));
vi.mock("@/components/shared/layout/page-search-slot", () => ({
  usePageSearch: (reg: unknown) => {
    state.search = reg;
  },
}));
vi.mock("@/components/shared/layout/overview-flip", () => ({
  OverviewFlip: ({ front, back, flipped }: any) => (
    <div data-testid="flip" data-flipped={String(flipped)}>
      {front}
      {back}
    </div>
  ),
}));
vi.mock("@/components/agreements-v2/agreements-overview-v2", () => ({
  AgreementsOverviewV2: (props: any) => {
    state.overview = props;
    return (
      <button type="button" data-testid="overview" onClick={props.onCreateTemplate}>
        overview of {props.rows.length}
      </button>
    );
  },
}));
vi.mock("@/components/agreements-v2/templates-section-v2", () => ({
  AgreementTemplatesSectionV2: () => <div data-testid="templates">templates</div>,
}));
vi.mock("@/components/agreements-v2/send-agreement-dialog-v2", () => ({
  SendAgreementDialogV2: (props: any) => {
    state.sendDialog = props;
    return props.open ? <div data-testid="send-dialog" /> : null;
  },
}));
vi.mock("@/components/agreements-v2/agreement-view-dialog-v2", () => ({
  AgreementViewDialogV2: (props: any) => {
    state.viewDialog = props;
    return props.open ? <div data-testid="view-dialog">{props.row?.id}</div> : null;
  },
  downloadSignedAgreementV2: vi.fn(async () => {}),
}));
vi.mock("@/hooks/use-agreements-list-v2", () => ({ useAgreementsListV2: () => state.list }));
vi.mock("@/lib/agreements-v2/api-client", () => api);
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const calls: unknown[] = [table];
    state.supabaseCalls.push(calls);
    const b: any = {
      select: (cols: string) => (calls.push(["select", cols]), b),
      eq: (col: string, value: unknown) => (calls.push(["eq", col, value]), b),
      maybeSingle: async () =>
        state.agreementType === null
          ? { data: null, error: null }
          : { data: { agreement_type: state.agreementType }, error: null },
    };
    return b;
  };
  return { supabase: { from: builder } };
});

import { AgreementsPageV2 } from "@/components/agreements-v2/agreements-page-v2";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const row = (over: Partial<AgreementRowV2> & { id: string }): AgreementRowV2 => ({
  kind: "rental",
  customerName: "Someone",
  customerEmail: "someone@example.com",
  sentAt: new Date(2026, 8, 20, 10, 0).toISOString(),
  status: "pending",
  rawStatus: "sent",
  rentalId: "rental-1",
  rentalRef: "R-1001",
  documentId: "doc-1",
  templateId: null,
  title: "Rental agreement",
  message: null,
  cc: [],
  signedAt: null,
  signedDocumentId: null,
  resentFromId: null,
  hasContentSnapshot: false,
  ...over,
});

const ANN = row({ id: "ann", customerName: "Ann Lee", customerEmail: "ann@lee.io", rentalId: "rental-ann", status: "pending", sentAt: new Date(2026, 8, 21, 9).toISOString() });
const BOB = row({ id: "bob", kind: "individual", customerName: "Bob Stone", customerEmail: "bob@stone.dev", rentalId: null, rentalRef: null, title: "NDA", status: "failed", rawStatus: "send_failed", sentAt: new Date(2026, 8, 19, 9).toISOString() });
const CAT = row({ id: "cat", customerName: "Cat Diaz", customerEmail: "cat@diaz.co", status: "signed", sentAt: new Date(2026, 8, 18, 9).toISOString() });

const fetchMock = vi.fn();

beforeEach(() => {
  state.tenant = { id: "tenant-1" };
  state.canEdit = true;
  state.canEditSettings = true;
  state.params = new URLSearchParams();
  state.list = { rows: [ANN, BOB, CAT], isLoading: false, error: null, refetch: vi.fn(async () => ({})) };
  state.agreementType = "original";
  state.supabaseCalls = [];
  nav.replace.mockReset();
  api.syncAgreementsV2.mockReset().mockResolvedValue({ updated: 0 });
  api.resendAgreementV2.mockReset().mockResolvedValue({ id: "bob-2", status: "sent" });
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

const bodyRows = () => screen.getAllByRole("row").slice(1);
const rowNames = () => bodyRows().map((r) => within(r).getAllByRole("cell")[0].textContent);

/**
 * The row's actions are icon buttons IN the row (2026-09-24), not items behind
 * a ⋯ trigger, so there is nothing to open. Found by the sentence each button
 * carries in `aria-label`, which is also its tooltip — `RowIconAction` in
 * agreements-table-v2.tsx.
 */
const ACTION_LABEL = {
  View: (who: string) => `View the agreement for ${who}`,
  Download: (who: string) => `Download the signed PDF for ${who}`,
  Resend: (who: string) => `Resend the agreement to ${who}`,
} as const;

const rowAction = (name: string, action: keyof typeof ACTION_LABEL) =>
  screen.getByRole("button", { name: ACTION_LABEL[action](name) });

/** Every action offered on that row, in render order. */
const rowActionLabels = (name: string) => {
  const row = screen.getByText(name).closest("tr")!;
  return within(row)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
};

const flush = () => act(async () => {});

describe("the header", () => {
  it("is Agreements, one line under it, and Send agreement, which opens the send dialog", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Agreements" })).toBeInTheDocument();
    expect(screen.getByText(/Send agreements for signature/)).toBeInTheDocument();
    expect(screen.queryByTestId("send-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send agreement" }));
    expect(screen.getByTestId("send-dialog")).toBeInTheDocument();
  });

  it("a sent agreement refetches the list", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    const before = state.list.refetch.mock.calls.length;
    act(() => state.sendDialog.onSent());
    expect(state.list.refetch.mock.calls.length).toBe(before + 1);
  });

  it("a manager (view only on this tab) gets no Send agreement and no Resend", async () => {
    state.canEdit = false;
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.queryByRole("button", { name: "Send agreement" })).toBeNull();
    expect(rowActionLabels("Ann Lee")).toEqual([ACTION_LABEL.View("Ann Lee")]);
    expect(state.viewDialog.onResend).toBeUndefined();
  });
});

describe("the list", () => {
  it("shows every agreement newest sent first", async () => {
    state.list.rows = [CAT, ANN, BOB];
    render(<AgreementsPageV2 />);
    await flush();
    expect(rowNames()).toEqual(["Ann LeeR-1001", "Bob StoneIndividual", "Cat DiazR-1001"]);
  });

  it("lends the top bar its search, which matches customer, email and title", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    expect(state.search.placeholder).toBe("Search agreements");
    expect(state.search.filters).toEqual(expect.objectContaining({ open: false, activeCount: 0 }));
    act(() => state.search.onChange("nda"));
    expect(rowNames()).toEqual(["Bob StoneIndividual"]);
    act(() => state.search.onChange("cat@diaz"));
    expect(rowNames()).toEqual(["Cat DiazR-1001"]);
    // The overview reads the same, filtered rows.
    expect(state.overview.rows.map((r: AgreementRowV2) => r.id)).toEqual(["cat"]);
    expect(state.overview.filtered).toBe(true);
  });

  it("the filter panel narrows the list and the top bar badges it", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    act(() => state.search.filters.onOpenChange(true));
    expect(screen.getByTestId("flip")).toHaveAttribute("data-flipped", "true");
    fireEvent.change(screen.getByLabelText("Filter by customer name"), { target: { value: "ann" } });
    expect(rowNames()).toEqual(["Ann LeeR-1001"]);
    expect(state.search.filters.activeCount).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Individual" }));
    // Ann is a rental agreement: nothing is both.
    expect(screen.getByText(/No agreements match/)).toBeInTheDocument();
    expect(state.search.filters.activeCount).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowNames()).toHaveLength(3);
  });

  it("a status chip keeps only that status", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(rowNames()).toEqual(["Bob StoneIndividual"]);
  });
});

describe("on load", () => {
  it("asks the signing service for news once, then reads the list again", async () => {
    const { rerender } = render(<AgreementsPageV2 />);
    await flush();
    expect(api.syncAgreementsV2).toHaveBeenCalledTimes(1);
    expect(state.list.refetch).toHaveBeenCalledTimes(1);
    rerender(<AgreementsPageV2 />);
    await flush();
    expect(api.syncAgreementsV2).toHaveBeenCalledTimes(1);
  });

  it("a failed sync is ignored, and the list is still read again", async () => {
    api.syncAgreementsV2.mockRejectedValueOnce(new Error("offline"));
    render(<AgreementsPageV2 />);
    await flush();
    expect(state.list.refetch).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("waits for the tenant: no sync, and no 'nothing here' while it loads", async () => {
    state.tenant = null;
    state.list.rows = [];
    render(<AgreementsPageV2 />);
    await flush();
    expect(api.syncAgreementsV2).not.toHaveBeenCalled();
    expect(screen.queryByText("Every agreement you send, in one place")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading agreements" })).toBeInTheDocument();
  });
});

describe("a failed read", () => {
  it("with nothing to show, says so and offers Try again", async () => {
    state.list.rows = [];
    state.list.error = { message: "Failed to fetch" };
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.queryByText("Every agreement you send, in one place")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Try loading your agreements again/ }));
    expect(state.list.refetch).toHaveBeenCalled();
  });

  it("over rows already on screen, keeps the rows and says the refresh failed", async () => {
    state.list.error = { message: "Failed to fetch" };
    render(<AgreementsPageV2 />);
    await flush();
    expect(rowNames()).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Try loading your agreements again/ })).toBeInTheDocument();
  });
});

describe("empty", () => {
  it("teaches a tenant with no agreements, with one action: Send agreement", async () => {
    state.list.rows = [];
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.getByText("Every agreement you send, in one place")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Send agreement" });
    expect(buttons).toHaveLength(2); // the header's and the empty state's
    fireEvent.click(buttons[1]);
    expect(screen.getByTestId("send-dialog")).toBeInTheDocument();
  });

  it("offers no action to a viewer who may not send", async () => {
    state.list.rows = [];
    state.canEdit = false;
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.getByText("Every agreement you send, in one place")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send agreement" })).toBeNull();
  });
});

describe("Resend", () => {
  const confirm = async () => {
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Resend" }));
    await flush();
  };

  it("asks first, then re-posts /api/esign with exactly the rental Agreement stage's payload", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Ann Lee", "Resend"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/earlier copy still waiting for a signature is cancelled/);
    // A send costs several e-sign credits (7 by default), never "one".
    expect(dialog.textContent).toMatch(/uses e-sign credits/);
    expect(dialog.textContent).not.toMatch(/one e-sign credit/);
    // No row records which template the earlier copy used, so say what it is rebuilt from.
    expect(dialog.textContent).toMatch(/current default template/);
    expect(fetchMock).not.toHaveBeenCalled();
    const refetchesBefore = state.list.refetch.mock.calls.length;
    await confirm();

    // The type is checked for THIS tenant's row before anything is sent.
    expect(state.supabaseCalls).toEqual([
      ["rental_agreements", ["select", "agreement_type"], ["eq", "id", "ann"], ["eq", "tenant_id", "tenant-1"]],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/esign");
    expect(JSON.parse(init.body)).toEqual({
      rentalId: "rental-ann",
      customerEmail: "ann@lee.io",
      customerName: "Ann Lee",
      tenantId: "tenant-1",
      agreementType: "original",
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Agreement resent" }));
    expect(state.list.refetch.mock.calls.length).toBe(refetchesBefore + 1);
  });

  it("cancelling sends nothing", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Ann Lee", "Resend"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.resendAgreementV2).not.toHaveBeenCalled();
  });

  it("never re-sends an extension agreement from here, because it would go out as the original", async () => {
    state.agreementType = "extension";
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Ann Lee", "Resend"));
    await confirm();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Resend it from the rental" }));
  });

  it("does not send for a row this tenant does not have", async () => {
    state.agreementType = null;
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Ann Lee", "Resend"));
    await confirm();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not sent", variant: "destructive" }));
  });

  it("says so when the route reports no credits", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: "insufficient_credits" }) });
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Ann Lee", "Resend"));
    await confirm();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No e-sign credits left", variant: "destructive" }));
  });

  it("an individual agreement is re-sent as a new row through the agreements service, never /api/esign", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Bob Stone", "Resend"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/as a new row in this list/);
    await confirm();
    // Tenant-scoped: the client reads the old row for THIS tenant only.
    expect(api.resendAgreementV2).toHaveBeenCalledWith("bob", "tenant-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.supabaseCalls).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Agreement resent" }));
  });

  it("an individual resend that the provider rejects is reported as not sent", async () => {
    api.resendAgreementV2.mockResolvedValueOnce({ id: "bob-2", status: "credit_failed" });
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Bob Stone", "Resend"));
    await confirm();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not sent", variant: "destructive" }));
  });
});

describe("View", () => {
  it("opens the view dialog on that row, with Resend handed over for a sender", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    fireEvent.click(rowAction("Bob Stone", "View"));
    expect(screen.getByTestId("view-dialog").textContent).toBe("bob");
    expect(typeof state.viewDialog.onResend).toBe("function");
    // Resend from the dialog closes it and asks for confirmation.
    act(() => state.viewDialog.onResend(BOB));
    expect(screen.queryByTestId("view-dialog")).toBeNull();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("templates", () => {
  it("mounts the templates section on the page", async () => {
    render(<AgreementsPageV2 />);
    await flush();
    expect(screen.getByTestId("templates").closest("section")?.id).toBe("agreement-templates");
  });

  it("Create your template asks the templates section to open its create, keeping other params", async () => {
    state.params = new URLSearchParams("foo=bar");
    render(<AgreementsPageV2 />);
    await flush();
    expect(state.overview.canCreateTemplate).toBe(true);
    fireEvent.click(screen.getByTestId("overview"));
    expect(nav.replace).toHaveBeenCalledWith("/agreements?foo=bar&view=templates&new=1", { scroll: false });
  });

  it("the card follows the template grant, not the send grant", async () => {
    state.canEditSettings = false;
    render(<AgreementsPageV2 />);
    await flush();
    expect(state.overview.canCreateTemplate).toBe(false);
  });

  it("leaves ?view=templates to the templates section, so the two never both scroll", async () => {
    // AgreementTemplatesSectionV2 owns the scroll (pinned in
    // agreements-v2-templates-section.test.tsx). It is mocked here, so any
    // scroll seen here would be the page's own second one.
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    state.params = new URLSearchParams("view=templates");
    render(<AgreementsPageV2 />);
    await screen.findByTestId("templates");
    await Promise.resolve();
    expect(scroll).not.toHaveBeenCalled();
    // The anchor stays, for links to #agreement-templates.
    expect(document.getElementById("agreement-templates")).not.toBeNull();
  });
});
