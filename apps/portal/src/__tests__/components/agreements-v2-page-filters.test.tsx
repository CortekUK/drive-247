/**
 * Agreements v2: the list's filters (lib/agreements-v2/list-filters.ts).
 *
 * Every expectation below is worked out by hand from the fixture. Dates are
 * built in LOCAL time, because the filter compares the operator's own calendar
 * days (the zone the Sent column prints in), so these hold in any zone the
 * suite runs in.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_AGREEMENT_FILTERS_V2,
  agreementsNewestFirstV2,
  agreementsResultKeyV2,
  countActiveAgreementFilters,
  filterAgreementsV2,
  matchesAgreementCustomer,
  matchesAgreementKind,
  matchesAgreementSearch,
  matchesAgreementSentRange,
  matchesAgreementStatus,
  type AgreementListFiltersV2,
} from "@/lib/agreements-v2/list-filters";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

const at = (m: number, d: number, h = 12, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).toISOString();
/** How the panel stores a picked day: local noon. */
const day = (m: number, d: number) => new Date(2026, m - 1, d, 12, 0, 0);

const row = (over: Partial<AgreementRowV2> & { id: string }): AgreementRowV2 => ({
  kind: "rental",
  customerName: "Someone",
  customerEmail: "someone@example.com",
  sentAt: at(9, 10),
  status: "pending",
  rawStatus: "sent",
  rentalId: "r-1",
  rentalRef: "R-1001",
  documentId: "doc-1",
  templateId: null,
  title: null,
  message: null,
  cc: [],
  signedAt: null,
  signedDocumentId: null,
  resentFromId: null,
  hasContentSnapshot: false,
  ...over,
});

const ann = row({ id: "ann", customerName: "Ann Lee", customerEmail: "ann@lee.io", status: "signed", sentAt: at(9, 18, 0, 0, 5), rentalRef: "R-2040" });
const bob = row({ id: "bob", customerName: "Bob Stone", customerEmail: "bob@stone.dev", kind: "individual", rentalId: null, rentalRef: null, title: "Parking bay licence", status: "pending", sentAt: at(9, 20, 23, 59, 30) });
const cat = row({ id: "cat", customerName: "Cat Diaz", customerEmail: "cat@diaz.co", status: "failed", rawStatus: "credit_failed", sentAt: at(9, 21, 0, 0, 10), documentId: null });
const dan = row({ id: "dan", customerName: "Dan Wu", customerEmail: "DAN@WU.COM", kind: "individual", rentalId: null, rentalRef: null, title: "NDA", status: "signed", sentAt: at(9, 17, 23, 59) });
const eve = row({ id: "eve", customerName: "Eve Park", customerEmail: "eve@park.io", status: "pending", sentAt: null });
const ROWS = [ann, bob, cat, dan, eve];
const ids = (rows: AgreementRowV2[]) => rows.map((r) => r.id);

describe("customer filter", () => {
  it("matches part of the name in any case, and ignores surrounding spaces", () => {
    expect(matchesAgreementCustomer(ann, "  lEe ")).toBe(true);
    expect(matchesAgreementCustomer(bob, "lee")).toBe(false);
    expect(matchesAgreementCustomer(bob, "")).toBe(true);
  });

  it("does not look at the email", () => {
    // "wu.com" is in Dan's email only.
    expect(matchesAgreementCustomer(dan, "wu.com")).toBe(false);
  });
});

describe("sent date range", () => {
  it("includes the whole of the last day", () => {
    // Bob was sent Sep 20 at 23:59:30; the range ends on Sep 20.
    expect(matchesAgreementSentRange(bob, undefined, day(9, 20))).toBe(true);
    // Cat was sent 10 seconds into Sep 21: outside a range ending Sep 20.
    expect(matchesAgreementSentRange(cat, undefined, day(9, 20))).toBe(false);
  });

  it("includes the whole of the first day", () => {
    // Ann: Sep 18 00:00:05. Dan: Sep 17 23:59, one minute before it.
    expect(matchesAgreementSentRange(ann, day(9, 18), undefined)).toBe(true);
    expect(matchesAgreementSentRange(dan, day(9, 18), undefined)).toBe(false);
  });

  it("reads From after To as the same range the other way round", () => {
    expect(matchesAgreementSentRange(ann, day(9, 20), day(9, 18))).toBe(true);
    expect(matchesAgreementSentRange(cat, day(9, 20), day(9, 18))).toBe(false);
  });

  it("puts a row with no sent time out as soon as either end is set, and in when neither is", () => {
    expect(matchesAgreementSentRange(eve, undefined, undefined)).toBe(true);
    expect(matchesAgreementSentRange(eve, day(9, 1), undefined)).toBe(false);
    expect(matchesAgreementSentRange(eve, undefined, day(9, 30))).toBe(false);
  });

  it("a single-day range is that one calendar day", () => {
    const same = filterAgreementsV2(ROWS, { ...EMPTY_AGREEMENT_FILTERS_V2, sentFrom: day(9, 20), sentTo: day(9, 20) }, "");
    expect(ids(same)).toEqual(["bob"]);
  });
});

describe("status and kind", () => {
  it("status 'all' keeps everything; otherwise only that status", () => {
    expect(ROWS.every((r) => matchesAgreementStatus(r, "all"))).toBe(true);
    expect(ids(ROWS.filter((r) => matchesAgreementStatus(r, "signed")))).toEqual(["ann", "dan"]);
    expect(ids(ROWS.filter((r) => matchesAgreementStatus(r, "pending")))).toEqual(["bob", "eve"]);
    expect(ids(ROWS.filter((r) => matchesAgreementStatus(r, "failed")))).toEqual(["cat"]);
  });

  it("kind 'all' keeps everything; otherwise rental or individual only", () => {
    expect(ROWS.every((r) => matchesAgreementKind(r, "all"))).toBe(true);
    expect(ids(ROWS.filter((r) => matchesAgreementKind(r, "rental")))).toEqual(["ann", "cat", "eve"]);
    expect(ids(ROWS.filter((r) => matchesAgreementKind(r, "individual")))).toEqual(["bob", "dan"]);
  });
});

describe("the top bar's search", () => {
  it("matches the customer, the email, the title and the rental reference, in any case", () => {
    expect(matchesAgreementSearch(ann, "ann l")).toBe(true); // name
    expect(matchesAgreementSearch(dan, "dan@wu")).toBe(true); // email, stored upper case
    expect(matchesAgreementSearch(bob, "PARKING")).toBe(true); // title
    expect(matchesAgreementSearch(ann, "r-2040")).toBe(true); // rental reference
    expect(matchesAgreementSearch(ann, "nda")).toBe(false);
  });

  it("an empty or blank search matches everything, and a null field never throws", () => {
    expect(matchesAgreementSearch(ann, "   ")).toBe(true);
    expect(matchesAgreementSearch({ ...eve, title: null, rentalRef: null }, "zzz")).toBe(false);
  });
});

describe("all together", () => {
  it("applies the search and every filter at once, keeping the order", () => {
    const filters: AgreementListFiltersV2 = {
      customer: "",
      sentFrom: day(9, 17),
      sentTo: day(9, 20),
      status: "signed",
      kind: "all",
    };
    // Signed and sent Sep 17..20: Ann (Sep 18) and Dan (Sep 17 23:59).
    expect(ids(filterAgreementsV2(ROWS, filters, ""))).toEqual(["ann", "dan"]);
    // ...of whom only Dan is individual.
    expect(ids(filterAgreementsV2(ROWS, { ...filters, kind: "individual" }, ""))).toEqual(["dan"]);
    // ...and a search that neither matches leaves none.
    expect(ids(filterAgreementsV2(ROWS, filters, "stone"))).toEqual([]);
  });

  it("with nothing set, returns every row", () => {
    expect(ids(filterAgreementsV2(ROWS, EMPTY_AGREEMENT_FILTERS_V2, ""))).toEqual(["ann", "bob", "cat", "dan", "eve"]);
  });
});

describe("the badge count", () => {
  it("counts each filter that narrows the list, not the search", () => {
    expect(countActiveAgreementFilters(EMPTY_AGREEMENT_FILTERS_V2)).toBe(0);
    expect(countActiveAgreementFilters({ ...EMPTY_AGREEMENT_FILTERS_V2, customer: "   " })).toBe(0);
    expect(
      countActiveAgreementFilters({ customer: "ann", sentFrom: day(9, 1), sentTo: day(9, 2), status: "failed", kind: "rental" }),
    ).toBe(5);
    expect(countActiveAgreementFilters({ ...EMPTY_AGREEMENT_FILTERS_V2, sentTo: day(9, 2) })).toBe(1);
  });
});

describe("order and reset key", () => {
  it("newest sent first, a row with no sent time last, ties in their original order", () => {
    const tieA = row({ id: "tieA", sentAt: at(9, 18, 0, 0, 5) });
    expect(ids(agreementsNewestFirstV2([eve, dan, ann, tieA, cat, bob]))).toEqual(["cat", "bob", "ann", "tieA", "dan", "eve"]);
  });

  it("changes when the result set does, and only then", () => {
    const base = agreementsResultKeyV2("t1", EMPTY_AGREEMENT_FILTERS_V2, "");
    expect(agreementsResultKeyV2("t1", { ...EMPTY_AGREEMENT_FILTERS_V2 }, "")).toBe(base);
    expect(agreementsResultKeyV2("t2", EMPTY_AGREEMENT_FILTERS_V2, "")).not.toBe(base);
    expect(agreementsResultKeyV2("t1", EMPTY_AGREEMENT_FILTERS_V2, "ann")).not.toBe(base);
    expect(agreementsResultKeyV2("t1", { ...EMPTY_AGREEMENT_FILTERS_V2, status: "signed" }, "")).not.toBe(base);
    expect(agreementsResultKeyV2("t1", { ...EMPTY_AGREEMENT_FILTERS_V2, sentFrom: day(9, 1) }, "")).not.toBe(base);
    // The same day picked twice (a new Date object) is the same result set.
    expect(agreementsResultKeyV2("t1", { ...EMPTY_AGREEMENT_FILTERS_V2, sentFrom: day(9, 1) }, "")).toBe(
      agreementsResultKeyV2("t1", { ...EMPTY_AGREEMENT_FILTERS_V2, sentFrom: new Date(2026, 8, 1, 8) }, ""),
    );
  });
});
