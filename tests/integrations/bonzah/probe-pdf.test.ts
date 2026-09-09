// =============================================================================
// integrations/bonzah — bonzah-probe-pdf.
//
// WHAT IT ACTUALLY IS. The name suggests a health check; it is not. It is a
// SHOTGUN DIAGNOSTIC that was written to find out which Insillion endpoint
// serves a policy PDF: it authenticates as the tenant and then fires ~28
// requests — GETs and POSTs — at every URL shape someone could think of, in
// parallel, and reports which ones looked like they might contain a PDF.
//
// FOUR THINGS FOLLOW FROM THAT, AND EACH IS ASSERTED BELOW:
//
//   1. It has NO caller anywhere in apps/**. It is deployed, it is reachable by
//      any authenticated user, and nothing in the product invokes it.
//   2. It must accept exactly what bonzah-download-pdf accepts, or it cannot
//      reproduce the failure it exists to diagnose. Both sides are parsed from
//      source, so the comparison is real.
//   3. Every URL must be built from `apiUrl` — the value getBonzahApiUrl()
//      returns for the TENANT's mode. One hardcoded host and a test-mode tenant
//      is probing production insurance.
//   4. It is not read-only. Ten of the twenty-eight are POSTs at endpoints whose
//      semantics nobody in this repository knows, which is why this file has NO
//      Layer 2 case — see the last block.
//
// The classification inside `probeEndpoint` — "could this be a PDF" — is pure,
// so it is LIFTED OUT OF THE SOURCE AND EXECUTED here against hand-built
// responses, with hand-typed expectations.
// =============================================================================

import { describe, expect, it } from "vitest";
import { readEdgeFunction } from "../../helpers/edge-contract";
import { balanced, grepApps, liftAsyncEdge, liftStatements, readRepoFile, srcOf } from "./servicing";

const FN = "bonzah-probe-pdf";
const src = () => srcOf(FN);

/** The `endpointDefs` array literal, as text. */
function endpointDefsBlock(): string {
  const s = src();
  const m = /const\s+endpointDefs\s*:[\s\S]*?=\s*\[/.exec(s);
  if (!m) {
    throw new Error(
      "Could not find `const endpointDefs = [ … ]` in supabase/functions/bonzah-probe-pdf/index.ts.\n" +
        "  That array IS the diagnostic. Without it these cases would assert nothing, so this\n" +
        "  throws rather than reporting zero endpoints. FAILURE MODE (a): teach the parser.",
    );
  }
  return balanced(s, m.index + m[0].length - 1);
}

describe("bonzah/probe-pdf — what it is and who calls it", () => {
  it("accepts exactly the ids bonzah-download-pdf accepts", () => {
    // Both sides derived from source. A diagnostic that takes different inputs
    // from the thing it diagnoses cannot reproduce the failure — you would be
    // probing a different document.
    const probe = readEdgeFunction(FN);
    const download = readEdgeFunction("bonzah-download-pdf");
    expect(probe.typeName).toBe("ProbePdfRequest");
    expect(
      probe.fields,
      "bonzah-probe-pdf and bonzah-download-pdf no longer take the same ids:\n" +
        `  probe:    ${probe.fields.join(", ")}\n` +
        `  download: ${download.fields.join(", ")}\n` +
        "  The probe exists to find out why a download failed. Different inputs mean it is " +
        "reproducing something else.",
    ).toEqual(download.fields);

    // And the probe is the honest one about policy_id: required in the type,
    // where its sibling still marks the same field optional.
    expect(
      probe.requiredByType,
      "bonzah-probe-pdf made one of the three ids optional. All three go into every URL " +
        "it builds.",
    ).toEqual(["pdf_id", "policy_id", "tenant_id"]);
  });

  it("has no caller in the product — it is a deployed, reachable orphan", () => {
    // Derived, not asserted from memory: grep the four app trees. If somebody
    // wires a button to this, that is a decision worth failing a build over.
    const hits = grepApps("bonzah-probe-pdf");

    expect(
      hits,
      [
        "",
        `  Something in apps/** now invokes ${FN}:`,
        ...hits.map((h) => `    ${h}`),
        "",
        "  Read what it does before shipping that. It authenticates as the tenant and fires",
        "  ~28 requests at Bonzah in parallel — ten of them POSTs — and echoes 300",
        "  characters of every upstream response back to the caller. It is a debugging tool",
        "  someone left deployed, not a product feature.",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  it("builds every URL from the tenant's resolved apiUrl, never a hardcoded host", () => {
    // One literal host in this list and a test-mode tenant is hammering
    // production insurance, with no gate anywhere able to see it: the host is
    // chosen inside the function.
    const block = endpointDefsBlock();
    const urls = [...block.matchAll(/url:\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(
      urls.length,
      "No `url:` templates found in endpointDefs — the parser is looking at the wrong thing.",
    ).toBeGreaterThan(10);
    for (const u of urls) {
      expect(
        u.startsWith("${apiUrl}"),
        `A probe URL does not start with \${apiUrl}: "${u}"\n` +
          "  apiUrl is getBonzahApiUrl(credentials.mode). Anything else ignores the tenant's " +
          "mode, and a hardcoded live host would send a sandbox tenant's probe — with their " +
          "token — at bonzah.insillion.com.",
      ).toBe(true);
    }
    expect(
      src(),
      "The probe no longer resolves its host from the tenant's mode at all.",
    ).toMatch(/getBonzahApiUrl\(credentials\.mode\)/);
  });

  it("refuses missing ids before it authenticates or probes anything", () => {
    const s = src();
    const guardAt = s.indexOf("if (!body.tenant_id || !body.pdf_id || !body.policy_id)");
    const credsAt = s.indexOf("getTenantBonzahCredentials(supabase");
    const probeAt = s.indexOf("Promise.allSettled(");
    expect(guardAt, "The required-id guard is gone.").toBeGreaterThan(-1);
    expect(probeAt, "The parallel probe is gone.").toBeGreaterThan(-1);
    expect(
      guardAt < credsAt && guardAt < probeAt,
      `The id guard moved below the work it guards (guard@${guardAt}, credentials@${credsAt}, ` +
        `probe@${probeAt}). Twenty-eight authenticated requests carrying "undefined" would ` +
        "be fired before anyone noticed the body was empty.",
    ).toBe(true);
  });

  it("survives a probe that throws, so one dead endpoint does not kill the diagnostic", () => {
    const s = src();
    expect(
      s,
      "Promise.allSettled became Promise.all. One rejected fetch would then reject the " +
        "whole batch and the diagnostic would report nothing at all — which is the one " +
        "outcome it must not produce, since it is run precisely when something is broken.",
    ).toMatch(/Promise\.allSettled\(/);
    expect(s, "The per-probe catch that reports status 0 is gone.").toMatch(/\[Fetch error: \$\{/);
  });
});

describe("bonzah/probe-pdf — how the gateway sees it", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. It authenticates as the tenant and fires ~28 requests at Bonzah, echoing 300 characters of each upstream response back to the caller.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-probe-pdf]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-probe-pdf\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-probe-pdf has been given verify_jwt = false in supabase/config.toml.\n" +
        "  Anonymous callers could then make the platform hammer Insillion with any tenant's credentials, 28 requests at a time, and read the replies.",
    ).toBe(false);
  });
});

// ===========================================================================
// The classification, EXECUTED. `probeEndpoint` is lifted out of the shipped
// source and run against hand-built responses; every expectation is a literal.
// ===========================================================================

interface FakeResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

function response(bytes: Uint8Array, contentType: string | null, status = 200): FakeResponse {
  return {
    status,
    headers: { get: () => contentType },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const ascii = (s: string) => new TextEncoder().encode(s);

/** The shipped probe, with `fetch` replaced. Nothing else is substituted. */
function probeWith(res: FakeResponse | Error) {
  return liftAsyncEdge<
    (url: string, method: string, token: string, body?: string) => Promise<any>
  >(FN, "probeEndpoint", {
    fetch: async () => {
      if (res instanceof Error) throw res;
      return res;
    },
  }).call("https://api.invalid/probe", "GET", "token-value");
}

describe("bonzah/probe-pdf — the couldBePdf verdict (executed)", () => {
  it("recognises a PDF by its magic bytes, whatever the content-type says", async () => {
    // 25 50 44 46 is "%PDF". Insillion has served these under
    // application/octet-stream, which is the whole reason the byte check exists.
    const r = await probeWith(response(ascii("%PDF-1.7\nbody"), "application/octet-stream"));
    expect(r.couldBePdf, "The magic-byte check no longer recognises a PDF body.").toBe(true);
    expect(r.status).toBe(200);
    expect(
      r.bodyPreview.startsWith("[PDF binary data, 13 bytes]"),
      `The binary preview label changed: "${r.bodyPreview.slice(0, 40)}". It is what tells a ` +
        "human reading the diagnostic that the endpoint answered with a file rather than " +
        "with JSON.",
    ).toBe(true);
  });

  it("needs all four magic bytes — three is not a PDF", () => {
    // `uint8.length >= 4` guards the four index reads. A shorter body must not
    // be reported as promising, or the diagnostic sends someone chasing an
    // endpoint that returns three bytes.
    return probeWith(response(new Uint8Array([0x25, 0x50, 0x44]), "application/octet-stream")).then((r) => {
      expect(
        r.couldBePdf,
        "A three-byte body was reported as possibly-a-PDF. The length guard on the magic " +
          "byte check is gone, and uint8[3] would be undefined.",
      ).toBe(false);
    });
  });

  it("recognises a PDF by content-type alone", async () => {
    const r = await probeWith(response(ascii("not really a pdf"), "application/pdf"));
    expect(r.couldBePdf, "The content-type branch of couldBePdf is gone.").toBe(true);
    expect(r.contentType).toBe("application/pdf");
  });

  it("recognises a base64 PDF inside JSON, by the JVBER prefix", async () => {
    // btoa("%PDF…") always starts JVBER — the same four bytes, base64-encoded.
    // That is the only way to spot a PDF that arrived as a JSON string field.
    const r = await probeWith(
      response(ascii('{"status":0,"data":"JVBERi0xLjcKfoo"}'), "application/json"),
    );
    expect(
      r.couldBePdf,
      "The JVBER base64 sniff is gone. An endpoint returning the document as a base64 " +
        "JSON field would be reported as uninteresting — which is exactly the shape " +
        "bonzah-download-pdf's third branch handles.",
    ).toBe(true);
  });

  it("does not call a plain JSON error promising", async () => {
    const r = await probeWith(
      response(ascii('{"status":-1,"txt":"Invalid data id"}'), "application/json", 400),
    );
    expect(
      { couldBePdf: r.couldBePdf, status: r.status },
      "A plain Insillion error is being reported as a possible PDF. Every one of the 28 " +
        "probes would look promising and the diagnostic would say nothing.",
    ).toEqual({ couldBePdf: false, status: 400 });
  });

  it("caps the preview at 300 characters", async () => {
    const r = await probeWith(response(ascii("A".repeat(5000)), "text/plain"));
    expect(
      r.bodyPreview.length,
      "The body preview is no longer capped at 300 characters. This response is returned " +
        "to the caller for all 28 endpoints at once.",
    ).toBe(300);
    expect(src(), "The 2000-byte decode window is gone — the whole body would be decoded.").toMatch(
      /uint8\.slice\(0,\s*2000\)/,
    );
  });

  it("reports a thrown fetch as status 0 instead of failing the batch", async () => {
    const r = await probeWith(new Error("getaddrinfo ENOTFOUND"));
    expect(
      { status: r.status, couldBePdf: r.couldBePdf, contentType: r.contentType },
      "A thrown fetch no longer returns a result object. The whole diagnostic would then " +
        "reject on the first unreachable host.",
    ).toEqual({ status: 0, couldBePdf: false, contentType: null });
    expect(r.bodyPreview).toContain("[Fetch error: getaddrinfo ENOTFOUND]");
  });
});

describe("bonzah/probe-pdf — the summary counters (executed)", () => {
  it("counts promising, 2xx and errors — and puts a 3xx in none of them", () => {
    // The three filters lifted whole and run over a hand-built result set.
    // Expected counts are literals worked out by hand from the six rows below.
    const counters = liftStatements<
      (rows: unknown[]) => { promising: number; successful: number; errors: number }
    >({
      fn: FN,
      what: "the promising / successful / errors filters over probeResults",
      pattern:
        /(const promising = probeResults\.filter[\s\S]*?const errors = probeResults\.filter\([\s\S]*?\n\s*\))/,
      params: ["probeResults"],
      epilogue:
        "return { promising: promising.length, successful: successful.length, errors: errors.length };",
    });

    const rows = [
      { status: 200, couldBePdf: true }, // a hit
      { status: 204, couldBePdf: false }, // 2xx, nothing in it
      { status: 301, couldBePdf: false }, // a redirect
      { status: 400, couldBePdf: false }, // Insillion said no
      { status: 500, couldBePdf: false }, // Insillion fell over
      { status: 0, couldBePdf: false }, // the fetch threw
    ];

    expect(
      counters.call(rows),
      [
        "",
        "  The probe summary counts changed. Six hand-built rows go in:",
        "    200 (promising), 204, 301, 400, 500, 0",
        "",
        "  Expected: promising 1, successful 2 (200 + 204), errors 3 (400, 500, 0).",
        "",
        "  The 301 is deliberately in NONE of the three — `successful` is 200..299 and",
        "  `errors` is 0 or >=400, so a redirect is invisible in the summary and only shows",
        "  up in all_results. Worth knowing when reading the diagnostic's output; it is not",
        "  worth 'fixing' blind, because a 3xx from Insillion has never been observed.",
        "",
      ].join("\n"),
    ).toEqual({ promising: 1, successful: 2, errors: 3 });
  });
});

// ===========================================================================
// LAYER 2 — deliberately absent, and this is the case that says why.
// ===========================================================================
describe("bonzah/probe-pdf — why there is no live case", () => {
  it("is not read-only: ten of its twenty-eight probes are POSTs", () => {
    // The rung question for every function in this suite is "what does a 200
    // cost". For this one the honest answer is: unknown. Ten POSTs at Insillion
    // endpoints that may not exist, with bodies we invented, on the tenant's own
    // authenticated session. There is no rung at which firing those is a test,
    // so this file has no live case — rather than a live case gated behind a
    // flag nobody would ever be right to set.
    const block = endpointDefsBlock();
    const posts = [...block.matchAll(/method:\s*'POST'/g)].length;
    const gets = [...block.matchAll(/method:\s*'GET'/g)].length;

    expect(
      { posts, gets, total: posts + gets },
      [
        "",
        "  The probe's endpoint list changed shape.",
        "",
        "  Expected 10 POSTs and 18 GETs, 28 in total — the numbers this file's reasoning",
        "  about Layer 2 rests on. If you ADDED endpoints, update these literals and re-read",
        "  the question they answer: a POST at a third-party insurance API with a body we",
        "  made up is not provably read-only, which is why bonzah-probe-pdf has no live case",
        "  in this suite at any rung.",
        "",
      ].join("\n"),
    ).toEqual({ posts: 10, gets: 18, total: 28 });
  });

  it("returns 300 characters of every upstream response to its caller", () => {
    // The other half of the reason. Whatever Insillion says — including error
    // bodies that may name the account — is echoed back to whoever called, and
    // "whoever called" is any authenticated user, since this function is absent
    // from supabase/config.toml and takes tenant_id off the request body.
    const s = src();
    expect(s, "The all_results echo is gone.").toMatch(/all_results:\s*probeResults/);
    expect(
      /auth\.getUser\(|app_users|get_user_tenant_id/.test(s),
      "An authorization check appeared in bonzah-probe-pdf — good. Pin what it checks and " +
        "delete this note: the reason it mattered is that the function echoes upstream " +
        "response bodies for a tenant named entirely by the request body.",
    ).toBe(false);
  });
});
