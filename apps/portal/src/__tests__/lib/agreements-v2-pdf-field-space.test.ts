import { describe, expect, it } from "vitest";
import { signerFieldHeight } from "@/lib/agreements-v2/pdf";

// QA sheet A7.11: a signer field is taller than a line, so the PDF leaves its
// height clear below the line it sits on. Heights match agreements-v2/provider.ts.
describe("signerFieldHeight", () => {
  it("is 0 for ordinary text", () => {
    expect(signerFieldHeight("Name: Haris Zahid")).toBe(0);
  });
  it("gives each signer field its height", () => {
    expect(signerFieldHeight("Signature: {{@sig1}}")).toBe(50);
    expect(signerFieldHeight("Initials: {{@init1}}")).toBe(40);
    expect(signerFieldHeight("Date signed: {{@date1}}")).toBe(30);
  });
  it("takes the tallest when a line has more than one", () => {
    expect(signerFieldHeight("{{@date1}} {{@sig1}}")).toBe(50);
  });
  it("ignores tags it does not know", () => {
    expect(signerFieldHeight("{{@other1}} {{customer_name}}")).toBe(0);
  });
});
