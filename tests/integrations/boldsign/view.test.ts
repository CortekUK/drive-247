// =============================================================================
// integrations/boldsign — VIEW.  "HAAN VIEW WALA KHULTA HAI KI NAHI KHULTA"
//
// "Does the view open" is three different reads in this codebase, and only one
// of them talks to BoldSign:
//
//   1. THE SIGNED PDF, once it exists. `rentals.signed_document_id` (or the
//      agreement's) points at a `customer_documents` row the webhook stored
//      after completion. This path must NEVER go back to BoldSign — the
//      document may be gone (sandbox documents are deleted after 14 days) and
//      the key may no longer match the mode it was created under.
//
//   2. THE LIVE DOCUMENT, before it is signed. Downloaded from BoldSign with
//      the key for the mode recorded ON THE ROW, and handed back as base64.
//
//   3. THE SIGNING PAGE, which is what the customer opens. `/api/esign/sign`
//      and `/api/esign/signing-redirect` fetch an embedded signing link. Both
//      must refuse a document that is already signed, or a second signature is
//      solicited for an agreement that is already executed.
//
// Two implementations exist for reads 1 and 2 — the portal route and the
// `get-boldsign-document` edge function — and they must agree, because the
// portal and the customer's booking portal each use a different one.
//
// The one piece of arithmetic in this whole integration lives here too: the
// edge function converts the PDF to base64 in 0x8000-byte chunks. That is not
// an optimisation. `String.fromCharCode.apply` on a whole rental agreement
// throws RangeError, so an un-chunked version fails on every real document and
// passes on every toy one.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import {
  destructuredRequestKeys,
  payloadKeysAtCallSite,
  portalCall,
  portalTarget,
  positionsOf,
  readRepoSource,
} from "./boldsign-source";

const VIEW_ROUTE = "apps/portal/src/app/api/esign/view/route.ts";
const SIGN_ROUTE = "apps/portal/src/app/api/esign/sign/route.ts";
const REDIRECT_ROUTE = "apps/portal/src/app/api/esign/signing-redirect/route.ts";
const STATUS_ROUTE = "apps/portal/src/app/api/esign/status/route.ts";

const viewSrc = () => blankComments(readRepoSource(VIEW_ROUTE));
const edgeViewSrc = () => blankComments(readEdgeFunctionSource("get-boldsign-document"));

const VIEW_CALLERS: { label: string; file: string; occurrence: number }[] = [
  { label: "agreements page — View", file: "apps/portal/src/app/(dashboard)/agreements/page.tsx", occurrence: 1 },
  { label: "agreements page — Download", file: "apps/portal/src/app/(dashboard)/agreements/page.tsx", occurrence: 2 },
  { label: "rental detail — View", file: "apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx", occurrence: 1 },
  { label: "rental detail — Download", file: "apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx", occurrence: 2 },
  { label: "rental detail v2 — View", file: "apps/portal/src/components/rentals-v2/rental-detail/stage-agreement.tsx", occurrence: 1 },
  { label: "customer portal — View", file: "apps/booking/src/hooks/use-customer-agreements.ts", occurrence: 1 },
  { label: "customer portal — Download", file: "apps/booking/src/hooks/use-customer-agreements.ts", occurrence: 2 },
];

describe("boldsign/view — the request contract", () => {
  it.each(VIEW_CALLERS)("$label asks for the document by an identifier the route reads", ({ label, file, occurrence }) => {
    const sent = payloadKeysAtCallSite(readRepoSource(file), "/api/esign/view", { occurrence, label });
    const read = destructuredRequestKeys(readRepoSource(VIEW_ROUTE), "/api/esign/view");

    const extra = sent.filter((k) => !read.includes(k));
    expect(
      extra,
      `${label} sends ${extra.join(", ")}, which /api/esign/view does not read.\n` +
        `  route reads: ${read.join(", ")}\n` +
        `  FAILURE MODE (a): the route dropped a field or the caller invented one. The\n` +
        `  value is silently ignored on arrival, so the view falls back to whatever\n` +
        `  identifier IS understood — usually the rental, which is the wrong document\n` +
        `  once a rental has more than one agreement.`,
    ).toEqual([]);

    // At least one identifier, or the route 400s by design.
    expect(
      sent.some((k) => ["rentalId", "envelopeId", "agreementId"].includes(k)),
      `${label} sends no document identifier at all (${sent.join(", ")}).`,
    ).toBe(true);
  });

  it("the edge function reads the same identifiers as the route", () => {
    // Two implementations of one behaviour. The booking app's customer portal
    // reaches the route; automations and older callers reach the function. A
    // field understood by one and not the other is a view that opens in the
    // operator's portal and 404s in the customer's.
    const shape = readEdgeFunction("get-boldsign-document");
    expect(shape.fields.length, "get-boldsign-document parsed to zero request fields").toBeGreaterThan(0);
    for (const key of shape.fields) {
      expect(
        destructuredRequestKeys(readRepoSource(VIEW_ROUTE), "/api/esign/view"),
        `get-boldsign-document reads \`${key}\` and the portal route does not.`,
      ).toContain(key);
    }
    expect(shape.fields).toContain("rentalId");
    expect(shape.fields).toContain("envelopeId");
  });

  it("both implementations refuse a request with no identifier at all", () => {
    expect(
      viewSrc(),
      "/api/esign/view no longer refuses an empty request. It would fall through to a " +
        "BoldSign download with an undefined documentId.",
    ).toContain("rentalId, envelopeId, or agreementId required");
    expect(
      edgeViewSrc(),
      "get-boldsign-document no longer refuses an empty request.",
    ).toContain("envelopeId or rentalId is required");
  });
});

describe("boldsign/view — a signed document opens from storage, never from BoldSign", () => {
  it("a stored signed PDF short-circuits the BoldSign download", () => {
    // Order matters and is the whole assertion: the stored branch must sit
    // ABOVE the download. Sandbox documents are deleted after 14 days, so a
    // view that goes back to BoldSign for an old test-mode agreement returns a
    // 500 for a PDF that is sitting in our own bucket.
    for (const [name, src] of [["portal route", viewSrc()], ["edge function", edgeViewSrc()]] as const) {
      const at = positionsOf(src, {
        stored: "source: 'stored'",
        download: "/v1/document/download",
      });
      expect(at.stored, `${name}: the stored-document branch is gone`).toBeGreaterThan(-1);
      expect(at.download, `${name}: the BoldSign download is gone`).toBeGreaterThan(-1);
      expect(
        at.stored < at.download,
        `${name}: the stored-PDF branch now sits BELOW the BoldSign download.\n` +
          `  stored@${at.stored} download@${at.download}\n` +
          `  Every view of a signed agreement would hit BoldSign again — a wasted API\n` +
          `  call at best, and a 500 once a sandbox document has aged out (14 days) or\n` +
          `  the tenant has switched modes.`,
      ).toBe(true);
    }
  });

  it("a storage path is turned into a URL, and an http URL is passed through", () => {
    // `customer_documents.file_url` holds both shapes historically. Dropping
    // either branch breaks half the signed documents in the table: a bare
    // storage path handed to an <iframe> resolves to a portal 404.
    for (const [name, src] of [["portal route", viewSrc()], ["edge function", edgeViewSrc()]] as const) {
      expect(src, `${name}: the http passthrough branch is gone`).toContain("startsWith('http')");
      expect(src, `${name}: the storage-path branch no longer builds a public URL`).toContain("getPublicUrl");
      expect(src, `${name}: the customer-documents bucket name changed`).toContain("customer-documents");
    }
  });

  it("a rental with no document at all says so, instead of failing at BoldSign", () => {
    for (const [name, src] of [["portal route", viewSrc()], ["edge function", edgeViewSrc()]] as const) {
      expect(
        src,
        `${name}: the "no document for this rental" 404 is gone. The request would run ` +
          `on to BoldSign with an undefined documentId and come back as a 500, which ` +
          `reads to the operator as an outage rather than "nothing has been sent yet".`,
      ).toContain("No signed document for this rental");
    }
  });

  it("the live document is fetched with the mode recorded on the row", () => {
    // Not the tenant's CURRENT mode. A document created in the sandbox must
    // keep being read with the sandbox key — `_shared/lean-tenants.ts` states
    // this as an invariant: "a document created in the BoldSign sandbox must
    // keep being read with the sandbox key or it 404s".
    const src = viewSrc();
    expect(src, "the view no longer prefers the agreement's own recorded mode").toContain(
      "agreement.boldsign_mode as 'test' | 'live'",
    );
    expect(src, "the view no longer falls back to the rental's recorded mode").toContain(
      "rentalMode.boldsign_mode as 'test' | 'live'",
    );
    expect(edgeViewSrc(), "get-boldsign-document no longer reads the rental's recorded mode").toContain(
      "rentalMode.boldsign_mode as BoldSignMode",
    );
  });

  it("the PDF is base64-encoded in chunks, which is what makes a real agreement openable", () => {
    // `String.fromCharCode.apply(null, wholeArray)` throws RangeError on a
    // typical rental agreement. The chunking is the difference between "view
    // works on my one-page test document" and "view works".
    const src = edgeViewSrc();
    expect(
      src,
      "get-boldsign-document no longer chunks its base64 conversion.\n" +
        "  String.fromCharCode.apply on a whole PDF exceeds the argument limit and\n" +
        "  throws RangeError — the function 500s on every real agreement while still\n" +
        "  passing on a small one. FAILURE MODE (b) waiting to happen.",
    ).toContain("const chunkSize = 0x8000;");
    expect(src, "the chunk loop is gone").toMatch(/i \+= chunkSize/);
    expect(src, "the response no longer carries the PDF").toContain("documentBase64");
  });
});

describe("boldsign/view — opening the SIGNING page", () => {
  it("an already-signed document cannot be opened for signing again", () => {
    // Both entry points: the operator's in-portal signing dialog and the link
    // in the customer's email. A second signature on an executed agreement is
    // not a UI annoyance — it produces a second signed artefact for one rental.
    for (const [name, file] of [["sign route", SIGN_ROUTE], ["signing-redirect", REDIRECT_ROUTE]] as const) {
      const src = blankComments(readRepoSource(file));
      expect(
        src,
        `${name} no longer refuses a completed/signed document. The customer could sign ` +
          `an agreement that is already executed.`,
      ).toMatch(/=== ['"]completed['"]/);
      expect(src, `${name} no longer refuses a 'signed' document`).toMatch(/=== ['"]signed['"]/);
    }
  });

  it("the signing link is fetched per click, not baked into the email", () => {
    // The email carries our own redirect URL; BoldSign's embedded link is
    // resolved at click time. That is what keeps a resend's revoked document
    // from handing out a link that outlives it.
    const src = blankComments(readRepoSource(REDIRECT_ROUTE));
    expect(src, "signing-redirect no longer asks BoldSign for the embedded link").toContain("getEmbeddedSignLink");
    expect(src, "signing-redirect no longer redirects the customer to BoldSign").toContain("NextResponse.redirect");
    expect(
      src,
      "signing-redirect no longer identifies the signer by the rental's customer email. " +
        "BoldSign issues embedded links per signer address; a wrong or missing one " +
        "returns a link that opens someone else's copy or nothing at all.",
    ).toContain("signerEmail=");
  });

  it("a BoldSign failure at click time is explained, not swallowed into a blank page", () => {
    const src = blankComments(readRepoSource(REDIRECT_ROUTE));
    expect(src, "the 502 for an unavailable signing page is gone").toContain("502");
    expect(src, "the customer-facing explanation for an expired document is gone").toMatch(
      /may have expired or already been signed/i,
    );
  });

  it("status reads prefer our own record and only then ask BoldSign", () => {
    // The webhook keeps `document_status` in sync, so a terminal status needs
    // no round trip. This is what stops a click-happy operator burning the
    // 50-per-hour quota that sends depend on.
    const src = blankComments(readRepoSource(STATUS_ROUTE));
    const at = positionsOf(src, {
      terminal: "TERMINAL_STATUSES",
      cache: "PROPERTIES_CACHE_TTL_MS",
      properties: "/v1/document/properties",
    });
    expect(at.terminal, "the terminal-status short-circuit is gone from /api/esign/status").toBeGreaterThan(-1);
    expect(at.cache, "the 60s properties cache is gone").toBeGreaterThan(-1);
    expect(
      at.terminal < at.properties,
      "The terminal-status short-circuit now sits below the BoldSign properties call, " +
        "so it saves nothing.",
    ).toBe(true);
    expect(
      src,
      "The status map no longer resolves BoldSign's 'Completed'. An unmapped status is " +
        "lowercased and written straight to document_status, and the terminal set " +
        "stops matching it.",
    ).toContain("'Completed': 'completed'");
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// Three cases, all of them pure input validation answered before any BoldSign
// call and before any write:
//
//   - get-boldsign-document with no identifiers  -> 400
//   - get-boldsign-document with a rental id that cannot exist -> 404, having
//     done one SELECT and nothing else
//   - /api/esign/view with an empty body -> 400 (needs D247_LIVE_PORTAL_URL)
//
// None of them opens, downloads or modifies a document. They exist to prove the
// view surface is deployed and still refusing what it should refuse.
// ===========================================================================
describe("boldsign/view — live (Layer 2)", () => {
  const NON_EXISTENT_RENTAL_ID = "00000000-0000-0000-0000-000000000000";

  it("live: get-boldsign-document refuses a request with no identifier", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — this would measure the gateway, not the function.");
      return;
    }

    const res = await liveCall("get-boldsign-document", {}, { token: status.target.anonKey });

    expect(
      res.status,
      "Expected 400 from get-boldsign-document's identifier check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/envelopeId or rentalId is required/i);
  });

  it("live: get-boldsign-document 404s on a rental that cannot exist", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — this would measure the gateway, not the function.");
      return;
    }

    // One SELECT against `rentals`, no match, 404. Nothing is downloaded and
    // nothing is written, whatever happens to the guards above it.
    const res = await liveCall("get-boldsign-document", { rentalId: NON_EXISTENT_RENTAL_ID }, {
      token: status.target.anonKey,
    });

    expect(
      res.status,
      "Expected 404 for a rental that does not exist.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 500 here means the function reached BoldSign with an undefined document id\n" +
        "  instead of stopping at the missing rental — FAILURE MODE (b).\n" +
        classifyLive(res).explain,
    ).toBe(404);
    expect(String(res.json?.error ?? res.text)).toMatch(/Rental not found/i);
  });

  it("live: /api/esign/view refuses a request with no identifier", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    const res = await portalCall("/api/esign/view", {});

    expect(
      res.status,
      "Expected 400 from /api/esign/view's identifier check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 404 means the route is not deployed at this target — check\n" +
        "  D247_LIVE_PORTAL_URL rather than the code.",
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/required/i);
  });
});
