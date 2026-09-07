/**
 * The rule this file exists to enforce: an unpaid or failed invoice has a bill
 * and NO receipt. Offering proof of a payment that never arrived is the one
 * defect worth a test of its own.
 */
import { describe, expect, it } from "vitest";
import {
  billingDocumentsOf,
  billingStatusOf,
  BILLING_STATUS_LABEL,
} from "@/lib/billing-documents";

const row = (over: Partial<Parameters<typeof billingStatusOf>[0]> = {}) => ({
  status: "open",
  due_date: null,
  attempt_count: 0,
  amount_paid: 0,
  amount_refunded: 0,
  stripe_hosted_invoice_url: "https://invoice.stripe.com/i/x",
  stripe_invoice_pdf: "https://invoice.stripe.com/i/x.pdf",
  stripe_receipt_url: null,
  ...over,
});

describe("status", () => {
  it("reads a paid invoice as paid", () => {
    expect(billingStatusOf(row({ status: "paid", amount_paid: 9900 }))).toBe("paid");
  });

  it("reads an attempted-and-open invoice as failed", () => {
    /* Stripe has no "failed" invoice status — an open invoice with a retry
       behind it is a card that was tried and declined. */
    expect(billingStatusOf(row({ status: "open", attempt_count: 2 }))).toBe("failed");
  });

  it("reads an untried invoice past its due date as overdue", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(billingStatusOf(row({ status: "open", due_date: yesterday }))).toBe("overdue");
  });

  it("reads an untried invoice still in date as due", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(billingStatusOf(row({ status: "open", due_date: tomorrow }))).toBe("due");
    expect(billingStatusOf(row({ status: "open", due_date: null }))).toBe("due");
  });

  it("prefers 'failed' to 'overdue' — the more informative of the two", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(billingStatusOf(row({ status: "open", attempt_count: 3, due_date: yesterday })))
      .toBe("failed");
  });

  it("treats void and uncollectible as terminal, ahead of everything", () => {
    expect(billingStatusOf(row({ status: "void", attempt_count: 5 }))).toBe("void");
    expect(billingStatusOf(row({ status: "uncollectible" }))).toBe("void");
  });

  it("surfaces a refund over a paid status", () => {
    expect(billingStatusOf(row({ status: "paid", amount_paid: 9900, amount_refunded: 9900 })))
      .toBe("refunded");
  });

  it("survives a malformed due date rather than throwing", () => {
    expect(billingStatusOf(row({ status: "open", due_date: "not a date" }))).toBe("due");
  });

  it("has a label for every status it can return", () => {
    for (const s of ["paid", "failed", "overdue", "due", "refunded", "void"] as const) {
      expect(BILLING_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe("documents", () => {
  it("offers NO receipt when the payment never succeeded", () => {
    for (const bad of [
      row({ status: "open" }),
      row({ status: "open", attempt_count: 3 }),
      row({ status: "void" }),
    ]) {
      const docs = billingDocumentsOf(bad);
      expect(docs.hasReceipt).toBe(false);
      expect(docs.receiptView).toBeNull();
      expect(docs.receiptDownload).toBeNull();
      /* …but the bill is still there. An unpaid invoice is exactly the one you
         most want to open. */
      expect(docs.hasInvoice).toBe(true);
    }
  });

  it("offers no receipt for a PAID invoice whose receipt never synced", () => {
    /* Derived from the stored URL, never from the status: with nothing real to
       show, showing nothing beats fabricating a link. */
    const docs = billingDocumentsOf(row({ status: "paid", amount_paid: 9900 }));
    expect(docs.hasReceipt).toBe(false);
  });

  it("offers both documents once the receipt is on record", () => {
    const docs = billingDocumentsOf(
      row({
        status: "paid",
        amount_paid: 9900,
        stripe_receipt_url: "https://pay.stripe.com/receipts/abc",
      }),
    );
    expect(docs.hasInvoice).toBe(true);
    expect(docs.hasReceipt).toBe(true);
    expect(docs.invoiceView).toContain("invoice.stripe.com");
    expect(docs.receiptView).toContain("receipts");
  });

  it("offers no invoice actions when neither invoice link exists", () => {
    const docs = billingDocumentsOf(
      row({ stripe_hosted_invoice_url: null, stripe_invoice_pdf: null }),
    );
    expect(docs.hasInvoice).toBe(false);
  });
});
