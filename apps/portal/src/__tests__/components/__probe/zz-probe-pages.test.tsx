/** PROBE — temporary. Index, lockbox messages, surfaces and headings. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const search = vi.hoisted(() => ({ reg: null as null | { value: string; onChange: (v: string) => void } }));
const state = vi.hoisted(() => ({
  tenant: { id: "t1", slug: "northwind", integration_twilio_sms: false } as any,
  rental: {} as any,
  templates: {} as any,
  canEdit: true,
}));

vi.mock("@/components/shared/layout/page-search-slot", () => ({ usePageSearch: (reg: any) => { search.reg = reg; } }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => state.canEdit, canViewSettings: () => true }),
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: state.tenant }) }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => state.rental }));
vi.mock("@/hooks/use-lockbox-templates", () => ({ useLockboxTemplates: () => state.templates }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (<a href={href} {...rest}>{children}</a>),
}));

import { SettingsIndexV2 } from "@/components/settings-v2/settings-index";
import { LockboxTemplatesSectionV2 } from "@/components/settings-v2/lockbox-templates-v2";
import { SettingsPageSaveProvider, SettingsPanel, SettingsRow, SettingsRowAlignProvider } from "@/components/settings-v2/settings-kit";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.rental = { settings: { lockbox_enabled: true }, hasLoaded: true, error: null, isFetching: false, refetch: vi.fn(), updateSettings: vi.fn(), isUpdating: false };
  state.templates = {
    templates: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    saveTemplate: vi.fn(),
    isSaving: false,
    upsertTemplate: { mutateAsync: vi.fn(), isPending: false },
  };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function dump(label: string) {
  const heads = Array.from(container.querySelectorAll("h1,h2,h3,h4")).map((e) => `${e.tagName} [${e.className}] ${(e.textContent ?? "").slice(0, 40)}`);
  const surfaces = new Map<string, number>();
  container.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const c = el.className;
    if (typeof c === "string" && /rounded-(xl|2xl|3xl)/.test(c)) {
      const key = c.split(/\s+/).filter((t) => /^rounded-|^border|^bg-|^shadow/.test(t)).join(" ");
      surfaces.set(key, (surfaces.get(key) ?? 0) + 1);
    }
  });
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} HEADINGS\n${heads.join("\n")}\n--- ${label} SURFACES\n${Array.from(surfaces).map(([k, n]) => `${n}x  ${k}`).join("\n")}`);
}

describe("PROBE pages", () => {
  it("settings index", () => {
    act(() => root.render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />));
    dump("INDEX");
    expect(container.textContent).toBeTruthy();
  });

  it("lockbox messages section (Customer messages)", () => {
    act(() =>
      root.render(
        <SettingsPageSaveProvider enabled>
          <SettingsRowAlignProvider align="end">
            <LockboxTemplatesSectionV2
              defaults={{ instructions: "1. Go to the car", email: { subject: "S", body: "Code: {{lockbox_code}}" }, sms: { body: "x" } }}
              variables={[{ token: "{{lockbox_code}}", label: "Lockbox code", example: "1234" } as any]}
              registerSave={() => () => {}}
              channels={["email"]}
              keyHandoverHref="/settings?tab=lockbox"
              readOnlyNotice
            />
          </SettingsRowAlignProvider>
        </SettingsPageSaveProvider>,
      ),
    );
    dump("LOCKBOX-MESSAGES");
    expect(container.textContent).toBeTruthy();
  });

  it("the two template-link rows of Customer messages (page.tsx), end-aligned", () => {
    act(() =>
      root.render(
        <SettingsRowAlignProvider align="end">
          <SettingsPanel>
            <SettingsRow label="Email templates" description="Booking confirmations…">
              <a href="/x">Edit emails</a>
            </SettingsRow>
          </SettingsPanel>
        </SettingsRowAlignProvider>,
      ),
    );
    dump("TEMPLATE-LINKS");
    expect(container.textContent).toBeTruthy();
  });
});
