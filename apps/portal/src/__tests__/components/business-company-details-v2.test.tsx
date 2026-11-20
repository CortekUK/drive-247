/**
 * v2 Settings › General › Company details (QA B1, 2026-11-10).
 *
 * Before this section a v2 tenant had no way to change its company name,
 * contact email, phone or address from the portal. These pin what the QA run
 * exercised by hand: the rules (B1.3, B1.4), the save and its refusals
 * (B1.2), a viewer's locked panel (B1.11), and the Booking site row that says
 * when Site settings shows its own contact details instead (B1.7).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  BusinessCompanyPanel,
  COMPANY_NAME_MAX,
  companyFieldId,
  companySaveIssue,
  companySiteOverrideCopy,
  isCompanyDirty,
  saveCompanyV2,
  savedCompanyV2,
  validateCompanyV2,
  type CompanyValues,
} from "@/components/settings-v2/business-settings-states";
import { companySiteOverrideFromContact } from "@/hooks/use-company-site-override-v2";
import { settingsSaveIssueField } from "@/components/settings-v2/settings-kit";
import { V2_GENERAL_SECTIONS } from "@/components/settings-v2/settings-shell-state";

const SAVED: CompanyValues = {
  company_name: "Northwind Rentals",
  contact_email: "hello@northwind.example",
  contact_phone: "",
  address: "",
};

describe("Company details is the first section of General", () => {
  it("sits at the top of the page, under the general permission, and is what ?tab=general opens", () => {
    const first = V2_GENERAL_SECTIONS[0];
    expect(first).toMatchObject({ anchor: "company", title: "Company details", permTab: "general", tab: "general", atPageTop: true });
    // Regional moved down: it keeps its permission but no longer owns the tab.
    expect(V2_GENERAL_SECTIONS[1]).toMatchObject({ anchor: "regional", permTab: "general", tab: null });
  });
});

describe("savedCompanyV2 / isCompanyDirty", () => {
  it("reads the tenant row with blanks for nulls, and the phone from contact_phone, else phone", () => {
    expect(savedCompanyV2(null)).toEqual({ company_name: "", contact_email: "", contact_phone: "", address: "" });
    expect(savedCompanyV2({ company_name: "A", contact_email: "a@b.co", contact_phone: null, phone: "+1 2", address: null })).toEqual({
      company_name: "A",
      contact_email: "a@b.co",
      contact_phone: "+1 2",
      address: "",
    });
    expect(savedCompanyV2({ contact_phone: "+1 1", phone: "+1 2" }).contact_phone).toBe("+1 1");
  });

  it("ignores whitespace-only edits", () => {
    expect(isCompanyDirty({ ...SAVED, company_name: "Northwind Rentals " }, SAVED)).toBe(false);
    expect(isCompanyDirty({ ...SAVED, company_name: "Northwind Rentals QA" }, SAVED)).toBe(true);
  });
});

describe("validateCompanyV2 (B1.3, B1.4)", () => {
  it("needs a name and a real email; the phone and address are optional", () => {
    expect(validateCompanyV2(SAVED)).toEqual({});
    expect(validateCompanyV2({ ...SAVED, company_name: "   " }).company_name).toBe("Enter your company name.");
    expect(validateCompanyV2({ ...SAVED, company_name: "x".repeat(COMPANY_NAME_MAX + 1) }).company_name).toMatch(/120 characters/);
    expect(validateCompanyV2({ ...SAVED, contact_email: "" }).contact_email).toBe("Enter a contact email address.");
    expect(validateCompanyV2({ ...SAVED, contact_email: "not-an-email" }).contact_email).toBe(
      "Enter a valid email address, like name@company.com.",
    );
  });

  it("accepts the phone formats people type and refuses the rest", () => {
    for (const ok of ["+1 415 555 0142", "(415) 555-0142", "415.555.0142", "+44 20 7946 0958"]) {
      expect(validateCompanyV2({ ...SAVED, contact_phone: ok }).contact_phone, ok).toBeUndefined();
    }
    for (const bad of ["12", "call me", "+1 415 555 0142 ext 9", "1234567890123456"]) {
      expect(validateCompanyV2({ ...SAVED, contact_phone: bad }).contact_phone, bad).toBe("Enter a valid phone number, like +1 415 555 0142.");
    }
  });

  it("companySaveIssue names the first bad field, in the page's order, with its input id", () => {
    const issue = companySaveIssue(validateCompanyV2({ ...SAVED, company_name: "", contact_email: "x" }));
    expect(issue?.message).toBe("Enter your company name.");
    expect(settingsSaveIssueField(issue)).toBe(companyFieldId("company_name"));
    expect(companySaveIssue({})).toBeNull();
  });
});

describe("saveCompanyV2 (B1.2)", () => {
  const values: CompanyValues = {
    company_name: " Northwind Rentals QA ",
    contact_email: "hello@northwind-rentals.test ",
    contact_phone: " +1 415 555 0142",
    address: "",
  };

  it("writes the trimmed values, the phone to both phone columns, and null for blanks", async () => {
    const writeTenant = vi.fn(async () => ({ data: [{ id: "t1" }], error: null }));
    await saveCompanyV2({ tenantId: "t1", values, writeTenant });
    expect(writeTenant).toHaveBeenCalledWith({
      company_name: "Northwind Rentals QA",
      contact_email: "hello@northwind-rentals.test",
      contact_phone: "+1 415 555 0142",
      phone: "+1 415 555 0142",
      address: null,
    });
  });

  it("refuses before writing when a field is invalid, without a tenant, and when the write touches no row", async () => {
    const writeTenant = vi.fn(async () => ({ data: [{ id: "t1" }], error: null }));
    await expect(saveCompanyV2({ tenantId: "t1", values: { ...values, contact_email: "nope" }, writeTenant })).rejects.toThrow(
      /valid email address/,
    );
    expect(writeTenant).not.toHaveBeenCalled();
    await expect(saveCompanyV2({ tenantId: null, values, writeTenant })).rejects.toThrow(/haven't loaded/);
    const zeroRows = vi.fn(async () => ({ data: [], error: null }));
    await expect(saveCompanyV2({ tenantId: "t1", values, writeTenant: zeroRows })).rejects.toThrow(/permission/);
    const failed = vi.fn(async () => ({ data: null, error: new Error("boom") }));
    await expect(saveCompanyV2({ tenantId: "t1", values, writeTenant: failed })).rejects.toThrow("boom");
  });
});

describe("the Booking site row (B1.7)", () => {
  it("derives the site's own contact details the way the booking site does, or null when it fills none", () => {
    expect(companySiteOverrideFromContact(null)).toBeNull();
    expect(companySiteOverrideFromContact({ email: "", phone: "", address_line1: "", city: "" })).toBeNull();
    expect(
      companySiteOverrideFromContact({
        email: "hello@northwindrentals.com",
        phone: "(555) 000-1234",
        phone_display: "",
        address_line1: "1200 Market Street",
        address_line2: "",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      }),
    ).toEqual({ email: "hello@northwindrentals.com", phone: "(555) 000-1234", address: "1200 Market Street, Springfield, IL, 62701" });
  });

  it("says what visitors see, and where to change it when it is not this section", () => {
    expect(companySiteOverrideCopy(null)).toEqual({ lead: "Your booking site shows the name and contact details above.", values: [], action: null });
    const own = companySiteOverrideCopy({ email: "a@b.co", phone: null, address: "1 Main St" });
    expect(own.values).toEqual(["a@b.co", "1 Main St"]);
    expect(own.action).toMatch(/Site settings/);
  });
});

describe("BusinessCompanyPanel", () => {
  const renderPanel = (props: Partial<React.ComponentProps<typeof BusinessCompanyPanel>> = {}) => {
    const onSave = vi.fn(async () => undefined);
    const onDiscard = vi.fn();
    const onFormChange = vi.fn();
    const utils = render(
      <BusinessCompanyPanel
        form={SAVED}
        saved={SAVED}
        canEdit
        ready
        onFormChange={onFormChange}
        onSave={onSave}
        onDiscard={onDiscard}
        siteOverride={null}
        {...props}
      />,
    );
    return { ...utils, onSave, onDiscard, onFormChange };
  };

  it("B1.1: shows the four details with their saved values and the Booking site row", () => {
    renderPanel();
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Northwind Rentals");
    expect((screen.getByLabelText("Contact email") as HTMLInputElement).value).toBe("hello@northwind.example");
    expect(screen.getByLabelText("Contact phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.getByText("Your booking site shows the name and contact details above.")).toBeInTheDocument();
  });

  it("B1.11: a viewer sees everything locked and no Save", () => {
    renderPanel({ canEdit: false });
    for (const label of ["Company name", "Contact email", "Contact phone", "Address"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  it("B1.2 / B1.3: Save is off until something changes, saves a valid form, and refuses a bad email with the message under its box", async () => {
    const { rerender, onSave, onFormChange } = renderPanel();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Northwind Rentals QA" } });
    expect(onFormChange).toHaveBeenCalledWith({ company_name: "Northwind Rentals QA" });
    rerender(
      <BusinessCompanyPanel form={{ ...SAVED, company_name: "Northwind Rentals QA" }} saved={SAVED} canEdit ready onFormChange={onFormChange} onSave={onSave} onDiscard={vi.fn()} siteOverride={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    rerender(
      <BusinessCompanyPanel form={{ ...SAVED, contact_email: "not-an-email" }} saved={SAVED} canEdit ready onFormChange={onFormChange} onSave={onSave} onDiscard={vi.fn()} siteOverride={null} />,
    );
    expect(screen.getByText("Enter a valid email address, like name@company.com.")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("B1.7: when Site settings fills the booking site's contact details, says so and links to Site settings", () => {
    renderPanel({ siteOverride: { email: "hello@northwindrentals.com", phone: "(555) 000-1234", address: "1200 Market Street, Springfield, IL, 62701" } });
    expect(screen.getByText(/shows its own contact details/)).toBeInTheDocument();
    expect(screen.getByText("hello@northwindrentals.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Site settings" })).toHaveAttribute("href", "/cms/site-settings");
  });
  // The not-yet-ready state is `SettingsPanelSkeleton`, the same one Regional
  // draws; its measuring skeleton does not render under jsdom, so it is not
  // mounted here (business-settings-states.test covers the shared component).
});
