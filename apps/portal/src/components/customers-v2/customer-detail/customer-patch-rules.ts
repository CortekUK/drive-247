/*
 * What the customer record will not save, and why — QA sheet C3.
 *
 * The record saves as you type, and it used to save anything: a blank name, a
 * bad email, a customer with neither email nor phone. These are the same rules
 * the Add Customer form applies (client-schemas/customers/customer-form-modal),
 * checked on the fields a single edit touches. A field that breaks a rule is
 * left out of the write and said out loud; the rest of the edit still saves.
 *
 * Pure: no database. The blocked / duplicate licence checks need the database
 * and live in use-customer-draft.ts.
 */

export type PatchValue = string | boolean | null | undefined;
export type Problem = { fields: string[]; message: string };

const blank = (v: PatchValue) => v == null || (typeof v === "string" && v.trim() === "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9\s\-()+]+$/;

/** Problems with an edit, given the record as it stands before it. */
export function patchProblems(
  patch: Record<string, PatchValue>,
  row: Record<string, PatchValue> | null | undefined,
  today = new Date(),
): Problem[] {
  const out: Problem[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  const after = (k: string) => (has(k) ? patch[k] : row?.[k]);
  const str = (k: string) => (typeof patch[k] === "string" ? (patch[k] as string).trim() : "");

  if (has("name")) {
    if (blank(patch.name)) out.push({ fields: ["name"], message: "A customer needs a name, so the name was not changed." });
    else if (/\d/.test(str("name"))) out.push({ fields: ["name"], message: "A name can't contain numbers, so it was not changed." });
  }
  if (has("email") && !blank(patch.email) && !EMAIL.test(str("email"))) {
    out.push({ fields: ["email"], message: `"${str("email")}" isn't a valid email address, so it was not saved.` });
  }
  if (has("phone") && !blank(patch.phone) && !PHONE.test(str("phone"))) {
    out.push({ fields: ["phone"], message: "A phone number can only contain numbers and + - ( ), so it was not saved." });
  }
  if ((has("email") || has("phone")) && blank(after("email")) && blank(after("phone"))) {
    out.push({
      fields: ["email", "phone"].filter(has),
      message: "Keep an email or a phone number — a customer needs one way to be reached.",
    });
  }
  if (has("date_of_birth") && !blank(patch.date_of_birth)) {
    const iso = str("date_of_birth").slice(0, 10);
    const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (iso > t) out.push({ fields: ["date_of_birth"], message: "A date of birth can't be in the future, so it was not saved." });
  }
  if (has("nok_full_name") && /\d/.test(str("nok_full_name"))) {
    out.push({ fields: ["nok_full_name"], message: "The next of kin's name can't contain numbers, so it was not saved." });
  }
  if (has("nok_relationship") && !blank(patch.nok_relationship) && !/^[a-zA-Z\s]+$/.test(str("nok_relationship"))) {
    out.push({ fields: ["nok_relationship"], message: "Relationship can only contain letters, so it was not saved." });
  }
  if (has("nok_email") && !blank(patch.nok_email) && !EMAIL.test(str("nok_email"))) {
    out.push({ fields: ["nok_email"], message: "The next of kin's email isn't valid, so it was not saved." });
  }
  if (has("nok_phone") && !blank(patch.nok_phone) && !PHONE.test(str("nok_phone"))) {
    out.push({ fields: ["nok_phone"], message: "The next of kin's phone can only contain numbers and + - ( ), so it was not saved." });
  }
  if ((has("company_name") || has("customer_type")) && after("customer_type") === "Company" && blank(after("company_name"))) {
    out.push({ fields: ["company_name", "customer_type"].filter(has), message: "A company customer needs a company name." });
  }
  return out;
}
