"use client";

// ── Custom Domain ─────────────────────────────────────────────────────────────
//
// WHAT THIS INTEGRATION ACTUALLY IS. A tenant lives at `{slug}.drive-247.com`
// (booking site) and `{slug}.portal.drive-247.com` (this portal). Custom Domain
// lets an operator who already owns a domain — `obrental.com`, say — serve
// both from it instead: the bare domain for bookings, `portal.` in front of it
// for the portal. Four live tenants run this way today.
//
// The CODE side is already live and needs nothing from this panel: when a
// request arrives on a host that is not a platform domain, `apps/portal/src/
// proxy.ts` and `apps/booking/src/middleware.ts` look the tenant up by
// `custom_portal_domain` / `custom_booking_domain` (leading `www.` stripped) and
// route it. So writing the two columns IS the whole software change.
//
// What is NOT automated — and cannot be from a tenant's browser — is the part
// that makes the domain actually answer: adding it to our hosting, pointing its
// DNS at us and issuing the certificate. That is a manual handoff done by the
// Drive247 team once the operator has granted us DNS access. It is why this
// panel is mostly INSTRUCTIONS: the operator's only real job is to give us
// access correctly, at whichever registrar they use, and every provider does
// that differently. The steps below were checked against each provider's own
// help pages, and two of them are not what one would guess — Namecheap has a
// per-domain "Share Access" feature after all, and Wix will not let anyone
// change the nameservers on a Wix-registered domain — so do not "correct" them
// from memory.
//
// THERE IS NO STATUS COLUMN, and this panel does not pretend otherwise. The
// database knows the domain the operator asked for; it has no idea whether DNS
// has been pointed, whether the certificate exists, or whether a customer
// typing the address gets the booking site or their old website. So the chip
// never turns green on the strength of the columns alone, "go-live" is stated
// as something we confirm by email, and the only verification offered is the
// honest one — open the address and look — plus a clearly-labelled reachability
// HINT that proves nothing about who is answering. No Vercel calls, no DNS
// lookups, no SSL logic: none of that exists in the portal and none of it
// belongs in a tenant's screen.
//
// There are no test/live modes here — one pair of columns, no sandbox — so
// `isTestModeUiHidden` has nothing to hide and is deliberately not consulted.
//
// ⚠️ ISOLATION (V2_PLAN §5). Every read and write in this file goes to
// `tenants` and carries `.eq('id', tenant.id)`. `tenants` happens to have RLS
// on with an UPDATE policy scoped to the caller's own tenant, and the write
// below checks that a row actually came back — but the filter is what this
// codebase relies on, not the policy. Do not drop it.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Globe,
  Loader2,
  Mail,
  Radar,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui-v2/collapsible";

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLink,
  PanelLoading,
  PanelNote,
  PanelRow,
  PanelSection,
  StatusChip,
} from "./_kit";

/* ─────────────────────────────── constants ──────────────────────────────── */

/** The account the operator grants DNS access to. */
const DNS_ACCESS_EMAIL = "ghulam@cortek.io";
/** Where the operator tells us to start. */
const SUPPORT_EMAIL = "support@drive-247.com";
/** Quoted everywhere — keep the panel telling one story. */
const LEAD_TIME = "3–4 business days";

/**
 * Mirrors `PLATFORM_DOMAINS` in `proxy.ts` and `middleware.ts`. Those take the
 * platform branch BEFORE the custom-domain lookup, so a "custom" domain under
 * any of these would be saved and never route. Refused at the form instead.
 */
const PLATFORM_DOMAINS = ["drive-247.com", "vercel.app", "localhost"];

const PORTAL_PREFIX = "portal.";

const GODADDY_ACCESS_URL = "https://account.godaddy.com/access";
const NAMECHEAP_DOMAINS_URL = "https://ap.www.namecheap.com/domains/list/";
const WIX_DASHBOARD_URL = "https://manage.wix.com/";

/* ─────────────────────────────── helpers ────────────────────────────────── */

/**
 * What the operator typed → the bare host the proxy matches on.
 *
 * The lookup is an exact `.eq()` on the column, so anything that is not the
 * bare lowercase host — a scheme, a path, a port, a trailing dot, capitals —
 * would be saved verbatim and never match a real request. `www.` is stripped
 * because the proxy strips it from the incoming host too; storing it would
 * make `www.example.com` route and `example.com` not.
 */
function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // https://
  s = s.split(/[/?#]/)[0]; // /path ?query #hash
  s = s.split("@").pop() ?? ""; // user@ (never legitimate, but harmless to drop)
  s = s.split(":")[0]; // :port
  s = s.replace(/\.+$/, ""); // trailing dot
  if (s.startsWith("www.")) s = s.slice(4);
  return s;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A plain-English reason the domain cannot be used, or null when it can. */
function validateDomain(domain: string): string | null {
  if (!domain) return null;
  if (domain.length > 253) return "That is too long to be a domain name.";
  const labels = domain.split(".");
  if (labels.length < 2) return "Include the ending — example.com, not just example.";
  if (!labels.every((l) => LABEL.test(l))) {
    return "That does not look like a domain name. Enter it like example.com.";
  }
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) {
    return "The ending does not look right — it should be letters, like .com or .net.";
  }
  if (domain.startsWith(PORTAL_PREFIX)) {
    return "Enter the main domain only. We add portal. in front of it for you.";
  }
  if (PLATFORM_DOMAINS.some((p) => domain === p || domain.endsWith("." + p))) {
    return "That is a Drive247 address. A custom domain has to be one you own, like example.com.";
  }
  return null;
}

const portalDomainFor = (domain: string) => `${PORTAL_PREFIX}${domain}`;
const platformBookingHost = (slug: string) => `${slug}.drive-247.com`;
const platformPortalHost = (slug: string) => `${slug}.portal.drive-247.com`;

function supportMailto(
  company: string,
  booking: string | null,
  portal: string | null,
  provider: string,
): string {
  const subject = `Custom domain setup — ${company}`;
  const body = [
    "Hi Drive247,",
    "",
    "Please set up my custom domain.",
    "",
    `Booking site: ${booking ?? "(not saved in the portal yet)"}`,
    `Portal: ${portal ?? "(not saved in the portal yet)"}`,
    `Domain provider: ${provider}`,
    `DNS access granted to ${DNS_ACCESS_EMAIL}: yes / not yet`,
    "",
    "Thanks,",
    company,
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ─────────────────────────────── data ───────────────────────────────────── */

const domainsKey = (tenantId: string) => ["custom-domain-panel", tenantId] as const;

type Domains = { booking: string | null; portal: string | null };

/**
 * The two columns, straight from `tenants`.
 *
 * Fetched here rather than read off `useTenant()`: the portal's TenantContext
 * does not select these columns (it loads ~7 admin fields), and widening its
 * column list is a change to a shared v1 file that seven panels would then be
 * contending over. One small select by id, cached for a minute, is cheap enough
 * for the board to paint a chip from.
 */
function useCustomDomains(tenant: PanelTenant) {
  return useQuery({
    queryKey: domainsKey(tenant.id),
    queryFn: async (): Promise<Domains> => {
      const { data, error } = await supabase
        .from("tenants")
        .select("custom_booking_domain, custom_portal_domain")
        .eq("id", tenant.id) // ← isolation
        .maybeSingle();

      if (error) throw error;
      // A tenant that does not resolve is a failed read, not "no domain".
      // Throwing routes it to PanelError instead of offering the request form
      // over a row that may well already carry a live domain.
      if (!data) throw new Error("Tenant row not found");

      return {
        booking: data.custom_booking_domain ?? null,
        portal: data.custom_portal_domain ?? null,
      };
    },
    staleTime: 60_000,
  });
}

/**
 * The one write. Both columns always move together: the proxy routes the
 * booking site off one and the portal off the other, and a tenant with only
 * one set would have half a website.
 *
 * `.select()` after the update is not decoration. `tenants` has RLS on with an
 * UPDATE policy of `id = get_user_tenant_id()`; a caller the policy rejects
 * gets zero rows and NO error, which would otherwise toast "saved" over a row
 * that did not change. An empty result is therefore treated as a failure.
 */
function useWriteDomains(tenant: PanelTenant) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: Domains): Promise<Domains> => {
      const { data, error } = await supabase
        .from("tenants")
        .update({ custom_booking_domain: next.booking, custom_portal_domain: next.portal })
        .eq("id", tenant.id) // ← isolation
        .select("custom_booking_domain, custom_portal_domain")
        .maybeSingle();

      if (error) {
        // Both columns are UNIQUE across all tenants. 23505 is the only way an
        // operator can hit that, and the raw message names a constraint and a
        // key they have never heard of.
        if ((error as { code?: string }).code === "23505") {
          throw new Error(
            `That domain is already registered to another Drive247 account. If you own it and believe this is a mistake, email ${SUPPORT_EMAIL}.`,
          );
        }
        throw error;
      }
      if (!data) {
        throw new Error(
          "Nothing was saved. Your login may not have permission to change this account's settings.",
        );
      }
      return {
        booking: data.custom_booking_domain ?? null,
        portal: data.custom_portal_domain ?? null,
      };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(domainsKey(tenant.id), saved);
      queryClient.invalidateQueries({ queryKey: domainsKey(tenant.id) });
    },
  });
}

type Reach = "reachable" | "unreachable";

/**
 * A HINT, and labelled as one everywhere it is shown.
 *
 * A `no-cors` HEAD to the domain returns an opaque response: it resolves if
 * *anything* answered at that name and rejects if nothing did (unresolved DNS,
 * refused connection, bad certificate, or the 8s timeout). It cannot see what
 * answered — the operator's old website "reaches" just as well as we do — and
 * it cannot tell a certificate error from a DNS miss. So it is offered on
 * request only, never on open, never drives the chip, and never blocks
 * anything. The real test is the "Open" link beside it.
 */
function useReachability() {
  return useMutation({
    mutationFn: async (domain: string): Promise<Reach> => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8_000);
      try {
        await fetch(`https://${domain}/`, {
          mode: "no-cors",
          method: "HEAD",
          cache: "no-store",
          signal: ctl.signal,
        });
        return "reachable";
      } catch {
        return "unreachable";
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/* ─────────────────────────────── chip ───────────────────────────────────── */

/**
 * Board chip.
 *
 * Says only what the database can vouch for. "Domain set" is true the moment
 * the columns are written — routing for that host is live in the proxy — but
 * whether DNS points here is unknowable from this side, so the chip stays amber
 * with "unverified" rather than turning green and sending an operator to hand
 * out an address that still shows their old site. That is honest even for a
 * tenant whose domain has been live for months; the panel says how to check.
 */
export function CustomDomainStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useCustomDomains(tenant);

  // A failed read is not "not requested" — that would offer the request form
  // over a row that may already carry a live domain (_kit's rule).
  if (isError) return <StatusChip state="attention" label="Status unknown" />;
  if (isLoading || !data) return <StatusChip state="loading" />;
  if (!data.booking && !data.portal) return <StatusChip state="disconnected" label="Not requested" />;
  // Only a hand edit to the row can produce this; the proxy would then route
  // one surface and not the other.
  if (!data.booking || !data.portal) return <StatusChip state="attention" label="Partly set" />;
  return <StatusChip state="attention" label="Domain set · unverified" />;
}

/* ─────────────────────────────── panel ──────────────────────────────────── */

export default function CustomDomainPanel({ tenant }: IntegrationPanelProps) {
  // Requesting, changing and removing all rewrite what host this tenant
  // answers on — removal takes a live domain out of routing at once — so the
  // writes are held to the same admin/head-admin bar the other panels use for
  // their destructive controls. Everyone can read the instructions.
  const { isAdmin } = useAuth();
  const canManage = isAdmin();

  const domains = useCustomDomains(tenant);

  if (domains.isLoading) return <PanelLoading rows={4} />;
  if (domains.isError) {
    return (
      <PanelError
        message={(domains.error as Error)?.message ?? "Unknown error"}
        onRetry={() => domains.refetch()}
      />
    );
  }

  const current = domains.data!;
  const requested = !!(current.booking || current.portal);

  return requested ? (
    <RequestedPanel tenant={tenant} current={current} canManage={canManage} />
  ) : (
    <RequestPanel tenant={tenant} canManage={canManage} />
  );
}

/* ─────────────────────────── not requested yet ──────────────────────────── */

/**
 * Northwind is here today: both columns null.
 *
 * The draft domain is held HERE rather than inside the form so the handoff
 * instructions further down can put it in the support email before it has
 * even been saved — an operator who reads the GoDaddy steps first and emails
 * us second should not have to type the domain twice.
 */
function RequestPanel({ tenant, canManage }: { tenant: PanelTenant; canManage: boolean }) {
  const [draft, setDraft] = useState("");
  const domain = normalizeDomain(draft);
  const problem = validateDomain(domain);
  const previewOk = !!domain && !problem;

  return (
    <div className="space-y-5">
      <PanelNote>
        Today your booking site is at{" "}
        <span className="font-mono text-foreground">{platformBookingHost(tenant.slug)}</span> and
        this portal at{" "}
        <span className="font-mono text-foreground">{platformPortalHost(tenant.slug)}</span>. A
        custom domain puts both on a domain you own — <span className="font-mono">example.com</span>{" "}
        for bookings, <span className="font-mono">portal.example.com</span> for the portal. The
        Drive247 addresses keep working alongside it.
      </PanelNote>

      <PanelSection title="How it works" description="Three parts. Only the first is yours to type.">
        <PanelCard className="space-y-2.5 py-3">
          <Step n={1}>
            Tell us the domain below. You must <span className="text-foreground">already own it</span>{" "}
            — we do not register domains.
          </Step>
          <Step n={2}>
            Give us access to its DNS, following the steps for your provider further down, then
            email support so we know to start.
          </Step>
          <Step n={3}>
            We add the domain to our hosting, point its DNS at us and issue the certificate. Expect
            it live within <span className="text-foreground">{LEAD_TIME}</span> of access being
            granted; we email you when it is.
          </Step>
        </PanelCard>
      </PanelSection>

      {!canManage && (
        <PanelNote>
          Requesting a domain needs an admin or head admin account. The setup instructions below
          are still yours to read.
        </PanelNote>
      )}

      <DomainForm
        tenant={tenant}
        current={null}
        draft={draft}
        onDraftChange={setDraft}
        canManage={canManage}
      />

      <PanelSection
        title="Giving us DNS access"
        description="Pick your provider. The steps grant access only — we add the records ourselves."
      >
        <HandoffInstructions
          company={tenant.company_name || tenant.slug}
          booking={previewOk ? domain : null}
          portal={previewOk ? portalDomainFor(domain) : null}
        />
      </PanelSection>
    </div>
  );
}

/* ───────────────────────────── requested ────────────────────────────────── */

function RequestedPanel({
  tenant,
  current,
  canManage,
}: {
  tenant: PanelTenant;
  current: Domains;
  canManage: boolean;
}) {
  const write = useWriteDomains(tenant);
  const reach = useReachability();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [changeDraft, setChangeDraft] = useState(current.booking ?? "");

  // The booking domain is the one customers are given; it is what the hint
  // and the "Open" link test. The portal domain is derived and rides with it.
  const booking = current.booking ?? current.portal!;

  return (
    <div className="space-y-5">
      {!canManage && (
        <PanelNote>
          You can see this domain but not change it — that needs an admin or head admin account.
        </PanelNote>
      )}

      {/* ── the domains ── */}
      <PanelSection
        title="Your domains"
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={reach.isPending}
            title="A quick hint at whether anything answers at this address"
            onClick={() => reach.mutate(booking)}
          >
            {reach.isPending ? <Loader2 className="animate-spin" /> : <Radar />}
            Check
          </Button>
        }
      >
        <PanelCard className="divide-y">
          <PanelRow label="Booking site" hint="Also answers with www. in front once live." mono>
            {current.booking ? (
              <CopyValue value={current.booking} />
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </PanelRow>
          <PanelRow label="Portal" mono>
            {current.portal ? (
              <CopyValue value={current.portal} />
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </PanelRow>
          <PanelRow label="Go-live" hint="Confirmed by email from us, not by this screen.">
            <span className="text-warning">Not verified here</span>
          </PanelRow>
        </PanelCard>

        {(!current.booking || !current.portal) && (
          <PanelNote tone="warn">
            Only one of the two addresses is set, so only that half would route. Use{" "}
            <span className="text-foreground">Change domain</span> below to set both from one
            domain.
          </PanelNote>
        )}

        <PanelNote>
          This screen knows the domain you asked for; it cannot see whether DNS and hosting are
          done. Until they are, the addresses above do nothing, and{" "}
          <span className="font-mono text-foreground">{platformBookingHost(tenant.slug)}</span>{" "}
          keeps serving your customers throughout.
        </PanelNote>

        {/* Both verdicts are hedged on purpose — see useReachability. */}
        {reach.data === "reachable" && (
          <PanelNote>
            <span className="font-medium text-foreground">Hint:</span> something answers at{" "}
            <span className="font-mono">https://{booking}</span> — but that could be your existing
            website. Only opening it tells you whether it is Drive247 yet.
          </PanelNote>
        )}
        {reach.data === "unreachable" && (
          <PanelNote>
            <span className="font-medium text-foreground">Hint:</span> nothing answered at{" "}
            <span className="font-mono">https://{booking}</span> just now. Usually that means DNS is
            not pointed at us yet, or changed in the last day and has not spread. Not a fault on
            your side if you have only just granted access.
          </PanelNote>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <PanelLink href={`https://${booking}`}>Open {booking}</PanelLink>
          <span className="text-[11px] text-muted-foreground/70">
            The one real test: if your booking site loads there, it is live.
          </span>
        </div>
      </PanelSection>

      {/* Operators come back to re-read these — that is the reason the block
          exists in this state at all — but they have already read them once,
          so collapsed by default. */}
      <Disclosure label="Setup instructions — giving us DNS access">
        <HandoffInstructions
          company={tenant.company_name || tenant.slug}
          booking={current.booking}
          portal={current.portal}
        />
      </Disclosure>

      <Disclosure label="Change domain">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Saving a different domain swaps routing at once: the current addresses stop answering
          here the moment you save, and the new one needs DNS access and our setup again — another{" "}
          {LEAD_TIME}.
        </p>
        <DomainForm
          tenant={tenant}
          current={current}
          draft={changeDraft}
          onDraftChange={setChangeDraft}
          canManage={canManage}
        />
      </Disclosure>

      {/* ── remove ── */}
      <PanelSection title="Remove">
        {confirmRemove ? (
          <div className="space-y-2.5">
            {/* `danger`, not `warn`: putting the domain back does not undo the
                outage in between, and the people who hit it are customers. */}
            <PanelNote tone="danger">
              <AlertTriangle className="mr-1.5 inline size-3.5 -translate-y-px" />
              Removal takes{" "}
              <span className="font-mono">{current.booking ?? "the booking domain"}</span> and{" "}
              <span className="font-mono">{current.portal ?? "the portal domain"}</span> out of
              routing <strong>immediately</strong>. Anyone whose DNS still points at us — including
              customers with the address bookmarked — sees an error page instead of your site until
              you either add the domain back here or move your DNS away. Your{" "}
              <span className="font-mono">{platformBookingHost(tenant.slug)}</span> addresses are
              not affected.
            </PanelNote>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate(
                    { booking: null, portal: null },
                    {
                      onSuccess: () => {
                        setConfirmRemove(false);
                        toast({
                          title: "Custom domain removed",
                          description: `Your site answers only at ${platformBookingHost(tenant.slug)} again.`,
                        });
                      },
                      onError: (err) =>
                        toast({
                          title: "Could not remove the domain",
                          description: (err as Error)?.message,
                          variant: "destructive",
                        }),
                    },
                  )
                }
              >
                {write.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Yes, remove it
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 />
            Remove custom domain
          </Button>
        )}
      </PanelSection>
    </div>
  );
}

/* ───────────────────────────── the form ─────────────────────────────────── */

/**
 * One input, both columns. The operator types the domain they own; the portal
 * address is derived and shown, never typed — a mistyped `portal.` host is
 * the kind of error nobody notices until they cannot log in.
 *
 * With `current` set this is the Change path, and the first click asks for
 * confirmation, because the old domain leaves routing the moment the row is
 * written (see RequestedPanel). The first-time request needs no such step:
 * nothing is live yet, so nothing can break.
 */
function DomainForm({
  tenant,
  current,
  draft,
  onDraftChange,
  canManage,
}: {
  tenant: PanelTenant;
  current: Domains | null;
  draft: string;
  onDraftChange: (v: string) => void;
  canManage: boolean;
}) {
  const write = useWriteDomains(tenant);
  const [confirmChange, setConfirmChange] = useState(false);

  const domain = normalizeDomain(draft);
  const problem = validateDomain(domain);
  const portal = domain ? portalDomainFor(domain) : "";
  const unchanged = !!current && domain === (current.booking ?? "") && portal === (current.portal ?? "");
  const ready = !!domain && !problem && !unchanged;
  const isChange = !!current;

  const save = () =>
    write.mutate(
      { booking: domain, portal },
      {
        onSuccess: () => {
          setConfirmChange(false);
          toast({
            title: isChange ? "Domain changed" : "Domain requested",
            description: isChange
              ? `${domain} is saved. Grant us DNS access for it and email support to start the ${LEAD_TIME} setup.`
              : `Next: give us DNS access at your provider and email ${SUPPORT_EMAIL}. Live within ${LEAD_TIME} of that.`,
          });
        },
      },
    );

  return (
    <PanelSection title={isChange ? undefined : "Request a custom domain"}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="custom-domain-input" className="text-xs text-muted-foreground">
            The domain you own
          </Label>
          <Input
            id="custom-domain-input"
            value={draft}
            onChange={(e) => {
              onDraftChange(e.target.value);
              setConfirmChange(false);
            }}
            placeholder="example.com"
            className="font-mono text-[13px]"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={!canManage || write.isPending}
            aria-invalid={!!problem || undefined}
          />
          <p
            className={`text-[11px] leading-snug ${problem ? "text-warning" : "text-muted-foreground/70"}`}
          >
            {problem ?? "Just the domain — no https://, no www. We tidy those up if you paste them."}
          </p>
        </div>

        {/* Live preview of exactly what will be written. */}
        <PanelCard className="divide-y">
          <PanelRow label="Booking site" mono>
            {domain && !problem ? (
              domain
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </PanelRow>
          <PanelRow label="Portal" mono hint="Derived from the domain above.">
            {domain && !problem ? (
              portal
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </PanelRow>
        </PanelCard>

        {write.isError && (
          <PanelNote tone="warn">
            Nothing was changed.
            <span className="mt-1 block opacity-90">{(write.error as Error)?.message}</span>
          </PanelNote>
        )}

        {isChange && confirmChange ? (
          <div className="space-y-2.5">
            <PanelNote tone="warn">
              <span className="font-mono">{current!.booking}</span> and{" "}
              <span className="font-mono">{current!.portal}</span> stop answering here as soon as
              you save. <span className="font-mono">{domain}</span> will not work until its DNS is
              pointed at us and we finish setup.
            </PanelNote>
            <div className="flex gap-2">
              <Button size="sm" disabled={write.isPending} onClick={save}>
                {write.isPending && <Loader2 className="animate-spin" />}
                Yes, change it
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className={isChange ? undefined : "w-full"}
            size={isChange ? "sm" : "default"}
            disabled={!ready || !canManage || write.isPending}
            title={unchanged ? "This is already your domain" : undefined}
            onClick={() => (isChange ? setConfirmChange(true) : save())}
          >
            {write.isPending ? <Loader2 className="animate-spin" /> : <Globe />}
            {isChange ? "Save new domain" : "Request this domain"}
          </Button>
        )}
      </div>
    </PanelSection>
  );
}

/* ─────────────────────── handoff instructions ───────────────────────────── */

type Provider = "GoDaddy" | "Namecheap" | "Wix" | "Other";

/**
 * The heart of the panel. Each tab grants us access at one provider and ends
 * with the same two facts. The steps are what each provider's own help pages
 * say today, not folklore:
 *
 *  - GoDaddy's delegate levels are "Products, Domains, & Purchases",
 *    "Products & Domains", "Domains Only" and "Accounts Connection Only". DNS
 *    needs "Domains Only" with Management access — the purchase level would let
 *    us spend on the operator's card and is refused here on purpose.
 *  - Namecheap DOES delegate: Domain List → Manage → Sharing & Transfer →
 *    Share Access, per domain, to another Namecheap account. The fallback for
 *    an operator who cannot use it is to add the records we send.
 *  - Wix does NOT allow nameserver changes on a Wix-registered domain, so the
 *    only paths are a Domain Manager collaborator or hand-applied records.
 */
function HandoffInstructions({
  company,
  booking,
  portal,
}: {
  company: string;
  booking: string | null;
  portal: string | null;
}) {
  const [provider, setProvider] = useState<Provider>("GoDaddy");
  const footer = <HandoffFooter company={company} booking={booking} portal={portal} provider={provider} />;

  return (
    <Tabs value={provider} onValueChange={(v) => setProvider(v as Provider)}>
      <TabsList className="w-full">
        <TabsTrigger value="GoDaddy">GoDaddy</TabsTrigger>
        <TabsTrigger value="Namecheap">Namecheap</TabsTrigger>
        <TabsTrigger value="Wix">Wix</TabsTrigger>
        <TabsTrigger value="Other">Other</TabsTrigger>
      </TabsList>

      {/* ── GoDaddy — delegate access ── */}
      <TabsContent value="GoDaddy" className="space-y-3 pt-1">
        <p className="text-xs leading-relaxed text-muted-foreground">
          GoDaddy lets you add a <span className="text-foreground">delegate</span> who can manage
          your domains without seeing your password or payment details.
        </p>
        <PanelCard className="space-y-2.5 py-3">
          <Step n={1}>
            Sign in and open <PanelLink href={GODADDY_ACCESS_URL}>Delegate Access</PanelLink>{" "}
            (Account &rarr; Account Settings &rarr; Delegate Access).
          </Step>
          <Step n={2}>
            Under <span className="text-foreground">People who can access my account</span>, click{" "}
            <span className="text-foreground">Invite to Access</span>.
          </Step>
          <Step n={3}>
            Name: <span className="text-foreground">Drive247</span>. Email:{" "}
            <span className="font-mono text-foreground">{DNS_ACCESS_EMAIL}</span>.
          </Step>
          <Step n={4}>
            Access level: <span className="text-foreground">Domains Only</span>. That covers DNS and
            nameservers. Do not pick &ldquo;Products, Domains, &amp; Purchases&rdquo; — it lets a
            delegate buy things on your saved card, which we do not need.
          </Step>
          <Step n={5}>
            Click <span className="text-foreground">Invite</span>. We accept from our GoDaddy
            account. The invitation lapses after a few days, so send the email in the next step
            straight away.
          </Step>
          <Step n={6}>
            If your domains sit in a folder with its own delegate permissions, make sure{" "}
            <span className="text-foreground">Management Access</span> is on for the folder
            (Domain Portfolio &rarr; folder settings). Transfer Access is not needed.
          </Step>
        </PanelCard>
        {footer}
      </TabsContent>

      {/* ── Namecheap — Share Access ── */}
      <TabsContent value="Namecheap" className="space-y-3 pt-1">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Namecheap shares access <span className="text-foreground">per domain</span> to another
          Namecheap account, and you choose what the other account may edit.
        </p>
        <PanelCard className="space-y-2.5 py-3">
          <Step n={1}>
            Sign in and open <PanelLink href={NAMECHEAP_DOMAINS_URL}>Domain List</PanelLink>, then
            click <span className="text-foreground">Manage</span> next to your domain.
          </Step>
          <Step n={2}>
            Open the <span className="text-foreground">Sharing &amp; Transfer</span> tab and find{" "}
            <span className="text-foreground">Share Access</span>.
          </Step>
          <Step n={3}>
            In <span className="text-foreground">New Manager</span>, enter{" "}
            <span className="font-mono text-foreground">{DNS_ACCESS_EMAIL}</span> and click{" "}
            <span className="text-foreground">Add</span>.
          </Step>
          <Step n={4}>
            Tick the rights that cover <span className="text-foreground">DNS / host records</span>{" "}
            and <span className="text-foreground">nameservers</span>. Contact and transfer rights
            are not needed. Enter your account password and click{" "}
            <span className="text-foreground">Done</span>.
          </Step>
          <Step n={5}>
            Namecheap emails us a confirmation link, valid for 7 days. We accept it.
          </Step>
        </PanelCard>
        <PanelNote>
          Share Access only works between Namecheap accounts. If Namecheap does not recognise that
          email, or you would rather not share, email us anyway: we send you the exact records to
          add under <span className="text-foreground">Advanced DNS</span> on the same Manage page
          — a two-minute job — or, if your plan needs it, nameservers to set under{" "}
          <span className="text-foreground">Nameservers &rarr; Custom DNS</span>.
        </PanelNote>
        {footer}
      </TabsContent>

      {/* ── Wix — collaborator with Domain Manager role ── */}
      <TabsContent value="Wix" className="space-y-3 pt-1">
        <p className="text-xs leading-relaxed text-muted-foreground">
          If your domain was bought from Wix, or is connected to Wix by name servers, its DNS
          lives in your Wix account. Wix does not allow the nameservers on a Wix domain to be
          changed, so access is granted by adding us as a collaborator.
        </p>
        <PanelCard className="space-y-2.5 py-3">
          <Step n={1}>
            Open your site&rsquo;s <PanelLink href={WIX_DASHBOARD_URL}>Wix dashboard</PanelLink>{" "}
            and go to <span className="text-foreground">Settings &rarr; Roles &amp; Permissions</span>.
          </Step>
          <Step n={2}>
            Click <span className="text-foreground">Invite Collaborators</span>.
          </Step>
          <Step n={3}>
            In <span className="text-foreground">Emails</span>, enter{" "}
            <span className="font-mono text-foreground">{DNS_ACCESS_EMAIL}</span>.
          </Step>
          <Step n={4}>
            Tick the role <span className="text-foreground">Domain Manager</span> — it can connect
            and manage domains and cannot buy anything or edit your site. Nothing broader is
            needed.
          </Step>
          <Step n={5}>
            Click <span className="text-foreground">Send Invites</span>. We accept from a Wix login
            under that email.
          </Step>
        </PanelCard>
        <PanelNote>
          Prefer not to add a collaborator? Email us and we send the records to add yourself under{" "}
          <span className="text-foreground">Domains &rarr; Domain Actions &rarr; Manage DNS records</span>{" "}
          in your Wix account. And if your domain was bought elsewhere and only{" "}
          <em>pointed</em> at Wix, its DNS is at that registrar — use that provider&rsquo;s tab
          instead.
        </PanelNote>
        {footer}
      </TabsContent>

      {/* ── everything else ── */}
      <TabsContent value="Other" className="space-y-3 pt-1">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cloudflare, Squarespace, Google, Hover, IONOS, Bluehost, 1&amp;1, a web agency — the
          shape is always the same.
        </p>
        <PanelCard className="space-y-2.5 py-3">
          <Step n={1}>
            Log in wherever the domain is registered — or, if its DNS is hosted somewhere else
            (Cloudflare is the usual case), log in there instead.
          </Step>
          <Step n={2}>
            Find the section called <span className="text-foreground">DNS Management</span>,{" "}
            <span className="text-foreground">DNS Settings</span>,{" "}
            <span className="text-foreground">Zone Editor</span> or{" "}
            <span className="text-foreground">Nameservers</span>.
          </Step>
          <Step n={3}>
            If the provider can invite another person — called delegate, collaborator, member,
            sub-user or team access — invite{" "}
            <span className="font-mono text-foreground">{DNS_ACCESS_EMAIL}</span> with rights to
            edit DNS records. Nothing more.
          </Step>
          <Step n={4}>
            If there is no way to invite anyone, that is fine: say so in your email and we send
            the exact records to add yourself — one for{" "}
            <span className="font-mono text-foreground">{booking ?? "your domain"}</span>, one for{" "}
            <span className="font-mono text-foreground">{portal ?? "portal.your-domain"}</span>.
          </Step>
        </PanelCard>
        {footer}
      </TabsContent>
    </Tabs>
  );
}

/** The two facts every tab ends on. Same block, same words, whichever provider. */
function HandoffFooter({
  company,
  booking,
  portal,
  provider,
}: {
  company: string;
  booking: string | null;
  portal: string | null;
  provider: Provider;
}) {
  return (
    <PanelCard className="space-y-3 py-3">
      <div>
        <p className="text-[11px] text-muted-foreground">Grant DNS access to</p>
        <CopyValue value={DNS_ACCESS_EMAIL} className="mt-0.5 -ml-1" />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">
          Then email us your domain name and the provider you use
        </p>
        <CopyValue value={SUPPORT_EMAIL} className="mt-0.5 -ml-1" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        We take it from there. Expect it live within{" "}
        <span className="text-foreground">{LEAD_TIME}</span> of access being granted; we email you
        when it is.
      </p>
      <Button variant="outline" size="sm" asChild>
        <a href={supportMailto(company, booking, portal, provider)}>
          <Mail />
          Email support
        </a>
      </Button>
    </PanelCard>
  );
}

/* ────────────────────────────── small pieces ────────────────────────────── */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * A collapsed block for what an operator needs rarely, in a narrow dialog.
 *
 * `children` is typed against the UMD `React` global on purpose: two copies of
 * `@types/react` resolve here and Radix's `CollapsibleContent` is compiled
 * against the other one, so an imported `ReactNode` alias is rejected where the
 * global is accepted. Same clash, same fix as `twilio-messages.tsx`.
 */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/40">
        {label}
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
