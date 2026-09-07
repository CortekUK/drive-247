"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Playground · customer control centre — STANDING
 *
 * The second band of the rail: what has been DECIDED about this person.
 * Verification is produced from the first band, so it can fall behind it and
 * says so itself. Account and Consent are decisions in their own right — they
 * cannot be stale, but they are the two panels where a wrong click costs the
 * most, so both are built to make the blast radius impossible to misread.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  BadgeCheck,
  Check,
  Clock,
  Globe,
  Link2,
  Mail,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  ScanFace,
  Send,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  ActionButton,
  EmptyHint,
  Field,
  OptionCard,
  OutOfDateBanner,
  Panel,
  Pill,
  Timeline,
  fmtDate,
  inputCls,
  textareaCls,
} from "@/app/playground/_shared";
import type { Drift } from "@/app/playground/_shared";
import { TODAY } from "./_data";
import type { CustomerState, GlobalBlock, PanelProps } from "./_data";
import { DangerSection, Row, Section, Segmented, Thumb, Toggle, addressOf, listCls } from "./_bits";

/* ══════════════════════════════════════════════════════════════════════════
   Verification
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the verdict promised, against what the record says now.
 *
 * In production this needs NO new column and no snapshot of our own:
 * `identity_verifications` already stores document_number, document_expiry_date,
 * first_name, last_name, date_of_birth and address as the provider read them at
 * the moment it decided. Those six ARE the snapshot. This function is the whole
 * mechanism behind the amber banner.
 */
export function verificationDrift(c: CustomerState): Drift[] {
  const ex = c.ai.extracted;
  if (c.ai.state !== "passed" || !ex) return [];

  const [first = "", ...rest] = c.identity.name.trim().split(/\s+/);
  const last = rest.join(" ");
  const address = addressOf(c.identity);

  // Values stay SHORT — the banner strikes the "was" through, and a struck-out
  // sentence is unreadable.
  const out: Drift[] = [];
  const cmp = (label: string, was: string, now: string) => {
    if (was.trim() !== now.trim()) out.push({ label, was: was || "—", now: now || "not set" });
  };

  cmp("Licence number", ex.documentNumber, c.licence.number);
  cmp("Licence expiry", fmtDate(ex.documentExpiry), fmtDate(c.licence.expiry));
  cmp("First name", ex.firstName, first);
  cmp("Last name", ex.lastName, last);
  cmp("Date of birth", fmtDate(ex.dob), fmtDate(c.identity.dob));
  cmp("Address", ex.address, address);
  return out;
}

const CMD_TONE = {
  none: "neutral",
  awaiting: "primary",
  valid: "success",
  invalid: "warning",
  expired: "warning",
} as const;

const CMD_WORD = {
  none: "Not started",
  awaiting: "Waiting on the customer",
  valid: "Licence valid",
  invalid: "Licence not valid",
  expired: "Link expired",
} as const;

const CHANNEL_ICON = { email: Mail, sms: MessageSquare, whatsapp: Smartphone } as const;

export function VerificationPanel({
  c,
  patch,
  onJump,
  drift,
}: PanelProps & { drift: Drift[] }) {
  const [provider, setProvider] = useState<"ai" | "cmd">("ai");
  const stale = drift.length > 0;

  /**
   * Re-issuing takes the snapshot from the state being written, not from the
   * render closure: the snapshot IS the promise the verdict makes, so it has to
   * record what was actually true at the moment it was issued.
   */
  const reissue = () =>
    patch((p) => {
      const [first = "", ...rest] = p.identity.name.trim().split(/\s+/);
      return {
        ...p,
        ai: {
          ...p.ai,
          state: "passed",
          completedAt: TODAY,
          extracted: {
            documentNumber: p.licence.number,
            documentExpiry: p.licence.expiry,
            firstName: first,
            lastName: rest.join(" "),
            dob: p.identity.dob,
            address: addressOf(p.identity),
          },
        },
      };
    });

  /** Accepting the drift re-baselines the snapshot and nothing else — the
   *  verdict, its date and its score all stay exactly as staff last read them. */
  const acceptDrift = () =>
    patch((p) => {
      const [first = "", ...rest] = p.identity.name.trim().split(/\s+/);
      return {
        ...p,
        ai: {
          ...p.ai,
          extracted: {
            documentNumber: p.licence.number,
            documentExpiry: p.licence.expiry,
            firstName: first,
            lastName: rest.join(" "),
            dob: p.identity.dob,
            address: addressOf(p.identity),
          },
        },
      };
    });

  const setAi = (fn: (a: CustomerState["ai"]) => CustomerState["ai"]) =>
    patch((p) => ({ ...p, ai: fn(p.ai) }));
  const setCmd = (fn: (m: CustomerState["cmd"]) => CustomerState["cmd"]) =>
    patch((p) => ({ ...p, cmd: fn(p.cmd) }));

  const verdict = stale
    ? { tone: "warning" as const, icon: AlertTriangle, word: "Verified, out of date" }
    : c.ai.state === "passed"
      ? { tone: "success" as const, icon: BadgeCheck, word: "Verified" }
      : c.ai.state === "declined"
        ? { tone: "destructive" as const, icon: X, word: "Declined" }
        : c.ai.state === "pending"
          ? { tone: "primary" as const, icon: Clock, word: "In review" }
          : { tone: "muted" as const, icon: Minus, word: "Not started" };

  const ring = {
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
    destructive: "bg-destructive/10 text-destructive",
    primary: "bg-primary-light text-primary",
    muted: "bg-muted text-muted-foreground",
  } as const;

  return (
    <Panel
      title="Verification"
      description="Whether this person is who they say they are. Produced from the record — never typed in here."
    >
      <ProducedFromInline onJump={onJump} />

      {stale && (
        <OutOfDateBanner
          title="This verdict was issued against details that have since changed"
          meta={`Passed ${c.ai.completedAt ? fmtDate(c.ai.completedAt) : "earlier"} · ${drift.length} value${
            drift.length === 1 ? "" : "s"
          } no longer match`}
          drift={drift}
          primaryLabel="Re-run verification"
          onPrimary={reissue}
          secondaryLabel="Verdict still stands"
          onSecondary={acceptDrift}
        />
      )}

      {/* ── the headline verdict, above the provider split ─────────────── */}
      <Section>
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-3xl",
              ring[verdict.tone]
            )}
          >
            <verdict.icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">{verdict.word}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {c.ai.state === "none"
                ? "Nobody has checked this person's identity yet."
                : c.ai.state === "pending"
                  ? "The provider is comparing the selfie against the document."
                  : c.ai.state === "declined"
                    ? c.ai.declineReason || "The provider could not match the person to the document."
                    : stale
                      ? "The check itself passed. What it checked has since been edited."
                      : `Passed ${c.ai.completedAt ? fmtDate(c.ai.completedAt) : "earlier"} against licence ${
                          c.ai.extracted?.documentNumber || "—"
                        }.`}
            </p>
          </div>
          {c.ai.faceMatchScore !== null && c.ai.state === "passed" && (
            <div className="shrink-0 text-right">
              <p className="font-heading text-2xl font-semibold tabular-nums">{c.ai.faceMatchScore}%</p>
              <p className="text-[11px] text-muted-foreground">face match</p>
            </div>
          )}
        </div>

        <div className="mt-6">
          <Timeline
            steps={[
              {
                label: "Documents captured",
                at: `${Object.values(c.ai.photos).filter(Boolean).length} of 4 images`,
                done: Object.values(c.ai.photos).some(Boolean),
              },
              { label: "Sent to the provider", done: c.ai.state !== "none" },
              {
                label: "Verdict issued",
                at: c.ai.completedAt ? fmtDate(c.ai.completedAt) : undefined,
                done: c.ai.state === "passed" || c.ai.state === "declined",
              },
              {
                label: "Licence checked with the DMV",
                at: c.cmd.lastEventAt ? fmtDate(c.cmd.lastEventAt) : undefined,
                done: c.cmd.state === "valid" || c.cmd.state === "invalid",
              },
            ]}
          />
        </div>
      </Section>

      {/* ── the two providers ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <Segmented
          value={provider}
          onChange={setProvider}
          options={[
            {
              value: "ai",
              label: "Document & selfie",
              badge: <Pill tone={c.ai.state === "passed" ? "success" : "neutral"}>{c.ai.state === "passed" ? "Passed" : "—"}</Pill>,
            },
            {
              value: "cmd",
              label: "CheckMyDriver",
              badge: <Pill tone={CMD_TONE[c.cmd.state]}>{c.cmd.state === "valid" ? "Valid" : "—"}</Pill>,
            },
          ]}
        />
        <p className="hidden text-xs text-muted-foreground sm:block">Two checks, two verdicts.</p>
      </div>

      {provider === "ai" ? (
        <>
          <Section
            title="What the provider captured"
            description="Its own evidence, at the moment it decided. These cannot be replaced from the Documents panel."
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Thumb className="aspect-[3/4] w-full" filled={c.ai.photos.face} caption="Face" />
              <Thumb className="aspect-[3/4] w-full" filled={c.ai.photos.selfie} caption="Selfie" />
              <Thumb className="aspect-[3/4] w-full" filled={c.ai.photos.docFront} caption="Licence front" />
              <Thumb className="aspect-[3/4] w-full" filled={c.ai.photos.docBack} caption="Licence back" />
            </div>
          </Section>

          {c.ai.extracted && (
            <Section
              title="What it read, against what the record says now"
              description="Six values. Any of them moving is what turns this panel amber."
            >
              <div className={listCls}>
                <ComparisonRow label="Licence number" was={c.ai.extracted.documentNumber} now={c.licence.number} />
                <ComparisonRow
                  label="Licence expiry"
                  was={fmtDate(c.ai.extracted.documentExpiry)}
                  now={fmtDate(c.licence.expiry)}
                />
                <ComparisonRow
                  label="Name"
                  was={`${c.ai.extracted.firstName} ${c.ai.extracted.lastName}`.trim()}
                  now={c.identity.name}
                />
                <ComparisonRow label="Date of birth" was={fmtDate(c.ai.extracted.dob)} now={fmtDate(c.identity.dob)} />
                <ComparisonRow
                  label="Address"
                  was={c.ai.extracted.address}
                  now={addressOf(c.identity)}
                />
              </div>
            </Section>
          )}

          <Section title="Actions">
            <div className="flex flex-wrap gap-2">
              {c.ai.state === "none" && (
                <>
                  <ActionButton onClick={() => setAi((a) => ({ ...a, state: "pending" }))}>
                    <ScanFace className="size-4" />
                    Send a verification link
                  </ActionButton>
                  <ActionButton variant="outline" onClick={reissue}>
                    <ShieldCheck className="size-4" />
                    Record a manual check
                  </ActionButton>
                </>
              )}
              {c.ai.state === "pending" && (
                <>
                  <ActionButton onClick={reissue}>
                    <Check className="size-4" />
                    Pass
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    onClick={() =>
                      setAi((a) => ({
                        ...a,
                        state: "declined",
                        declineReason: "Selfie did not match the document photo.",
                      }))
                    }
                  >
                    <X className="size-4" />
                    Decline
                  </ActionButton>
                </>
              )}
              {(c.ai.state === "passed" || c.ai.state === "declined") && (
                <>
                  <ActionButton variant="outline" onClick={() => setAi((a) => ({ ...a, state: "pending" }))}>
                    <RefreshCw className="size-4" />
                    Re-verify
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    onClick={() =>
                      setAi((a) => ({ ...a, state: "none", extracted: null, completedAt: null, faceMatchScore: null }))
                    }
                  >
                    Withdraw the verdict
                  </ActionButton>
                </>
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              A manual check records that a member of staff put their eyes on the physical licence. It
              is a real verdict with a real name against it — 93 of the 521 live customers were
              cleared this way.
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section
            title="CheckMyDriver"
            description="Checks the licence against the issuing state directly, which the document scan cannot do."
            right={<Pill tone={CMD_TONE[c.cmd.state]}>{CMD_WORD[c.cmd.state]}</Pill>}
          >
            {c.cmd.state === "none" ? (
              <EmptyHint>
                Not run for this customer. It needs their consent, so it goes out as a link they open
                themselves.
              </EmptyHint>
            ) : (
              <>
                <div className={listCls}>
                  <Row label="Holder" value={c.cmd.holder} />
                  <Row label="Licence number" value={c.cmd.number} mono />
                  <Row label="Expires" value={fmtDate(c.cmd.expires)} />
                  <Row label="Issued in" value={c.cmd.place} />
                  <Row
                    label="Last update"
                    value={c.cmd.lastEventAt ? fmtDate(c.cmd.lastEventAt) : "—"}
                    tone="muted"
                  />
                </div>

                {c.cmd.documents > 0 && (
                  <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {Array.from({ length: c.cmd.documents }, (_, i) => (
                      <Thumb key={i} className="aspect-[3/4] w-full" filled caption={`Document ${i + 1}`} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Section>

          <Section
            title="The link"
            description="Sent to the customer, opened by them, and it expires. Nothing happens until they do."
          >
            <div className="flex flex-wrap items-center gap-2">
              {c.cmd.channels.map((ch) => {
                const Icon = CHANNEL_ICON[ch];
                return (
                  <Pill key={ch} tone="primary">
                    <Icon className="size-3" />
                    {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
                  </Pill>
                );
              })}
              {c.cmd.channels.length === 0 && (
                <p className="text-xs text-muted-foreground">No delivery channel chosen yet.</p>
              )}
            </div>

            {!c.consent.sms && c.cmd.channels.includes("sms") && (
              <div className="mt-4 flex items-start gap-3 rounded-3xl bg-warning-light/60 px-5 py-4 ring-1 ring-warning/25">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-xs leading-relaxed">
                  This link is set to go by SMS, but the customer has not given SMS consent. Turn it on
                  under{" "}
                  <button
                    type="button"
                    onClick={() => onJump("consent")}
                    className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Consent
                  </button>{" "}
                  or the message will not send.
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {c.cmd.state === "none" ? (
                <ActionButton
                  onClick={() =>
                    setCmd((m) => ({
                      ...m,
                      state: "awaiting",
                      lastEventAt: TODAY,
                    }))
                  }
                >
                  <Send className="size-4" />
                  Start a CheckMyDriver check
                </ActionButton>
              ) : (
                <ActionButton
                  variant="outline"
                  onClick={() => setCmd((m) => ({ ...m, lastEventAt: TODAY }))}
                >
                  <Link2 className="size-4" />
                  Resend the link
                </ActionButton>
              )}
            </div>
          </Section>
        </>
      )}
    </Panel>
  );
}

function ProducedFromInline({ onJump }: { onJump: PanelProps["onJump"] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <ShieldCheck className="size-3.5" />
      Checked against
      <button
        type="button"
        onClick={() => onJump("identity")}
        className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
      >
        Identity
      </button>
      <span>and</span>
      <button
        type="button"
        onClick={() => onJump("licence")}
        className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
      >
        Licence &amp; driving
      </button>
    </p>
  );
}

/** One value as the provider read it, beside the same value as it stands now. */
function ComparisonRow({ label, was, now }: { label: string; was: string; now: string }) {
  const changed = was.trim() !== now.trim();
  return (
    <div className="grid grid-cols-[8rem_1fr_auto_1fr] items-center gap-3 px-5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-[13px]",
          changed ? "text-muted-foreground line-through decoration-muted-foreground/50" : "font-medium"
        )}
      >
        {was || "—"}
      </span>
      {changed ? (
        <ArrowRight className="size-3.5 shrink-0 text-warning" />
      ) : (
        <Check className="size-3.5 shrink-0 text-success/60" />
      )}
      <span
        className={cn(
          "min-w-0 truncate text-right text-[13px]",
          changed ? "font-semibold text-warning" : "text-muted-foreground"
        )}
      >
        {changed ? now || "not set" : "matches"}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Account
   ══════════════════════════════════════════════════════════════════════════ */

const BLOCK_KINDS: { kind: GlobalBlock["kind"]; label: string; hint: string }[] = [
  { kind: "licence", label: "Licence number", hint: "Follows the person across email addresses" },
  { kind: "id", label: "Other ID", hint: "Passport or national ID" },
  { kind: "email", label: "Email", hint: "Weakest — a new address defeats it" },
];

export function AccountPanel({ c, patch, onJump }: PanelProps) {
  const [blockReason, setBlockReason] = useState("");
  const [globalKind, setGlobalKind] = useState<GlobalBlock["kind"]>("licence");
  const [globalReason, setGlobalReason] = useState("");

  const setAccount = (fn: (a: CustomerState["account"]) => CustomerState["account"]) =>
    patch((p) => ({ ...p, account: fn(p.account) }));

  const valueFor = (kind: GlobalBlock["kind"]) =>
    kind === "licence" ? c.licence.number : kind === "id" ? c.licence.idNumber : c.identity.email;

  const setStatus = (status: CustomerState["account"]["status"]) =>
    setAccount((a) => ({
      ...a,
      status,
      rejection:
        status === "Rejected"
          ? (a.rejection ?? {
              reason: "",
              by: "You",
              at: TODAY,
            })
          : null,
    }));

  return (
    <Panel
      title="Account"
      description="Whether this person can rent — from you, and from anybody else on the platform."
    >
      <Section
        title="Status"
        description="Inactive keeps the history and stops the account being used. Rejected is a decision with a reason attached, and the customer is told."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <OptionCard
            selected={c.account.status === "Active"}
            onClick={() => setStatus("Active")}
            title="Active"
            subtitle="Can book and rent"
          />
          <OptionCard
            selected={c.account.status === "Inactive"}
            onClick={() => setStatus("Inactive")}
            title="Inactive"
            subtitle="Dormant, not refused"
          />
          <OptionCard
            selected={c.account.status === "Rejected"}
            onClick={() => setStatus("Rejected")}
            title="Rejected"
            subtitle="Turned down, with a reason"
          />
        </div>

        {c.account.status === "Rejected" && (
          <div className="mt-5">
            <Field
              label="Why they were rejected"
              hint="Recorded against your name and shown to any member of staff who opens this record."
            >
              <textarea
                rows={3}
                className={textareaCls}
                value={c.account.rejection?.reason ?? ""}
                placeholder="e.g. Could not evidence a licence held for the minimum 12 months."
                onChange={(e) =>
                  setAccount((a) => ({
                    ...a,
                    rejection: {
                      reason: e.target.value,
                      by: a.rejection?.by ?? "You",
                      at: a.rejection?.at ?? TODAY,
                    },
                  }))
                }
              />
            </Field>
            {c.account.rejection && (
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded by {c.account.rejection.by} on {fmtDate(c.account.rejection.at)}.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── local block ──────────────────────────────────────────────────
          Deliberately an ordinary Section. It is reversible, it affects only
          this operator, and treating it as a red-alert decision makes the
          genuinely irreversible one below it look no worse than this. */}
      <Section
        title="Blocked with you"
        description="Stops new bookings on your account only. Rentals already out are unaffected, and you can lift it at any time."
      >
        <Toggle
          tone="destructive"
          checked={!!c.account.blockedHere}
          onChange={(v) =>
            setAccount((a) => ({
              ...a,
              blockedHere: v
                ? { reason: blockReason, at: TODAY }
                : null,
            }))
          }
          label="Block this customer with us"
          hint="They stay visible in your records and can still be contacted."
        />

        {c.account.blockedHere && (
          <div className="mt-5">
            <Field label="Reason" hint="Shown to staff on every screen this customer appears on.">
              <textarea
                rows={2}
                className={textareaCls}
                value={c.account.blockedHere.reason}
                placeholder="e.g. Two no-shows and an unpaid toll balance."
                onChange={(e) => {
                  setBlockReason(e.target.value);
                  setAccount((a) => ({
                    ...a,
                    blockedHere: a.blockedHere ? { ...a.blockedHere, reason: e.target.value } : null,
                  }));
                }}
              />
            </Field>
            <p className="mt-2 text-xs text-muted-foreground">
              Blocked on {fmtDate(c.account.blockedHere.at)}.
            </p>
          </div>
        )}
      </Section>

      {/* ── global block ─────────────────────────────────────────────────
          The correction this screen exists to make. A platform blocklist entry
          is a different ACT from blocking someone with you: it reaches every
          other operator on Drive247, it is keyed on an identity rather than on
          this row, and it survives the customer being deleted. Collapsing the
          two into one switch — which an earlier pass did — hides the larger of
          the two behind the smaller. */}
      <DangerSection
        title="Platform blocklist"
        description="Reaches every operator on Drive247, not just you. Keyed on the identity, so it follows the person into new accounts and outlives this record."
      >
        {c.account.globalBlocks.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nothing listed. Add an entry only for fraud, a stolen vehicle, or something you would
            phone another operator about.
          </p>
        ) : (
          <div className={listCls}>
            {c.account.globalBlocks.map((b) => (
              <div key={b.id} className="flex items-center gap-4 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-destructive/10">
                  <Globe className="size-4 text-destructive" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {BLOCK_KINDS.find((k) => k.kind === b.kind)?.label} · {b.value}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {b.reason || "No reason recorded"} · added {fmtDate(b.addedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove from the platform blocklist"
                  onClick={() =>
                    setAccount((a) => ({
                      ...a,
                      globalBlocks: a.globalBlocks.filter((x) => x.id !== b.id),
                    }))
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-3xl bg-card p-5 ring-1 ring-foreground/5">
          <p className="mb-4 text-xs font-medium">Add an entry</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {BLOCK_KINDS.map((k) => (
              <OptionCard
                key={k.kind}
                selected={globalKind === k.kind}
                onClick={() => setGlobalKind(k.kind)}
                title={k.label}
                subtitle={valueFor(k.kind) || "Nothing on file"}
                meta={<span className="mt-1 block text-[11px] text-muted-foreground">{k.hint}</span>}
              />
            ))}
          </div>

          <div className="mt-4">
            <Field label="Reason" hint="Other operators see this. Write it for someone who has never met this person.">
              <input
                className={inputCls}
                value={globalReason}
                placeholder="e.g. Vehicle reported stolen, recovered by police in another state."
                onChange={(e) => setGlobalReason(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Button
              variant="destructive"
              disabled={!valueFor(globalKind) || !globalReason.trim()}
              onClick={() => {
                setAccount((a) => ({
                  ...a,
                  globalBlocks: [
                    ...a.globalBlocks,
                    {
                      id: `b${Date.now()}`,
                      kind: globalKind,
                      value: valueFor(globalKind),
                      reason: globalReason.trim(),
                      addedAt: TODAY,
                    },
                  ],
                }));
                setGlobalReason("");
              }}
            >
              <ShieldOff className="size-4" />
              Add to the platform blocklist
            </Button>
            {!valueFor(globalKind) && (
              <p className="mt-2 text-xs text-muted-foreground">
                There is no {BLOCK_KINDS.find((k) => k.kind === globalKind)?.label.toLowerCase()} on
                this record to block. Add one on{" "}
                <button
                  type="button"
                  onClick={() => onJump(globalKind === "email" ? "identity" : "licence")}
                  className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                >
                  {globalKind === "email" ? "Identity" : "Licence & driving"}
                </button>
                .
              </p>
            )}
          </div>
        </div>
      </DangerSection>

      <DangerSection
        title="Delete this customer"
        description="Removes the record, their portal login and everything attached to it. Rentals, payments and fines go with it. There is no undo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive" disabled={c.rentals.some((r) => r.status === "Active")}>
            <Ban className="size-4" />
            Delete customer
          </Button>
          {c.rentals.some((r) => r.status === "Active") && (
            <p className="text-xs text-muted-foreground">
              Not while a car is out with them. Close the active rental first.
            </p>
          )}
        </div>
      </DangerSection>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Consent
   ══════════════════════════════════════════════════════════════════════════ */

export function ConsentPanel({ c, patch, onJump }: PanelProps) {
  const setConsent = (fn: (x: CustomerState["consent"]) => CustomerState["consent"]) =>
    patch((p) => ({ ...p, consent: fn(p.consent) }));

  return (
    <Panel
      title="Consent"
      description="Not a preference — a record of permission, with the date it was given and how."
    >
      <Section title="Text messages">
        <Toggle
          checked={c.consent.sms}
          onChange={(v) =>
            setConsent((x) => ({
              ...x,
              sms: v,
              smsAt: v ? (x.smsAt ?? TODAY) : null,
              smsSource: v ? (x.smsSource ?? "Recorded by staff") : null,
            }))
          }
          label="This customer has agreed to receive SMS"
          hint="Booking confirmations, handover reminders, payment links and lockbox codes."
        />

        {c.consent.sms && c.consent.smsAt && (
          <div className="mt-5">
            <p className="mb-2.5 text-xs font-medium">The evidence</p>
            <div className={listCls}>
              <Row label="Given on" value={fmtDate(c.consent.smsAt)} />
              <Row label="Captured by" value={c.consent.smsSource ?? "—"} />
              <Row label="Number" value={c.identity.phone || "No phone on file"} mono />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              This is what a carrier asks for when a messaging campaign is challenged. Turning the
              switch off clears it — it does not archive it.
            </p>
          </div>
        )}

        {!c.consent.sms && (
          <div className="mt-5 flex items-start gap-3 rounded-3xl bg-warning-light/60 px-5 py-4 ring-1 ring-warning/25">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-warning">No SMS may be sent to this customer</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Including the lockbox code — the message that opens the box holding the keys. A
                handover set to lockbox will fall back to email, and if there is no email either it
                cannot complete.
              </p>
              {!c.identity.email && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onJump("identity")}
                  className="mt-1 h-auto p-0 text-warning"
                >
                  There is no email on file either — add one
                </Button>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="WhatsApp"
        description="A separate permission with its own template rules. Agreeing to SMS is not agreeing to this."
      >
        <Toggle
          checked={c.consent.whatsapp}
          onChange={(v) => setConsent((x) => ({ ...x, whatsapp: v }))}
          label="This customer has opted in to WhatsApp"
          hint="Used for handover threads where a photo is worth more than a paragraph."
        />
      </Section>

      <Section title="Where messages would go today">
        <div className={listCls}>
          <Row
            label="Email"
            value={c.identity.email || "Nothing on file"}
            tone={c.identity.email ? undefined : "muted"}
          />
          <Row
            label="SMS"
            value={c.consent.sms ? c.identity.phone || "No number on file" : "Not permitted"}
            tone={c.consent.sms && c.identity.phone ? undefined : "warning"}
          />
          <Row
            label="WhatsApp"
            value={c.consent.whatsapp ? c.identity.phone || "No number on file" : "Not permitted"}
            tone={c.consent.whatsapp && c.identity.phone ? undefined : "muted"}
          />
        </div>
      </Section>
    </Panel>
  );
}
