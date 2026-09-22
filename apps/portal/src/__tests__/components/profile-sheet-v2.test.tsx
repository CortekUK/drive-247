/**
 * The v2 profile panel: where it opens from, and what each field writes.
 *
 * THE BUG THIS FILE EXISTS FOR
 * ----------------------------
 * "It still says Super Admin after saving a name." The old panel wrote
 * `tenants.admin_name` — the organisation's admin contact — while the sidebar
 * row, the menu header and the panel itself all read `app_users.name`. The
 * write succeeded, the toast said "Name updated successfully", and nothing on
 * screen changed. A test that only checked "a write happened" would have
 * passed against that bug, so these cases assert the TABLE and the COLUMN.
 *
 * The rest:
 *  - it comes from the TOP (`data-side="top"`), which is what was asked for;
 *  - an ops user does NOT rename the organisation's admin contact, and a head
 *    admin does, because the dashboard greeting reads it;
 *  - the email change goes through Supabase's own confirmation and writes
 *    nothing itself;
 *  - the password change asks for a code only when Supabase demands one, and
 *    then sends it as the `nonce`.
 *
 * HARNESS: `react-dom/client` + `act`, as the other dialog tests here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ProfileSheetV2 } from "@/components/shared/layout/profile-sheet-v2";

/* ── the signed-in user, and the store the panel repaints through ─────────── */

const setState = vi.fn();
const updatePassword = vi.fn();
let appUser: Record<string, unknown> = {};

vi.mock("@/stores/auth-store", () => ({
  useAuth: () => ({ appUser, updatePassword }),
  useAuthStore: { setState: (...args: unknown[]) => setState(...args) },
}));

/* ── the database, recorded rather than performed ─────────────────────────── */

type Write = { table: string; values: Record<string, unknown>; column: string; value: unknown };
let writes: Write[] = [];
let authEmail: string | null = "owner@example.invalid";
const updateUser = vi.fn(async () => ({ data: {}, error: null as any }));
const reauthenticate = vi.fn(async () => ({ data: {}, error: null as any }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          writes.push({ table, values, column, value });
          return { error: null };
        },
      }),
    }),
    auth: {
      getUser: async () => ({ data: { user: authEmail ? { email: authEmail } : null }, error: null }),
      updateUser: (...args: unknown[]) => (updateUser as any)(...args),
      reauthenticate: () => reauthenticate(),
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  },
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

vi.mock("@/components/shared/layout/avatar-crop-dialog", () => ({
  AvatarCropDialog: () => null,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  writes = [];
  authEmail = "owner@example.invalid";
  appUser = {
    id: "app-user-1",
    tenant_id: "tenant-1",
    name: "Super Admin",
    email: "owner@example.invalid",
    role: "ops",
    is_super_admin: false,
    must_change_password: false,
    avatar_url: null,
  };
  updatePassword.mockResolvedValue({ error: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const sheet = () => document.querySelector('[data-testid="profile-sheet"]') as HTMLElement;
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;

async function open() {
  await act(async () => {
    root.render(<ProfileSheetV2 open onOpenChange={() => undefined} />);
  });
  // Let the reconcile effect settle.
  await act(async () => {
    await Promise.resolve();
  });
}

/** React tracks the DOM value, so a bare `el.value = …` is not seen by onChange. */
async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("where it opens from", () => {
  it("is a sheet from the TOP, not a centred dialog or a side panel", async () => {
    await open();
    expect(sheet()).not.toBeNull();
    expect(sheet().getAttribute("data-side")).toBe("top");
  });

  it("seeds the fields from the signed-in user", async () => {
    await open();
    expect(input("profile-name").value).toBe("Super Admin");
    expect(input("profile-email").value).toBe("owner@example.invalid");
  });
});

describe("the display name", () => {
  it("writes app_users.name — the column every screen reads — and repaints the store", async () => {
    await open();
    await type(input("profile-name"), "Ilyas");
    await click(buttonByText("Save"));

    expect(writes).toEqual([
      { table: "app_users", values: { name: "Ilyas" }, column: "id", value: "app-user-1" },
    ]);
    expect(setState).toHaveBeenCalledWith({
      appUser: expect.objectContaining({ name: "Ilyas" }),
    });
  });

  it("does NOT rename the organisation's admin contact for an ops user", async () => {
    await open();
    await type(input("profile-name"), "Ilyas");
    await click(buttonByText("Save"));

    expect(writes.some((w) => w.table === "tenants")).toBe(false);
  });

  it("does keep tenants.admin_name in step for a head admin, whose greeting reads it", async () => {
    appUser = { ...appUser, role: "head_admin" };
    await open();
    await type(input("profile-name"), "Ilyas");
    await click(buttonByText("Save"));

    expect(writes).toEqual([
      { table: "app_users", values: { name: "Ilyas" }, column: "id", value: "app-user-1" },
      { table: "tenants", values: { admin_name: "Ilyas" }, column: "id", value: "tenant-1" },
    ]);
  });

  it("never renames a tenant a super admin is only looking at", async () => {
    appUser = { ...appUser, role: "head_admin", is_super_admin: true };
    await open();
    await type(input("profile-name"), "Ilyas");
    await click(buttonByText("Save"));

    expect(writes.some((w) => w.table === "tenants")).toBe(false);
  });
});

describe("the email", () => {
  it("goes through Supabase's confirmation and writes nothing itself", async () => {
    await open();
    await type(input("profile-email"), "new@example.invalid");
    await click(buttonByText("Confirm change"));

    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.invalid" });
    expect(writes).toEqual([]);
    expect(sheet().textContent).toContain("new@example.invalid");
  });

  it("reconciles app_users.email when Auth has already moved on", async () => {
    // The confirmation link was opened in another tab yesterday: Auth holds the
    // new address and `app_users` still holds the old one.
    authEmail = "confirmed@example.invalid";
    await open();

    expect(writes).toEqual([
      {
        table: "app_users",
        values: { email: "confirmed@example.invalid" },
        column: "id",
        value: "app-user-1",
      },
    ]);
    expect(setState).toHaveBeenCalledWith({
      appUser: expect.objectContaining({ email: "confirmed@example.invalid" }),
    });
  });

  it("writes nothing when the two already agree", async () => {
    await open();
    expect(writes).toEqual([]);
  });
});

describe("the password", () => {
  /** The badge rides inside the button when a change is required, so match the start. */
  const changePasswordButton = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.trim().startsWith("Change password"),
    )!;

  const fill = async () => {
    await click(changePasswordButton());
    await type(input("new-password"), "Sunflower12345");
    await type(input("confirm-password"), "Sunflower12345");
  };

  it("changes directly when Supabase does not ask for anything else", async () => {
    await open();
    await fill();
    await click(buttonByText("Update password"));

    expect(updatePassword).toHaveBeenCalledWith("Sunflower12345");
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("asks for the emailed code only when Supabase demands reauthentication", async () => {
    updatePassword.mockResolvedValue({ error: { code: "reauthentication_needed", message: "…" } });
    await open();
    await fill();
    await click(buttonByText("Update password"));

    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(input("reauth-code")).toBeTruthy();
    // Nothing has changed yet — this is a second step, not a failure.
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sends the code as the nonce, and clears the forced-change flag", async () => {
    updatePassword.mockResolvedValue({ error: { code: "reauthentication_needed", message: "…" } });
    appUser = { ...appUser, must_change_password: true };
    await open();
    await fill();
    await click(buttonByText("Update password"));
    await type(input("reauth-code"), "123456");
    await click(buttonByText("Confirm and update"));

    expect(updateUser).toHaveBeenCalledWith({ password: "Sunflower12345", nonce: "123456" });
    expect(writes).toEqual([
      {
        table: "app_users",
        values: { must_change_password: false },
        column: "id",
        value: "app-user-1",
      },
    ]);
  });

  it("refuses a password that does not meet the rules, before any call", async () => {
    await open();
    await click(changePasswordButton());
    await type(input("new-password"), "short");
    await type(input("confirm-password"), "short");
    await click(buttonByText("Update password"));

    expect(updatePassword).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("is not offered to a super admin", async () => {
    appUser = { ...appUser, is_super_admin: true };
    await open();
    expect(changePasswordButton()).toBeUndefined();
  });
});
