// =============================================================================
// integrations/bonzah — bonzah-download-pdf.
//
// The certificate. It is the document a renter is handed as proof of cover, and
// three separate screens fetch it through this one function: the portal's
// rental timeline, the portal's insurances list, and the CUSTOMER's own
// documents page in the booking app.
//
// WHAT IT DOES (read, not assumed):
//   1. 400 unless tenant_id AND pdf_id are present; then a SECOND 400 unless
//      policy_id is present — even though the request type marks it optional
//   2. resolve the tenant's Bonzah credentials (service role) and a token
//   3. GET {apiUrl}/policy/data/{policy_id}?data_id={pdf_id}&download=1&token=…
//   4. three response shapes, in this order:
//        a. content-type is application/pdf  -> arrayBuffer, byte loop, btoa
//        b. body starts with "%PDF"          -> text(), TextEncoder, btoa
//        c. JSON                             -> data.content / data (string)
//   5. `{ documentBase64, contentType }`, which every caller atob()s into a Blob
//
// WHY THERE IS A LAYER 3 BLOCK IN A DOCUMENT FUNCTION: step 4 is byte
// arithmetic, and it has two hazards worth pinning. The sibling
// `get-boldsign-document` shipped a real bug where an unchunked
// `String.fromCharCode.apply` over a whole PDF throws RangeError on real files
// while passing on small ones. The loop here is per-byte, so it does NOT have
// that shape — and the case below proves that on a 300 KB buffer rather than
// asserting it in a comment, so an "optimisation" back to `.apply` goes red.
//
// Path (b) has a different and worse problem, and it is a real defect: it reads
// a BINARY body with `.text()`. That is a lossy UTF-8 decode, and re-encoding it
// produces a corrupted PDF. Tracked as a watchdog below, with the exact byte
// counts.
// =============================================================================

import { describe, expect, it } from "vitest";
import { assertContract, readEdgeFunction, type PayloadContract } from "../../helpers/edge-contract";
import { classifyLive, liveCall } from "../../helpers/live-call";
import { BONZAH_LIVE_HOST } from "./sandbox";
import { bonzahServicingGate, fixtureOrNull, liftStatements, readRepoFile, srcOf } from "./servicing";

const FN = "bonzah-download-pdf";
const src = () => srcOf(FN);
const AT = "integrations/bonzah";

const CALLERS = [
  "apps/portal/src/components/rentals/InsuranceTimeline.tsx",
  "apps/portal/src/app/(dashboard)/insurances/page.tsx",
  "apps/booking/src/app/(customer-portal)/portal/documents/page.tsx",
];

const CONTRACT: PayloadContract = {
  step: AT,
  fn: FN,
  builtIn: CALLERS[0],
  payload: {
    tenant_id: "00000000-0000-0000-0000-000000000000",
    pdf_id: "123456",
    policy_id: "POL-SPINE-SUITE",
  },
};

describe("bonzah/download-pdf — contract", () => {
  it("agrees with the payload all three download buttons build", () => {
    const shape = assertContract(CONTRACT);
    expect(shape.typeName).toBe("DownloadPdfRequest");
    expect(
      shape.fields.length,
      `Parsed no request fields out of ${shape.file} — the contract would pass vacuously.`,
    ).toBeGreaterThan(0);
  });

  it("is built the same way by every caller, including the customer-facing one", () => {
    // Three screens, one payload. The booking-side one matters most: it runs on
    // a RENTER's session, not an operator's.
    for (const caller of CALLERS) {
      const text = readRepoFile(caller);
      expect(text, `${caller} no longer invokes ${FN}.`).toContain("bonzah-download-pdf");
      expect(
        text,
        `${caller} no longer sends all three of tenant_id / pdf_id / policy_id. The function ` +
          "400s without any one of them, and the toast the operator sees is a generic " +
          '"Failed to download PDF".',
      ).toMatch(/tenant_id:[\s\S]{0,80}pdf_id:[\s\S]{0,80}policy_id:/);
      expect(
        text,
        `${caller} stopped stringifying pdf_id. Bonzah's pdf ids arrive as NUMBERS in ` +
          "coverage_types.pdf_ids, and this one goes into encodeURIComponent on the server.",
      ).toMatch(/pdf_id:\s*String\(/);
    }
  });

  it("WATCHDOG: policy_id is optional in the type and mandatory at runtime", () => {
    // KNOWN DEFECT, tracked rather than blessed.
    //
    //   interface DownloadPdfRequest { tenant_id: string; pdf_id: string; policy_id?: string }
    //   if (!body.policy_id) return errorResponse('Missing policy_id')
    //
    // The `?` is a lie: the download URL is built from policy_id, so there is no
    // path where it is genuinely optional. It is not cosmetic either — the
    // portal's rental timeline invokes this WITHOUT checking `policy.policy_id`
    // first (the booking app does check), so a policy row that never got an id
    // back from Bonzah produces a 400 and a generic failure toast.
    //
    // Converts itself: drop the `?` and the first branch becomes the assertion.
    const shape = readEdgeFunction(FN);
    const declaredRequired = shape.requiredByType.includes("policy_id");
    if (declaredRequired) {
      expect(
        shape.requiredByType,
        "policy_id is required in the type now — keep it that way; the URL cannot be " +
          "built without it.",
      ).toEqual(["pdf_id", "policy_id", "tenant_id"]);
      return;
    }
    expect(
      {
        requiredByType: shape.requiredByType,
        guardedAtRuntime: /if\s*\(!body\.policy_id\)/.test(src()),
        urlNeedsIt: /policy\/data\/\$\{encodeURIComponent\(body\.policy_id\)\}/.test(src()),
      },
      [
        "",
        "  The policy_id story for bonzah-download-pdf changed.",
        "",
        "  If you removed the `?` from `policy_id` in DownloadPdfRequest, this watchdog has",
        "  done its job — delete this branch and keep the assertion above.",
        "",
        "  What it was pinning (a real defect, reported and not blessed):",
        "    the request type marks policy_id optional while the handler 400s without it",
        "    and the Insillion URL is built out of it. A caller that trusts the type gets",
        "    a 400 at runtime — which is exactly what InsuranceTimeline.tsx does: it",
        "    invokes the download without checking policy.policy_id first.",
        "",
      ].join("\n"),
    ).toEqual({
      requiredByType: ["pdf_id", "tenant_id"],
      guardedAtRuntime: true,
      urlNeedsIt: true,
    });
  });
});

describe("bonzah/download-pdf — guard order and the URL it builds", () => {
  it("refuses missing ids before it authenticates or calls Bonzah", () => {
    const s = src();
    const guardAt = s.indexOf("if (!body.tenant_id || !body.pdf_id)");
    const policyGuardAt = s.indexOf("if (!body.policy_id)");
    const credsAt = s.indexOf("getTenantBonzahCredentials(supabase");
    const fetchAt = s.indexOf("await fetch(downloadUrl)");
    expect(guardAt, "The missing tenant_id/pdf_id guard is gone.").toBeGreaterThan(-1);
    expect(policyGuardAt, "The missing policy_id guard is gone.").toBeGreaterThan(-1);
    expect(fetchAt, `${FN} no longer downloads anything.`).toBeGreaterThan(-1);
    expect(
      guardAt < credsAt && policyGuardAt < credsAt && policyGuardAt < fetchAt,
      `A required-field guard moved below the work it guards (ids@${guardAt}, ` +
        `policy@${policyGuardAt}, credentials@${credsAt}, fetch@${fetchAt}). The URL would ` +
        "then be built with `undefined` in the path and requested with a real token.",
    ).toBe(true);
  });

  it("puts the auth token in the URL — and keeps it out of the logs", () => {
    // Insillion's platform download endpoint takes the token as a query
    // parameter rather than a header. That is their design, not ours; what is
    // ours is that the URL then gets logged, so the redaction is load-bearing.
    const s = src();
    expect(
      s,
      "The token is no longer encodeURIComponent'd into the download URL. An unescaped " +
        "token containing a `&` or `+` silently authenticates as something else.",
    ).toMatch(/token=\$\{encodeURIComponent\(token\)\}/);
    expect(
      s,
      "The token redaction on the log line is gone. The full URL — token included — would " +
        "be written to the function logs on every certificate download.",
    ).toMatch(/downloadUrl\.replace\(\/token=\[\^&\]\+\/,\s*'token=\*\*\*'\)/);
  });

  it("reads the body ONCE, and reads the binary branch first", () => {
    // `resp.arrayBuffer()` and `resp.text()` cannot both run on one Response —
    // the second throws "Body already consumed". The order is what keeps that
    // impossible: the content-type branch returns, and only a fall-through
    // reaches text().
    const s = src();
    const ctBranchAt = s.indexOf("if (contentType.includes('application/pdf'))");
    const arrayBufferAt = s.indexOf("await resp.arrayBuffer()");
    const textAt = s.indexOf("await resp.text()", arrayBufferAt);
    expect(ctBranchAt, "The content-type branch is gone.").toBeGreaterThan(-1);
    expect(arrayBufferAt, "The arrayBuffer read is gone.").toBeGreaterThan(-1);
    expect(textAt, "The text() fallback is gone.").toBeGreaterThan(-1);
    expect(
      ctBranchAt < arrayBufferAt && arrayBufferAt < textAt,
      `The two body reads are no longer ordered inside a branch (branch@${ctBranchAt}, ` +
        `arrayBuffer@${arrayBufferAt}, text@${textAt}). Reading a Response twice throws, and ` +
        "the throw lands in the outer catch as a 500 that reads like our bug.",
    ).toBe(true);
    // The %PDF sniff must sit above the JSON parse, or a PDF whose bytes happen
    // to parse is answered as an API error.
    const sniffAt = s.indexOf("responseText.startsWith('%PDF')");
    const jsonAt = s.indexOf("JSON.parse(responseText)");
    expect(sniffAt, "The %PDF content sniff is gone.").toBeGreaterThan(-1);
    expect(sniffAt < jsonAt, "The %PDF sniff moved below JSON.parse.").toBe(true);
  });

  it("answers with the two keys every caller reads", () => {
    const s = src();
    for (const key of ["documentBase64", "contentType"]) {
      expect(s, `The response no longer carries \`${key}\`.`).toContain(key);
    }
    for (const caller of CALLERS) {
      expect(
        readRepoFile(caller),
        `${caller} stopped reading data.documentBase64. Every one of them atob()s it into ` +
          "a Blob; renaming the key breaks all three downloads at once.",
      ).toMatch(/data\??\.documentBase64/);
    }
  });

  it("passes the upstream failure status through, and names the upstream", () => {
    const s = src();
    expect(
      s,
      "The non-ok branch no longer reports which status Bonzah gave. `Failed to download " +
        "PDF: 401` and `Failed to download PDF: 404` need completely different responses " +
        "from an operator — the first is a stale login, the second is a missing document.",
    ).toMatch(/Failed to download PDF: \$\{resp\.status\}/);
  });

  it("never applies the SELL gate — the customer has already paid", () => {
    expect(
      /assertBonzahSellable|getBonzahSellability/.test(src()),
      `${FN} has started calling the Bonzah sell gate. This is the certificate for cover ` +
        "that is already bought; gating it leaves a paying renter with no proof of insurance.",
    ).toBe(false);
  });
});

// ===========================================================================
// LAYER 3 — the bytes. The loops below are LIFTED OUT OF THE SHIPPED SOURCE and
// executed; every expected value is a literal typed by hand.
// ===========================================================================

/** The loop in the content-type-is-PDF branch, over the real arrayBuffer. */
const binaryLoop = liftStatements<(u: Uint8Array) => string>({
  fn: FN,
  what: "the byte->binary loop in the application/pdf branch",
  pattern: /const uint8Array = new Uint8Array\(pdfBuffer\)\s*\n\s*(let binary = ''[\s\S]*?\n\s*\})/,
  params: ["uint8Array"],
  epilogue: "return binary;",
});

/** The loop in the "%PDF in a text body" fallback, over TextEncoder output. */
const textLoop = liftStatements<(u: Uint8Array) => string>({
  fn: FN,
  what: "the byte->binary loop in the %PDF text fallback",
  pattern: /const uint8Array = encoder\.encode\(responseText\)\s*\n\s*(let binary = ''[\s\S]*?\n\s*\})/,
  params: ["uint8Array"],
  epilogue: "return binary;",
});

describe("bonzah/download-pdf — the base64 the browser gets back (Layer 3)", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. It returns a renter's insurance certificate for a tenant named entirely by the request body.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-download-pdf]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-download-pdf\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-download-pdf has been given verify_jwt = false in supabase/config.toml.\n" +
        "  The certificate would then be fetchable by anyone who can guess a numeric pdf_id and a policy_id — and those ids are small integers out of coverage_types.pdf_ids.",
    ).toBe(false);
  });

  it("encodes the PDF magic bytes to the four characters every sniffer looks for", () => {
    // 0x25 0x50 0x44 0x46 is "%PDF". Base64 of those four bytes, worked out by
    // hand from the 6-bit groups: 001001|010101|000001|000100 -> J V B E, then
    // 0x46 alone -> R g and two pad characters.
    const binary = binaryLoop.call(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(
      binary,
      "The shipped loop no longer turns PDF magic bytes into the characters %PDF. Every " +
        "caller atob()s this into a Blob typed application/pdf.",
    ).toBe("%PDF");
    expect(btoa(binary), "btoa of the PDF magic bytes is no longer JVBERg==.").toBe("JVBERg==");
    // The prefix bonzah-probe-pdf sniffs for when it is looking for a base64 PDF.
    expect(btoa(binary).startsWith("JVBER")).toBe(true);
  });

  it("encodes a nine-byte PDF header exactly", () => {
    // "%PDF-1.7\n" — 25 50 44 46 2d 31 2e 37 0a.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
    expect(btoa(binaryLoop.call(bytes))).toBe("JVBERi0xLjcK");
  });

  it("is byte-exact on bytes that are not valid UTF-8 — which every real PDF contains", () => {
    // 0x80 and 0xFF cannot appear in valid UTF-8. A compressed PDF stream is
    // full of them. This is the property the arrayBuffer path has and the
    // text() path does not.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x80, 0xff]);
    const binary = binaryLoop.call(bytes);
    expect(
      binary.length,
      "The binary path changed length. It must produce one character per byte; anything " +
        "else means bytes are being merged or dropped and the PDF will not open.",
    ).toBe(11);
    expect(btoa(binary), "The binary path no longer round-trips high bytes.").toBe("JVBERi0xLjcKgP8=");
  });

  it("does not blow up on a real-sized PDF — the get-boldsign-document bug shape", () => {
    // The sibling function shipped `String.fromCharCode.apply(null, wholeArray)`,
    // which spreads every byte as an ARGUMENT and throws
    // "RangeError: Maximum call stack size exceeded" somewhere north of ~100 KB
    // — passing every small test and failing on every real document.
    //
    // The loop here is per-byte, so it does not have that shape. This case is
    // what keeps it that way: rewrite it to `.apply` and 300 KB goes red here
    // instead of in front of a renter.
    const size = 300_000;
    const bytes = new Uint8Array(size);
    bytes.set([0x25, 0x50, 0x44, 0x46]);
    for (let i = 4; i < size; i += 1) bytes[i] = i % 256;

    let binary: string;
    try {
      binary = binaryLoop.call(bytes);
    } catch (e) {
      throw new Error(
        [
          "",
          `  The shipped byte loop THREW on a ${size}-byte buffer: ${(e as Error).message}`,
          "",
          "  This is the get-boldsign-document bug, arrived here: an unchunked",
          "  String.fromCharCode.apply(null, wholeArray) spreads every byte as an argument",
          "  and blows the call stack on any real certificate, while passing on the small",
          "  fixtures a developer tests with.",
          "",
          "  Chunk it (8 KB slices) or keep the per-byte loop. Do not `.apply` a whole PDF.",
          "",
        ].join("\n"),
      );
    }
    expect(
      binary.length,
      "The byte loop dropped bytes on a large buffer — one character per byte is the " +
        "invariant that makes btoa's output a valid PDF.",
    ).toBe(size);
    expect(binary.slice(0, 4)).toBe("%PDF");
    expect(btoa(binary).startsWith("JVBER")).toBe(true);
  });

  it("WATCHDOG: the %PDF text fallback returns a CORRUPTED PDF", () => {
    // KNOWN DEFECT, tracked rather than blessed.
    //
    // Path (b) runs when Insillion sends a PDF without an application/pdf
    // content-type — which is precisely the case the sniff exists to catch:
    //
    //     const responseText = await resp.text()          // lossy UTF-8 decode
    //     if (responseText.startsWith('%PDF')) {
    //       const uint8Array = new TextEncoder().encode(responseText)
    //
    // `.text()` decodes the body as UTF-8 with replacement characters. Every
    // byte sequence that is not valid UTF-8 — i.e. most of a compressed PDF —
    // becomes U+FFFD, which re-encodes to the THREE bytes EF BF BD. The file
    // that reaches the renter is a valid-looking base64 string of a broken PDF,
    // and the header survives, so it fails at "open", not at "download".
    //
    // The fix is to read `resp.arrayBuffer()` once, up front, and sniff the
    // magic bytes on the buffer — exactly what bonzah-probe-pdf already does.
    // This case converts itself the moment that lands.
    const s = src();
    const stillDecodesAsText =
      /const responseText = await resp\.text\(\)/.test(s) &&
      /const uint8Array = encoder\.encode\(responseText\)/.test(s);

    if (!stillDecodesAsText) {
      // The fix landed: the fallback no longer re-encodes decoded text.
      expect(
        s,
        "The %PDF fallback stopped re-encoding decoded text — keep it reading bytes.",
      ).not.toMatch(/encoder\.encode\(responseText\)/);
      return;
    }

    // The same eleven bytes as the byte-exact case above, taken through what
    // the fallback actually does to them: decode, re-encode, then the SHIPPED
    // loop, then btoa.
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x80, 0xff]);
    const asText = new TextDecoder("utf-8").decode(original);
    const reEncoded = new TextEncoder().encode(asText);
    const corrupted = btoa(textLoop.call(reEncoded));

    expect(
      { bytesIn: original.length, bytesOut: reEncoded.length, base64: corrupted },
      [
        "",
        "  The %PDF text fallback stopped corrupting binary bodies.",
        "",
        "  If you FIXED it — by sniffing the magic bytes on an arrayBuffer instead of on",
        "  decoded text — this watchdog has done its job: delete this branch and keep the",
        "  assertion above.",
        "",
        "  What it was pinning (a real defect, reported and not blessed):",
        "    11 PDF bytes go in, 15 come out. The two bytes 0x80 and 0xFF are not valid",
        "    UTF-8, so `.text()` turns each into U+FFFD and TextEncoder writes each of",
        "    those back as three bytes (EF BF BD). The base64 handed to the browser is a",
        "    broken PDF whose header still reads %PDF, so it downloads cleanly and then",
        "    will not open. Correct output for those bytes is JVBERi0xLjcKgP8= — asserted",
        "    on the arrayBuffer path in the case above.",
        "",
      ].join("\n"),
    ).toEqual({ bytesIn: 11, bytesOut: 15, base64: "JVBERi0xLjcK77+977+9" });

    expect(
      corrupted,
      "The corrupted output happens to equal the correct output, which would mean this " +
        "whole watchdog is measuring nothing.",
    ).not.toBe("JVBERi0xLjcKgP8=");
  });
});

// ===========================================================================
// LAYER 2 — live. A GET at Bonzah, writing nothing on either side, and gated on
// the mode DECLARATION because the host is chosen from tenants.bonzah_mode
// server-side. See servicing.ts.
// ===========================================================================
describe("bonzah/download-pdf — live (Layer 2)", () => {
  it("live: downloads the fixture certificate and it really is a PDF", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const tenantId = fixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    const policyId = fixtureOrNull("D247_LIVE_BONZAH_POLICY_ID");
    const pdfId = fixtureOrNull("D247_LIVE_BONZAH_PDF_ID");
    if (!tenantId || !policyId || !pdfId) {
      ctx.skip(
        "D247_LIVE_BONZAH_TENANT_ID / _POLICY_ID / _PDF_ID are not all set. The pdf id is " +
          "one of the values in bonzah_insurance_policies.coverage_types.pdf_ids. Fixtures " +
          "are never inferred.",
      );
      return;
    }

    const res = await liveCall(FN, { tenant_id: tenantId, pdf_id: pdfId, policy_id: policyId });
    expect(
      res.status,
      `${FN} did not return 200.\n` +
        "  401/404 here are Insillion's status passed straight through — a stale stored\n" +
        "  login, or a pdf id that does not belong to that policy. Either is FAILURE MODE\n" +
        "  (b) at the INTEGRATION rather than in this repo.\n" +
        classifyLive(res).explain,
    ).toBe(200);

    const b64 = String(res.json?.documentBase64 ?? "");
    expect(b64.length, "A 200 with an empty documentBase64.").toBeGreaterThan(100);
    expect(
      b64.startsWith("JVBER"),
      "The downloaded document does not begin with the PDF magic bytes (base64 JVBER…). " +
        `Got "${b64.slice(0, 24)}…". Every caller hands this to a Blob typed ` +
        "application/pdf and offers it as the renter's proof of insurance, so a body that " +
        "is not a PDF downloads cleanly and then will not open.",
    ).toBe(true);
    expect(res.json?.contentType).toBe("application/pdf");
  });

  it("live: a missing pdf_id is refused before Bonzah is contacted", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const tenantId = fixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    if (!tenantId) {
      ctx.skip("D247_LIVE_BONZAH_TENANT_ID is not set. Fixtures are never inferred.");
      return;
    }
    const res = await liveCall(FN, { tenant_id: tenantId, policy_id: "irrelevant" });
    expect(
      res.status,
      "Expected 400 from the required-field guard.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  Anything else means the guard runs after the download, and the request would " +
        `have gone to ${BONZAH_LIVE_HOST} for a live-mode tenant.\n` +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/Missing tenant_id or pdf_id/);
  });
});
