import { describe, expect, it } from "vitest";
import { patchProblems } from "@/components/customers-v2/customer-detail/customer-patch-rules";

/* QA sheet C3: what the customer record refuses to save. */
const row = { name: "Jordan Ellis", email: "jordan@drive247.test", phone: "+1 555 201 7788", customer_type: "Individual" };
const TODAY = new Date(2026, 10, 7);
const fields = (p: ReturnType<typeof patchProblems>) => p.flatMap((x) => x.fields).sort();

describe("patchProblems", () => {
  it("lets a normal edit through", () => {
    expect(patchProblems({ name: "Jordan A Ellis", email: "j.ellis@drive247.test" }, row, TODAY)).toEqual([]);
  });
  it("refuses a blank name and a name with numbers (C3.3)", () => {
    expect(fields(patchProblems({ name: "  " }, row, TODAY))).toEqual(["name"]);
    expect(fields(patchProblems({ name: "Jordan 2" }, row, TODAY))).toEqual(["name"]);
  });
  it("refuses a bad email but keeps the rest of the edit (C3.3)", () => {
    expect(fields(patchProblems({ email: "jordan@", address_city: "Springfield" }, row, TODAY))).toEqual(["email"]);
  });
  it("refuses removing both email and phone (C3.4)", () => {
    expect(fields(patchProblems({ email: "", phone: "" }, row, TODAY))).toEqual(["email", "phone"]);
    expect(patchProblems({ email: "" }, row, TODAY)).toEqual([]);
    expect(fields(patchProblems({ phone: "" }, { ...row, email: "" }, TODAY))).toEqual(["phone"]);
  });
  it("refuses a future date of birth", () => {
    expect(fields(patchProblems({ date_of_birth: "2027-01-01" }, row, TODAY))).toEqual(["date_of_birth"]);
    expect(patchProblems({ date_of_birth: "1990-05-14" }, row, TODAY)).toEqual([]);
  });
  it("checks next of kin like the add form does", () => {
    expect(fields(patchProblems({ nok_email: "sam@", nok_phone: "call me", nok_relationship: "Bro2" }, row, TODAY))).toEqual(
      ["nok_email", "nok_phone", "nok_relationship"],
    );
  });
  it("needs a company name for a company customer", () => {
    expect(fields(patchProblems({ customer_type: "Company" }, row, TODAY))).toEqual(["customer_type"]);
    expect(patchProblems({ customer_type: "Company", company_name: "Riverside LLC" }, row, TODAY)).toEqual([]);
  });
});
