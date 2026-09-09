// =============================================================================
// boldsign/routes — the six portal API routes an operator actually touches.
//
//   apps/portal/src/app/api/esign/route.ts              send / resend
//   apps/portal/src/app/api/esign/sign/route.ts         open the signing page
//   apps/portal/src/app/api/esign/view/route.ts         open the PDF
//   apps/portal/src/app/api/esign/status/route.ts       "has it been signed?"
//   apps/portal/src/app/api/esign/void/route.ts         cancel an agreement
//   apps/portal/src/app/api/esign/signing-redirect/     the customer's email link
//
// WHY A FILE FOR THESE
// -------------------
// `send.test.ts`, `resend.test.ts`, `view.test.ts` and `mode.test.ts` already
// cover what these routes SAY to BoldSign — the payload, the delivery legs, the
// key each one picks. What none of them looks at is the perimeter: which verbs
// a route answers, whether it establishes who is calling, and whether the row
// it reaches for belongs to the caller at all. When e-signature breaks for a
// real tenant it breaks here, and when it leaks it leaks here.
//
// These are Next route handlers, not edge functions, so `tests/helpers/
// edge-contract.ts` cannot read them: it looks for `Deno.serve(async` and for
// one of three `await req.json()` shapes, and a Next handler has neither. It
// exports one named function per HTTP method instead — and that export list IS
// the method contract, because Next answers 405 for every verb without one.
// `route-source.ts` in this folder does that reading, keeping the same rule the
// shared helper keeps: every parser throws rather than returning an empty set.
//
// WHAT READING ALL SIX ESTABLISHED — and it is the headline
// --------------------------------------------------------
// **Not one of them authenticates its caller.** No `supabase.auth`, no session,
// no cookie, no `Authorization` header, no `app_users` lookup, no role check —
// in any of the six. Each builds a `service_role` Supabase client, which
// bypasses every policy in the database by design, and then addresses rows by
// an id taken straight from the request body.
//
// And they cannot fall back on the platform's tenant plumbing either, because
// the portal's proxy explicitly excludes `/api` from its matcher: the
// `x-tenant-slug` header every server component relies on never reaches these
// routes at all. That is asserted below, from the matcher itself.
//
// V2_PLAN.md §5 is unambiguous about what that costs — RLS is OFF on `rentals`,
// `customers` and `customer_documents`, so "tenant isolation is enforced ONLY in
// application code" and a missing `tenant_id` filter is "the highest-severity
// kind, on par with a data loss bug". Here there is no tenant to filter BY,
// because none was ever established. The two are one finding: you cannot scope
// to a tenant you never identified.
//
// NOTHING IN THIS FILE BLESSES THAT. The auth and tenant cases are WATCHDOGS —
// they skip, loudly, with the finding, and convert themselves into real
// assertions the moment any check appears. The rest of the file asserts, hard,
// the guards that DO hold, because those are what stand between an operator and
// a voided contract today and they must not quietly regress.
// =============================================================================

import { describe, expect, it } from "vitest";

import { portalCall, portalTarget, readRepoSource } from "./boldsign-source";
import {
  authMarkers,
  blankComments,
  exportedHttpMethods,
  positionsOf,
  present,
  queryChains,
  readBaseline,
  readRoute,
  requireAllFound,
  TENANT_OWNED_TABLES,
  type HttpMethod,
} from "./route-source";

const SEND = "apps/portal/src/app/api/esign/route.ts";
const SIGN = "apps/portal/src/app/api/esign/sign/route.ts";
const VIEW = "apps/portal/src/app/api/esign/view/route.ts";
const STATUS = "apps/portal/src/app/api/esign/status/route.ts";
const VOID = "apps/portal/src/app/api/esign/void/route.ts";
const REDIRECT = "apps/portal/src/app/api/esign/signing-redirect/route.ts";

/** All six, in the order an agreement moves through them. */
const ROUTES: { name: string; file: string; verbs: HttpMethod[] }[] = [
  { name: "/api/esign", file: SEND, verbs: ["POST"] },
  { name: "/api/esign/sign", file: SIGN, verbs: ["POST"] },
  { name: "/api/esign/view", file: VIEW, verbs: ["POST"] },
  { name: "/api/esign/status", file: STATUS, verbs: ["POST"] },
  { name: "/api/esign/void", file: VOID, verbs: ["POST"] },
  // The one deliberate GET: a customer opens it from an email, so it cannot
  // be a POST and cannot require a session.
  { name: "/api/esign/signing-redirect", file: REDIRECT, verbs: ["GET"] },
];

/** The five an OPERATOR drives. `signing-redirect` is the customer's. */
const OPERATOR_ROUTES = ROUTES.filter((r) => r.file !== REDIRECT);

const PORTAL_PROXY = "apps/portal/src/proxy.ts";

// ===========================================================================
// The method contract
// ===========================================================================
describe("boldsign/routes — which verbs each route answers", () => {
  it("each route exports exactly the handlers it is meant to, and no others", () => {
    // Derived: the export list is read out of the file. Only the expectation is
    // written by hand. A route that grows a GET has grown a second, differently
    // shaped entrance to the same service_role client, and Next will serve it.
    for (const { name, file, verbs } of ROUTES) {
      expect(
        exportedHttpMethods(file),
        `${name} no longer accepts exactly ${verbs.join("+")}.\n` +
          "  FAILURE MODE (a) if a verb was added deliberately — but check what the new\n" +
          "  handler does before updating this list. Every one of these routes builds a\n" +
          "  service_role client and takes its row id from the request, so a new verb is\n" +
          "  a new unauthenticated entrance, not just a new endpoint.\n" +
          "  A GET is the one to look hardest at: it is reachable from a link, an <img>\n" +
          "  tag and a prefetch, none of which a POST is.",
      ).toEqual(verbs);
    }
  });

  it("the customer-facing link route is the only GET, and it is documented as public", () => {
    expect(
      exportedHttpMethods(REDIRECT),
      "/api/esign/signing-redirect is no longer a GET-only route. It is opened by a\n" +
        "  customer's mail client from a link in an email — it has to be a GET, and it\n" +
        "  has to work with no session. Anything else here changes who can sign.",
    ).toEqual(["GET"]);

    // Its public-ness is deliberate and the source says so. That comment is the
    // difference between "public by design" and "public by omission", and it is
    // the only route of the six that can claim the former.
    expect(
      present(readRepoSource(REDIRECT), /Public GET endpoint for email signing links/),
      "/api/esign/signing-redirect no longer documents itself as a public endpoint.\n" +
        "  It is the one route here whose lack of auth is intentional; losing the note\n" +
        "  that says so makes it indistinguishable from the five where it is not.",
    ).toBe(true);

    for (const { name, file, verbs } of OPERATOR_ROUTES) {
      expect(
        verbs.includes("GET") || exportedHttpMethods(file).includes("GET"),
        `${name} has grown a GET handler. The operator routes are POST-only so that a\n` +
          "  bare URL cannot trigger them — a GET /api/esign/void?agreementId=… would be\n" +
          "  reachable from any link a customer or a crawler follows.",
      ).toBe(false);
    }
  });
});

// ===========================================================================
// Who is allowed to call them
// ===========================================================================
describe("boldsign/routes — who is allowed to call them", () => {
  it("every route runs as service_role, which bypasses every policy in the database", () => {
    // The premise of everything below. Asserted rather than assumed, because if
    // a route were ever switched to an anon or user-scoped client the whole
    // shape of the risk changes and these tests should be re-read, not trusted.
    for (const { name, file } of ROUTES) {
      expect(
        present(readRoute(file), "SUPABASE_SERVICE_ROLE_KEY"),
        `${name} no longer builds its Supabase client from SUPABASE_SERVICE_ROLE_KEY.\n` +
          "  If it now uses a user-scoped client, that is a significant improvement and\n" +
          "  the watchdogs in this file should be re-read rather than trusted.",
      ).toBe(true);
    }
  });

  it("a missing service key degrades to the anon key, which silently breaks the agreement tables", () => {
    // All six share the same fallback:
    //     SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY
    // `rental_agreements` has RLS ON (asserted from the deployed snapshot
    // below), and the anon key satisfies no policy on it. So a missing env var
    // does not produce a configuration error — it produces "Agreement not
    // found" on every route, for every tenant, indefinitely.
    for (const { name, file } of ROUTES) {
      expect(
        present(readRoute(file), "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        `${name} no longer falls back to the anon key. If the fallback was REMOVED that\n` +
          "  is a fix — a missing service key should fail loudly, not turn into a 404 on\n" +
          "  every agreement — and this test should assert the new failure instead.",
      ).toBe(true);
    }

    expect(
      readBaseline().schema.tables.rental_agreements?.rls,
      "rental_agreements no longer has RLS enabled in the deployed snapshot. That\n" +
        "  changes what the anon-key fallback above degrades to: today it fails closed\n" +
        "  on this table (404s), with RLS off it would fail OPEN.",
    ).toBe(true);
  });

  it("the portal proxy never runs on /api, so no tenant context reaches these routes", () => {
    // This is what closes the door on "well, the middleware must be handling
    // it". It is not: `api` is the first exclusion in the matcher, so
    // `x-tenant-slug` — the header every server component in the portal reads
    // its tenant from — is never set on a request to any of these six.
    const proxy = readRoute(PORTAL_PROXY);

    expect(
      present(proxy, "x-tenant-slug"),
      "The portal proxy no longer sets x-tenant-slug at all. Every server-side tenant\n" +
        "  resolution in the portal depends on it.",
    ).toBe(true);

    const matcherAt = proxy.indexOf("matcher:");
    expect(matcherAt, "the portal proxy no longer declares a matcher").toBeGreaterThan(-1);
    const matcher = proxy.slice(matcherAt, matcherAt + 400);
    expect(
      /\(\?!api\|/.test(matcher),
      "The portal proxy's matcher no longer excludes `api`.\n" +
        "  If /api is now IN scope, these routes finally receive x-tenant-slug and the\n" +
        "  tenant watchdogs below have something to work with — go and use it. If the\n" +
        "  exclusion simply moved, re-anchor this assertion; do not delete it, because\n" +
        "  'the middleware must be handling it' is the assumption this test exists to\n" +
        "  refuse.",
    ).toBe(true);

    // And no route reads the header anyway, matcher or not.
    for (const { name, file } of ROUTES) {
      expect(
        readRoute(file).includes("x-tenant-slug"),
        `${name} now reads x-tenant-slug. Given the matcher above it would be absent on\n` +
          "  every request — so either the matcher changed too, or this route is about to\n" +
          "  treat `undefined` as a tenant.",
      ).toBe(false);
    }
  });

  it("WATCHDOG: an operator route establishes who is calling before it reaches for data", (ctx) => {
    // FINDING: none of them does.
    const found = ROUTES.map((r) => ({ ...r, markers: authMarkers(r.file) }));
    const withAuth = found.filter((r) => r.markers.length > 0);

    if (withAuth.length === 0) {
      ctx.skip(
        [
          "",
          "FINDING — the six portal e-sign routes authenticate nobody.",
          "",
          "  Swept for: supabase.auth, getUser(), getSession(), createServerClient(),",
          "  createRouteHandlerClient(), cookies(), an Authorization header, x-tenant-slug,",
          "  an app_users lookup, manager_permissions, is_super_admin, and any",
          "  requireAuth/withAuth wrapper. NOT ONE appears in ANY of the six.",
          "",
          "  Each route builds a service_role client — which bypasses every policy in the",
          "  database — and then addresses rows by an id read straight from the request.",
          "  The portal proxy does not run on /api (asserted above), so there is no",
          "  session and no tenant header either.",
          "",
          "  What that means route by route, for anyone who can reach the host and knows",
          "  or guesses one uuid:",
          "",
          "    /api/esign/view    returns another tenant's SIGNED rental agreement as",
          "                       base64 PDF. It will also download an arbitrary",
          "                       BoldSign documentId handed to it as `envelopeId`,",
          "                       with our API key and no database lookup at all.",
          "    /api/esign/void    REVOKES another tenant's outstanding agreement at",
          "                       BoldSign and marks the row voided. Not reversible.",
          "    /api/esign         issues a real, legally-presented agreement against any",
          "                       rental — and spends e-sign credits from whichever",
          "                       tenant wallet the BODY names.",
          "    /api/esign/sign    mints an embedded BoldSign signing link for any",
          "                       unsigned rental, i.e. a link that signs the contract.",
          "    /api/esign/status  writes document_status onto any rental or agreement.",
          "",
          "  V2_PLAN.md §5: RLS is OFF on rentals, customers and customer_documents, so",
          "  \"tenant isolation is enforced ONLY in application code\" and a missing",
          "  tenant filter is \"the highest-severity kind, on par with a data loss bug\".",
          "  Here there is nothing to filter BY — no caller was ever identified.",
          "",
          "  THIS CASE IS SKIPPED, NOT PASSED. It asserts nothing about today's",
          "  behaviour and blesses none of it. Add a check to any route and it arms",
          "  itself: it will then require all five operator routes to have one, and to",
          "  run it before the first database call.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed. Someone has started fixing this — hold the whole surface to it.
    const missing = OPERATOR_ROUTES.filter((r) => authMarkers(r.file).length === 0);
    expect(
      missing.map((r) => r.name),
      `${withAuth.length} e-sign route(s) now authenticate their caller` +
        ` (${withAuth.map((r) => `${r.name}: ${r.markers.join(", ")}`).join("; ")}),\n` +
        "  but these do not. A partial fix is the dangerous state: the routes that are\n" +
        "  still open are the ones an attacker uses, and the ones that are closed make\n" +
        "  the surface look handled.",
    ).toEqual([]);

    // And it has to run BEFORE the route touches anything.
    for (const { name, file } of OPERATOR_ROUTES) {
      const src = readRoute(file);
      const firstQuery = src.indexOf(".from(");
      const firstBoldSign = src.indexOf("BOLDSIGN_BASE_URL}");
      const firstSideEffect = Math.min(
        ...[firstQuery, firstBoldSign].filter((n) => n > -1),
      );
      const firstAuth = Math.min(
        ...authMarkers(file)
          .map(() => 0)
          .concat(
            [/supabase\.auth\b/, /\bgetUser\s*\(/, /\bgetSession\s*\(/, /createServerClient\s*\(/, /\bcookies\s*\(\s*\)/]
              .map((re) => re.exec(src)?.index ?? Number.MAX_SAFE_INTEGER),
          )
          .filter((n) => n > 0),
      );
      expect(
        firstAuth < firstSideEffect,
        `${name} authenticates its caller AFTER its first database or BoldSign call.\n` +
          "  A check that runs after the read has already happened is not a check.",
      ).toBe(true);
    }
  });
});

// ===========================================================================
// Tenant isolation — V2_PLAN §5
// ===========================================================================
describe("boldsign/routes — tenant isolation", () => {
  it("the tables these routes address are still the ones with no database net beneath them", () => {
    // From the deployed-schema snapshot, not from a migration. V2_PLAN §5 says
    // this state is known and deliberately accepted — the point of asserting it
    // is that these tests were written for a world where it is true, so if it
    // stops being true they need re-reading rather than trusting.
    const tables = readBaseline().schema.tables;
    for (const [table, expected] of [
      ["rentals", false],
      ["customers", false],
      ["customer_documents", false],
      ["rental_agreements", true],
    ] as const) {
      expect(
        tables[table]?.rls,
        `${table}'s RLS flag has changed in the deployed snapshot.\n` +
          "  If it went ON, that is the v2 isolation work landing — good, and the\n" +
          "  service_role clients in these routes still bypass it, so the watchdogs\n" +
          "  below stay relevant. If it went OFF, one more table just lost its net.",
      ).toBe(expected);
    }
  });

  it("WATCHDOG: a route scopes its primary lookup to a tenant", (ctx) => {
    // FINDING: not one of the six does.
    //
    // Every route resolves its subject with `.from('rentals'|'rental_agreements')
    // .eq('id', <id from the request body>)`. Addressing a row by primary key is
    // fine in itself — the problem is that the id came from the caller and no
    // caller was ever identified, so nothing anywhere connects that row to
    // whoever asked for it.
    const primary = ROUTES.map((r) => {
      const chains = queryChains(r.file).filter(
        (c) => c.table === "rentals" || c.table === "rental_agreements",
      );
      return { ...r, chains };
    });
    for (const p of primary) {
      expect(
        p.chains.length,
        `${p.name} no longer queries rentals or rental_agreements at all. Every e-sign\n` +
          "  route resolves an agreement; zero chains means the parser or the route moved.",
      ).toBeGreaterThan(0);
    }
    const scoped = primary.filter((p) => p.chains.some((c) => c.tenantScoped));

    if (scoped.length === 0) {
      const writes = primary.flatMap((p) =>
        p.chains.filter((c) => c.op === "write").map((c) => `${p.name}:${c.line} ${c.table} UPDATE/INSERT`),
      );
      ctx.skip(
        [
          "",
          "FINDING — no e-sign route scopes its rentals / rental_agreements access to a tenant.",
          "",
          ...primary.map(
            (p) =>
              `  ${p.name}\n` +
              p.chains
                .map(
                  (c) =>
                    `      line ${c.line}  ${c.table} [${c.op}]` +
                    `${c.byId ? " by id" : ""}  tenant-scoped: ${c.tenantScoped}`,
                )
                .join("\n"),
          ),
          "",
          `  Unscoped WRITES among them (${writes.length}) — where V2_PLAN §5 says the`,
          "  consequence is worse, because a missing tenant_id in a WHERE clause writes to",
          "  another paying customer's live data:",
          ...writes.map((w) => `    - ${w}`),
          "",
          "  This is downstream of the auth watchdog above and not separately fixable:",
          "  there is no tenant to filter by, because no caller is ever identified. Fix",
          "  the auth and the filter becomes possible; fix only the filter and there is",
          "  nothing to compare against.",
          "",
          "  SKIPPED, NOT PASSED. The moment any route scopes one of these lookups, this",
          "  case arms and requires the rest to follow.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed: someone started scoping. Require all of them.
    expect(
      primary.filter((p) => !p.chains.some((c) => c.tenantScoped)).map((p) => p.name),
      `${scoped.length} route(s) now scope their agreement lookup to a tenant` +
        ` (${scoped.map((s) => s.name).join(", ")}), but these do not.\n` +
        "  A half-scoped surface is worse than an unscoped one, because it reads as done.",
    ).toEqual([]);
  });

  it("the send route still resolves the agreement row's tenant from the RENTAL, server-side", () => {
    // The one place in this surface that gets it right, and the reason it is
    // right is written into the file: trusting body.tenantId puts the row under
    // the wrong tenant and RLS on rental_agreements then hides it from the very
    // operator who just sent it. HARD assertion — this must not regress.
    const src = readRoute(SEND);
    expect(
      present(src, /resolvedTenantId\s*=\s*\(rental\?\.tenant_id[^)]*\)\s*\|\|\s*body\.tenantId/),
      "The send route no longer derives the agreement's tenant from the rental row.\n" +
        "  Looked for: `const resolvedTenantId = (rental?.tenant_id …) || body.tenantId`\n" +
        "  Dropping that puts the rental_agreements row under whatever tenant the client\n" +
        "  named, and rental_agreements HAS RLS — so a mismatch silently hides the\n" +
        "  agreement from the operator who just sent it.",
    ).toBe(true);

    const at = positionsOf(src, {
      resolve: "const resolvedTenantId",
      insert: "tenant_id: resolvedTenantId,",
    });
    requireAllFound(at, "send route tenant resolution");
    expect(
      at.resolve < at.insert,
      "The agreement insert no longer sits below the tenant resolution it uses.",
    ).toBe(true);
  });

  it("WATCHDOG: /api/esign charges credits to the tenant it resolved, not the one it was told", (ctx) => {
    // FINDING: it charges body.tenantId — the value the same file documents as
    // untrustworthy four hundred lines further down.
    const src = readRoute(SEND);
    const bodyUses = [...src.matchAll(/body\s*\??\s*\.\s*tenantId/g)].length;
    const resolvedUses = [...src.matchAll(/resolvedTenantId/g)].length;

    const deductAt = src.indexOf("deduct_credits");
    expect(deductAt, "the blocking credit check is gone from the send route").toBeGreaterThan(-1);
    const deductCall = src.slice(deductAt, deductAt + 500);
    const chargesBody = /p_tenant_id:\s*body\.tenantId/.test(deductCall);

    if (chargesBody) {
      const resolveAt = src.indexOf("const resolvedTenantId");
      const templateAt = src.indexOf("agreement_templates");
      ctx.skip(
        [
          "",
          "FINDING — /api/esign trusts body.tenantId for the money and the legal text,",
          "          while explicitly distrusting it for the row it writes.",
          "",
          `  body.tenantId is used ${bodyUses} times in this route (comments excluded).`,
          `  resolvedTenantId — the server-derived value — is used ${resolvedUses} times.`,
          "",
          "  The file's own comment above the agreement insert explains why the caller's",
          "  value cannot be trusted: \"if the operator's TenantContext briefly resolves",
          "  to a different tenant (or undefined during a rapid navigation), the row",
          "  would land with the wrong tenant_id\". That reasoning applies to every use,",
          "  but the resolution happens at character " + resolveAt + " — AFTER:",
          "",
          `    * the agreement_templates lookup (character ${templateAt}), which selects`,
          "      WHICH CONTRACT TEXT is put in front of the customer:",
          "        .eq('tenant_id', body.tenantId).eq('template_category', ...)",
          "      A wrong value here renders one operator's terms over another",
          "      operator's rental — a legal document, not a display bug.",
          `    * the deduct_credits RPC (character ${deductAt}):`,
          "        p_tenant_id: body.tenantId",
          "      Real balance, paid for by a real operator, and deduct_credits has no",
          "      DELETE. The wallet charged and the agreement filed can be two",
          "      different tenants for the same request.",
          "    * the credit_failed and send_failed rental_agreements inserts, and the",
          "      customer_users / customer_notifications pair, which all use",
          "      body.tenantId while the SUCCESS insert uses resolvedTenantId — so the",
          "      same route files the same kind of row under two different tenants",
          "      depending on whether it worked.",
          "",
          "  FIX: resolve the tenant from the rental once, immediately after the rental",
          "  is fetched, and use it everywhere. This case arms itself the moment",
          "  deduct_credits stops naming body.tenantId.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed: the money now uses a resolved tenant. Require it to be resolved
    // FIRST, which is the half that is easy to get wrong while fixing this.
    expect(
      deductCall,
      "deduct_credits no longer charges body.tenantId — good — but it does not name\n" +
        "  resolvedTenantId either. Whatever it charges must be derived from the rental.",
    ).toMatch(/p_tenant_id:\s*resolvedTenantId/);
    const at = positionsOf(src, {
      resolve: "const resolvedTenantId",
      deduct: "deduct_credits",
      template: "agreement_templates",
    });
    requireAllFound(at, "send route tenant ordering");
    expect(
      at.resolve < at.deduct && at.resolve < at.template,
      "The tenant is still resolved AFTER the credit deduction or the template lookup.\n" +
        "  Both spend or decide something on the caller's word before the server has\n" +
        "  worked out whose rental this is.",
    ).toBe(true);
  });

  it("WATCHDOG: /api/esign/view will not download a BoldSign document it was simply handed", (ctx) => {
    // FINDING: it will. `envelopeId` from the body becomes `documentId` with no
    // lookup, so the route is a proxy that fetches any document in our BoldSign
    // account using our API key.
    const src = readRoute(VIEW);
    const passthrough = /let\s+documentId\s*=\s*providedEnvelopeId/.test(src);

    if (passthrough) {
      ctx.skip(
        [
          "",
          "FINDING — /api/esign/view downloads a caller-supplied BoldSign document id.",
          "",
          "    const { rentalId, envelopeId: providedEnvelopeId, agreementId } = await request.json();",
          "    let documentId = providedEnvelopeId;",
          "",
          "  When `envelopeId` is supplied, no row is read: not rental_agreements, not",
          "  rentals, nothing. The route goes straight to",
          "  GET /v1/document/download?documentId=… with the tenant's BoldSign key and",
          "  returns the PDF as base64.",
          "",
          "  The other two identifiers at least pass through a database row first. This",
          "  one turns the route into an open proxy for every document in the account,",
          "  which — because agreements are one document per rental across every tenant",
          "  on a shared BoldSign account in test mode — is every tenant's contracts.",
          "",
          "  Combined with the auth finding above, the id is the only secret.",
          "",
          "  FIX: resolve envelopeId against rental_agreements.document_id (or",
          "  rentals.docusign_envelope_id) before using it, exactly as the agreementId",
          "  path does. This case arms when the raw assignment is gone.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed: the passthrough is gone. Make sure it was replaced by a lookup and
    // not simply by dropping support for the field.
    const stillAccepted = present(src, /envelopeId\s*:\s*providedEnvelopeId/);
    expect(
      !stillAccepted || present(src, /eq\(\s*['"]document_id['"]\s*,\s*providedEnvelopeId/),
      "The raw `documentId = providedEnvelopeId` assignment is gone, but the route\n" +
        "  still destructures `envelopeId` off the body and never resolves it against\n" +
        "  rental_agreements.document_id. Accepting the field without checking it is the\n" +
        "  same hole in a different shape — the fix is a lookup, not a rename.",
    ).toBe(true);
  });

  it("WATCHDOG: a failed send does not hand the caller part of the BoldSign API key", (ctx) => {
    // FINDING: it does — the first eight characters, in the error body, on a
    // route with no authentication.
    const src = readRoute(SEND);
    const leaks = /apiKeyPrefix:\s*BOLDSIGN_API_KEY\.substring\(0,\s*8\)/.test(src);

    if (leaks) {
      ctx.skip(
        [
          "",
          "FINDING — /api/esign returns a fragment of the BoldSign API key on failure.",
          "",
          "    return NextResponse.json({ ok: false, error: 'Failed to create document',",
          "      detail: errorText, boldsignStatus: …, hasApiKey: !!BOLDSIGN_API_KEY,",
          "      apiKeyPrefix: BOLDSIGN_API_KEY.substring(0, 8) + '...' }, { status: 500 });",
          "",
          "  Eight characters is not the key, and this was plainly added to debug a",
          "  test/live key mix-up. But it is a secret fragment returned to an",
          "  unauthenticated caller, it confirms WHICH key the server holds, and the raw",
          "  BoldSign error text goes out with it.",
          "",
          "  FIX: log it, do not return it. This case arms when the field is gone.",
          "",
        ].join("\n"),
      );
      return;
    }

    expect(
      src.includes("apiKeyPrefix"),
      "apiKeyPrefix is gone from the substring form but still appears in the route.\n" +
        "  Check what it carries now — the point was to stop returning key material.",
    ).toBe(false);
  });
});

// ===========================================================================
// /api/esign/void — the guards that DO hold, and the model the others should
// have followed. Hard assertions throughout: these are what stand between an
// operator and a revoked contract.
// ===========================================================================
describe("boldsign/routes — /api/esign/void, the correct model", () => {
  it("an already-signed agreement is refused on BOTH lookup paths, before anything is revoked", () => {
    const src = readRoute(VOID);
    const guard = "Cannot void an already-signed agreement";

    // Both paths — by agreementId and by rentalId — carry the guard. One of
    // them missing it would leave a signed contract revocable through the other.
    expect(
      [...src.matchAll(new RegExp(guard, "g"))].length,
      "/api/esign/void no longer refuses an already-signed agreement on both of its\n" +
        "  lookup paths (agreementId and rentalId). A signed rental agreement that can\n" +
        "  be revoked is a destroyed contract — BoldSign's revoke has no undo.",
    ).toBe(2);

    const at = positionsOf(src, {
      signedGuard: guard,
      revoke: "/v1/document/revoke",
    });
    requireAllFound(at, "/api/esign/void signed guard");
    expect(
      at.signedGuard < at.revoke,
      "The already-signed guard now runs AFTER the revoke call. It is not a guard.",
    ).toBe(true);

    // …and it treats both terminal spellings as signed. Only one of them would
    // leave agreements that read as signed everywhere else still revocable.
    expect(
      present(src, /document_status === 'signed' \|\| \w+\.document_status === 'completed'/),
      "/api/esign/void no longer treats BOTH 'signed' and 'completed' as already-signed.\n" +
        "  This codebase writes both (boldsign-webhook maps BoldSign's per-signer\n" +
        "  'Signed' event to 'signed' and 'Completed' to 'completed'), so recognising\n" +
        "  one leaves the other revocable.",
    ).toBe(true);
  });

  it("nothing is revoked without an identifier, a resolved document and a key", () => {
    const src = readRoute(VOID);
    const at = positionsOf(src, {
      identifier: "agreementId or rentalId required",
      noDocument: "No document ID resolved",
      notConfigured: "BoldSign not configured",
      key: "getBoldSignApiKey(mode)",
      revoke: "/v1/document/revoke",
    });
    requireAllFound(at, "/api/esign/void guard ladder");

    expect(at.identifier < at.noDocument, "the identifier check moved below the document check").toBe(true);
    expect(at.noDocument < at.key, "the document is now resolved after the key is chosen").toBe(true);
    expect(at.key < at.revoke, "the API key is now chosen after the revoke call").toBe(true);
    expect(
      at.notConfigured < at.revoke,
      "The 'BoldSign not configured' bail-out now sits below the revoke call, so a\n" +
        "  route with no key would call BoldSign unauthenticated and report the 401 as\n" +
        "  a revoke failure.",
    ).toBe(true);
  });

  it("the rows are marked voided only AFTER BoldSign confirms, and only the right rows", () => {
    const src = readRoute(VOID);
    const at = positionsOf(src, {
      revokeFailed: "Failed to void agreement at BoldSign",
      markVoided: "document_status: 'voided'",
      isOriginal: "if (isOriginal && resolvedRentalId)",
    });
    requireAllFound(at, "/api/esign/void write-back");

    expect(
      at.revokeFailed < at.markVoided,
      "The rows are now marked voided before the BoldSign failure is handled. An\n" +
        "  agreement shown as voided while its signing link is still live is the worst\n" +
        "  outcome available here: the operator stops chasing it and the customer can\n" +
        "  still sign it.",
    ).toBe(true);

    // The rentals row carries the ORIGINAL agreement's status only. Voiding an
    // extension must not blank the rental's own document_status.
    expect(
      at.isOriginal,
      "/api/esign/void no longer gates the rentals write on the agreement being the\n" +
        "  original. Voiding an EXTENSION would then mark the whole rental's agreement\n" +
        "  voided, and the signed original would show as cancelled.",
    ).toBeGreaterThan(-1);

    const chains = queryChains(VOID).filter((c) => c.op === "write");
    expect(
      chains.map((c) => c.table).sort(),
      "/api/esign/void's write targets changed. It writes exactly two rows: the\n" +
        "  agreement, and — only for an original — the rental.",
    ).toEqual(["rental_agreements", "rentals"]);
  });
});

// ===========================================================================
// The other guards that hold today
// ===========================================================================
describe("boldsign/routes — the guards the other routes do hold", () => {
  it("/api/esign/sign will not re-open a signed document, or sign without a signer", () => {
    const src = readRoute(SIGN);
    const at = positionsOf(src, {
      identifier: "Missing rental ID or agreement ID",
      noDocument: "No document for this rental",
      alreadySigned: "Document already signed",
      noCustomer: "Customer info not found",
      link: "getEmbeddedSignLink",
    });
    requireAllFound(at, "/api/esign/sign guard ladder");

    expect(at.identifier < at.noDocument, "the identifier check moved below the document check").toBe(true);
    expect(
      at.alreadySigned < at.link,
      "/api/esign/sign now asks BoldSign for a signing link BEFORE checking whether\n" +
        "  the document is already signed. A second signature on a completed agreement\n" +
        "  is not something to leave to BoldSign to refuse.",
    ).toBe(true);
    expect(
      at.noCustomer < at.link,
      "The signer check now runs after the link is requested. getEmbeddedSignLink is\n" +
        "  keyed on signerEmail — with no email the request is made and fails, burning\n" +
        "  a call against a 50/hour quota that real sends depend on.",
    ).toBe(true);
  });

  it("/api/esign/signing-redirect hands the customer a redirect, never the link itself", () => {
    // The distinction matters: an embedded BoldSign sign link IS the authority
    // to sign. Returned in a JSON body it can be collected by anything that can
    // call the route; issued as a 3xx it is followed by the browser that asked.
    const src = readRoute(REDIRECT);
    expect(
      present(src, "NextResponse.redirect(signLink)"),
      "/api/esign/signing-redirect no longer redirects. If it now returns the signing\n" +
        "  link in a response body, that link is the authority to sign a rental\n" +
        "  agreement and this route has no authentication at all.",
    ).toBe(true);
    expect(
      src.includes("NextResponse.json"),
      "/api/esign/signing-redirect has grown a JSON response. It answers plain text\n" +
        "  and redirects on purpose — it is opened by a mail client, not by code — and\n" +
        "  a JSON body is how the sign link would start being handed out.",
    ).toBe(false);

    const at = positionsOf(src, {
      missingId: "Missing agreement ID",
      notFound: "Agreement not found",
      alreadySigned: "already been signed",
      link: "getEmbeddedSignLink",
      redirect: "NextResponse.redirect",
    });
    requireAllFound(at, "/api/esign/signing-redirect guard ladder");
    expect(at.missingId < at.notFound, "the id check moved below the agreement lookup").toBe(true);
    expect(
      at.alreadySigned < at.link,
      "A signed agreement's link is now fetched before the already-signed check.",
    ).toBe(true);
    expect(at.link < at.redirect, "the redirect now happens before the link is fetched").toBe(true);
  });

  it("/api/esign/status writes back only the rows the request actually named", () => {
    const src = readRoute(STATUS);

    // Two conditional write-backs. Both conditions are load-bearing: without
    // the first, an agreement-less request updates `.eq('id', undefined)`;
    // without the second, an EXTENSION's status is copied onto the rental and
    // overwrites the original agreement's.
    expect(
      present(src, /if\s*\(agreementId\)\s*\{\s*const\s*\{\s*error:\s*agreeError\s*\}/),
      "/api/esign/status no longer gates the rental_agreements write on agreementId.",
    ).toBe(true);
    expect(
      present(src, "if (rentalId && (!agreementType || agreementType === 'original'))"),
      "/api/esign/status no longer restricts the rentals write to original agreements.\n" +
        "  An extension's status would then be written onto the rental row, showing the\n" +
        "  ORIGINAL agreement as whatever the extension is.",
    ).toBe(true);

    const writes = queryChains(STATUS).filter((c) => c.op === "write");
    expect(
      writes.map((c) => c.table).sort(),
      "/api/esign/status's write targets changed.",
    ).toEqual(["rental_agreements", "rentals"]);
    for (const w of writes) {
      expect(
        w.byId,
        `/api/esign/status line ${w.line} now writes ${w.table} without addressing a\n` +
          "  single row by id. An UPDATE with no id on an RLS-off table is a\n" +
          "  platform-wide write.",
      ).toBe(true);
    }
  });

  it("every route answers with a JSON or text error rather than letting the handler throw", () => {
    // A Next route that throws returns an opaque 500 with a framework stack.
    // These all catch. Cheap to assert, and it is the difference between an
    // operator seeing "BoldSign not configured" and seeing nothing.
    for (const { name, file } of ROUTES) {
      const src = readRoute(file);
      expect(
        present(src, /\}\s*catch\s*\(/),
        `${name} no longer wraps its handler in try/catch`,
      ).toBe(true);
      expect(
        /catch[\s\S]{0,400}(NextResponse\.json|new NextResponse)/.test(src),
        `${name}'s catch block no longer returns a response. An unhandled throw in a\n` +
          "  Next route handler is an opaque 500 the operator cannot act on.",
      ).toBe(true);
    }
  });

  it("no route touches a tenant-owned table it has no business in", () => {
    // A drift alarm rather than a security control: if one of these routes
    // starts reading `payments` or writing `customers`, that is a scope change
    // worth noticing on a surface with no authentication.
    const allowed = new Set([...TENANT_OWNED_TABLES, "tenants"]);
    for (const { name, file } of ROUTES) {
      const unexpected = [...new Set(queryChains(file).map((c) => c.table))].filter(
        (t) => !allowed.has(t),
      );
      expect(
        unexpected,
        `${name} now queries ${unexpected.join(", ")}, which is outside the e-sign\n` +
          "  surface. On a route with no caller authentication, a widened table list is a\n" +
          "  widened blast radius — check what it does before adding it to the list.",
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// LAYER 3 — the arithmetic. Small, but it is the arithmetic that decides how
// hard these routes hit BoldSign's 50-sends-an-hour ceiling.
//
// EXPECTED is a hand-typed literal. ACTUAL is the shipped expression, lifted
// out of the route's source and executed. A test that computed its expectation
// with the same expression would compare the code to itself.
// ===========================================================================
describe("boldsign/routes — arithmetic (Layer 3)", () => {
  /** Lift `const NAME = <expr>;` out of a route and run it. */
  function liftConst(file: string, name: string): number {
    const src = readRoute(file);
    const m = new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`).exec(src);
    if (!m) {
      throw new Error(
        `No \`const ${name} = …\` in ${file}.\n` +
          `  The constant was renamed or inlined. This test throws rather than assuming\n` +
          `  a default, because a defaulted value would make the assertion below pass\n` +
          `  against a number the route does not use.`,
      );
    }
    const value = new Function(`return (${m[1]});`)() as number;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`\`${name}\` in ${file} did not evaluate to a finite number: ${String(value)}`);
    }
    return value;
  }

  it("the status route's properties cache holds for sixty seconds, to the millisecond", () => {
    // Hand-typed. 60 seconds in milliseconds.
    const EXPECTED_TTL_MS = 60_000;

    expect(
      liftConst(STATUS, "PROPERTIES_CACHE_TTL_MS"),
      "The /api/esign/status properties cache TTL is no longer 60s.\n" +
        "  It exists to absorb click-spam on the 'check status' button against\n" +
        "  BoldSign's 50-calls-an-hour ceiling — the same ceiling sends compete for. A\n" +
        "  shorter window burns quota that agreements need; a much longer one makes a\n" +
        "  freshly signed agreement look outstanding for that long.",
    ).toBe(EXPECTED_TTL_MS);

    // And the expiry predicate itself, executed. `Date.now() > entry.expiresAt`
    // is exclusive, so an entry at exactly the TTL is still fresh — a boundary
    // worth pinning because flipping it to `>=` is a one-character change.
    const src = readRoute(STATUS);
    const predicate = /if\s*\(\s*(Date\.now\(\)\s*[<>=]+\s*entry\.expiresAt)\s*\)/.exec(src);
    expect(
      predicate,
      "The cache-expiry comparison in getCachedProperties has changed shape and can no\n" +
        "  longer be lifted. Teach this test the new form rather than dropping it.",
    ).toBeTruthy();
    const isStale = new Function("now", "entry", `return (${predicate![1].replace("Date.now()", "now")});`) as (
      now: number,
      entry: { expiresAt: number },
    ) => boolean;

    const storedAt = 1_000_000;
    const expiresAt = storedAt + EXPECTED_TTL_MS;
    // Hand-typed boundaries, in milliseconds since `storedAt`.
    expect(isStale(storedAt + 59_999, { expiresAt }), "an entry 59.999s old is being evicted early").toBe(false);
    expect(isStale(storedAt + 60_000, { expiresAt }), "an entry at exactly 60s is being evicted").toBe(false);
    expect(isStale(storedAt + 60_001, { expiresAt }), "an entry 60.001s old is being served stale").toBe(true);
  });

  it("a rate-limited send waits 15s then 30s, and gives up after three attempts", () => {
    const src = readRoute(SEND);

    const retriesM = /const\s+maxSendRetries\s*=\s*([^;]+);/.exec(src);
    expect(retriesM, "maxSendRetries is gone from the send loop").toBeTruthy();
    const maxSendRetries = new Function(`return (${retriesM![1]});`)() as number;

    const backoffM = /const\s+waitSec\s*=\s*([^;]+);/.exec(src);
    expect(
      backoffM,
      "The 429 backoff is no longer a `const waitSec = …`. Re-anchor this test on the\n" +
        "  new shape — the numbers matter: BoldSign's limit is 50 sends an hour and the\n" +
        "  operator is watching a spinner for however long this adds up to.",
    ).toBeTruthy();
    const waitFor = new Function("sendAttempt", `return (${backoffM![1]});`) as (n: number) => number;

    // Hand-typed, from the shipped policy: three attempts, waits between them.
    expect(maxSendRetries, "the send no longer gives up after three attempts").toBe(3);
    expect(waitFor(1), "the first 429 backoff is no longer 15s").toBe(15);
    expect(waitFor(2), "the second 429 backoff is no longer 30s").toBe(30);

    // Only attempts 1..maxSendRetries-1 wait; the last attempt breaks out.
    const totalWaitSec = Array.from({ length: maxSendRetries - 1 }, (_, i) => waitFor(i + 1)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(
      totalWaitSec,
      "The worst-case wait an operator sits through on a rate-limited send has changed.\n" +
        "  45s was the deliberate ceiling; a Next route handler that blocks much longer\n" +
        "  starts colliding with the platform's function timeout, and the send is then\n" +
        "  lost after the credits have already been deducted.",
    ).toBe(45);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// Four cases, all pure input validation: each is answered by a guard that runs
// before any BoldSign call and before any write, which is exactly why these are
// the ones that can be automated. Nothing here sends, voids, signs or downloads.
//
// They need `D247_LIVE_PORTAL_URL` — these are Next routes, so `liveCall()`
// cannot reach them — and that target inherits its own production refusal:
// any host under drive-247.com is refused outright, as is any URL mentioning
// the production Supabase ref. No override flag.
// ===========================================================================
describe("boldsign/routes — live (Layer 2)", () => {
  it("live: /api/esign/void refuses a request naming no agreement and no rental", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    const res = await portalCall("/api/esign/void", {});

    expect(
      res.status,
      "Expected 400 from /api/esign/void's identifier check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  This is the one guard standing between an empty POST and a revoke. A 200\n" +
        "  here would be far worse than a failure — it would mean the route went on\n" +
        "  with no document to void.",
    ).toBe(400);
    expect(
      String(res.json?.error ?? res.text),
      "/api/esign/void answered 400, but not with the identifier guard. The wording\n" +
        "  may have changed (failure mode (a)) — or a different validation now fires\n" +
        "  first, which is worth knowing on this route.",
    ).toMatch(/agreementId or rentalId required/i);
  });

  it("live: /api/esign/status refuses a request that resolves to no document", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    const res = await portalCall("/api/esign/status", {});

    expect(
      res.status,
      "Expected 400 from /api/esign/status when nothing resolves to a document id.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 500 here would mean the guard was reached with a thrown error instead of\n" +
        "  a refusal — failure mode (b).",
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/No document ID provided/i);
  });

  it("live: /api/esign/signing-redirect refuses a GET with no agreement id", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    const res = await portalCall("/api/esign/signing-redirect", null, { method: "GET" });

    expect(
      res.status,
      "Expected 400 from /api/esign/signing-redirect's id check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  This is the route a customer reaches from their email. A redirect or a 500\n" +
        "  on an id-less request is a customer staring at a broken page.",
    ).toBe(400);
    // Plain text on purpose — a mail client opens this, not code.
    expect(res.text).toMatch(/Missing agreement ID/i);
  });

  it("live: the operator routes reject the verbs they do not export", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    // The method contract, observed rather than parsed. Next answers 405 for a
    // verb with no exported handler; a 200 or a 400 would mean a handler exists
    // that the source-level assertion above did not see.
    const res = await portalCall("/api/esign/void", null, { method: "GET" });

    expect(
      res.status,
      "Expected 405 from GET /api/esign/void — it exports POST only.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  Anything other than 405 means a GET handler is reachable in the deployed\n" +
        "  build that is not in the source this suite reads, and a GET is followable\n" +
        "  from a link, an <img> tag or a prefetch — on a route that revokes contracts.",
    ).toBe(405);
  });
});
