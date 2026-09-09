"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Verification — the two verdicts, and whether either still describes the
 * record it was taken against.
 *
 * This is the one section PRODUCED from another. When the person's details move
 * underneath a verdict the banner goes amber, names exactly what changed, and
 * offers both ways out. Amber means only that; a block is red.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Link2,
  Mail,
  MessageSquare,
  Minus,
  ScanFace,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useResendCmdLink, type CmdChannel } from "@/hooks/use-cmd-verification";
import { Button } from "@/components/ui-v2/button";
import { StartVerificationDialog } from "@/components/customers/start-verification-dialog";
import { currentBaseline } from "./derive";
import {
  EmptyHint,
  OutOfDateBanner,
  Panel,
  Pill,
  Row,
  Section,
  Segmented,
  Thumb,
  Timeline,
  fmtDate,
  listCls,
} from "./kit";
import type { Drift } from "./kit";
import type { SectionProps } from "./sections";

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

const CHANNEL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: Smartphone,
};

export function SectionVerification({ c, onJump, canEdit, drift }: SectionProps & { drift: Drift[] }) {
  const [provider, setProvider] = useState<"ai" | "cmd">(c.cmd.present && !c.ai.extracted ? "cmd" : "ai");
  const [startOpen, setStartOpen] = useState(false);
  const { logAction } = useAuditLog();
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resendCmd = useResendCmdLink();

  const stale = drift.length > 0;

  /**
   * "The verdict still stands."
   *
   * Records the decision — who, when, and against exactly which values — and
   * leaves the provider's own extracted data untouched. The banner clears
   * because the drift check subtracts an accepted baseline, not because the
   * evidence was rewritten to agree with the record.
   */
  const acceptDrift = async () => {
    await logAction({
      action: "customer_updated",
      entityType: "customer",
      entityId: c.id,
      details: {
        kind: "verification_drift_accepted",
        accepted: currentBaseline(c),
        changed: drift.map((d) => d.label),
      },
    });
    queryClient.invalidateQueries({ queryKey: ["customer-v2-audit", tenant?.id, c.id] });
    toast({
      title: "Verdict left standing",
      description: "Recorded against your name, with the values you accepted.",
    });
  };

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

  const photoCount = Object.values(c.ai.photos).filter(Boolean).length;

  return (
    <Panel
      title="Verification"
      description="Whether this person is who they say they are. Produced from the record — never typed in here."
    >
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

      {stale && (
        <OutOfDateBanner
          title="This verdict was issued against details that have since changed"
          meta={`Passed ${c.ai.completedAt ? fmtDate(c.ai.completedAt) : "earlier"} · ${drift.length} value${
            drift.length === 1 ? "" : "s"
          } no longer match`}
          drift={drift}
          primaryLabel="Re-run verification"
          onPrimary={() => setStartOpen(true)}
          primaryDisabled={!canEdit}
          secondaryLabel="Verdict still stands"
          onSecondary={acceptDrift}
          secondaryDisabled={!canEdit}
        />
      )}

      {/* ── the headline verdict, above the provider split ─────────────── */}
      <Section>
        <div className="flex items-start gap-4" data-tour="customer-verification">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-3xl", ring[verdict.tone])}>
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
                      : `Passed ${c.ai.completedAt ? fmtDate(c.ai.completedAt) : "earlier"}${
                          c.ai.extracted?.documentNumber ? ` against licence ${c.ai.extracted.documentNumber}` : ""
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
                at: `${photoCount} of 4 images`,
                done: photoCount > 0,
              },
              { label: "Sent to the provider", done: c.ai.state !== "none" },
              {
                label: "Verdict issued",
                at: c.ai.completedAt ? fmtDate(c.ai.completedAt) : undefined,
                done: c.ai.state === "passed" || c.ai.state === "declined",
              },
              {
                label: "Licence checked with the issuing state",
                at: c.cmd.lastEventAt ? fmtDate(c.cmd.lastEventAt) : undefined,
                done: c.cmd.state === "valid" || c.cmd.state === "invalid",
              },
            ]}
          />
        </div>
      </Section>

      {/* ── the two providers ──────────────────────────────────────────── */}
      {c.cmd.present && (
        <div className="flex items-center justify-between gap-4">
          <Segmented
            value={provider}
            onChange={setProvider}
            options={[
              {
                value: "ai",
                label: "Document & selfie",
                badge: (
                  <Pill tone={c.ai.state === "passed" ? "success" : "neutral"}>
                    {c.ai.state === "passed" ? "Passed" : "—"}
                  </Pill>
                ),
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
      )}

      {provider === "ai" || !c.cmd.present ? (
        <>
          <Section
            title="What the provider captured"
            description="Its own evidence, at the moment it decided. These cannot be replaced from the Documents panel."
          >
            {photoCount === 0 ? (
              <EmptyHint>No images were captured for this customer.</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Thumb
                  className="aspect-[3/4] w-full"
                  src={c.ai.photos.face}
                  caption="Face"
                  onClick={() => c.ai.photos.face && window.open(c.ai.photos.face, "_blank")}
                />
                <Thumb
                  className="aspect-[3/4] w-full"
                  src={c.ai.photos.selfie}
                  caption="Selfie"
                  onClick={() => c.ai.photos.selfie && window.open(c.ai.photos.selfie, "_blank")}
                />
                <Thumb
                  className="aspect-[3/4] w-full"
                  src={c.ai.photos.docFront}
                  caption="Licence front"
                  onClick={() => c.ai.photos.docFront && window.open(c.ai.photos.docFront, "_blank")}
                />
                <Thumb
                  className="aspect-[3/4] w-full"
                  src={c.ai.photos.docBack}
                  caption="Licence back"
                  onClick={() => c.ai.photos.docBack && window.open(c.ai.photos.docBack, "_blank")}
                />
              </div>
            )}
          </Section>

          {/*
            Only shown when the provider actually read something. A DECLINED
            verdict often extracted nothing at all — OCR failed, the photo was
            unusable — and a table of five "—" rows against five "—" rows says
            nothing except that this screen does not know what it is talking
            about.
          */}
          {c.ai.extracted && Object.values(c.ai.extracted).some((v) => !!v) && (
            <Section
              title="What it read, against what the record says now"
              description="Any of these moving is what turns this panel amber."
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
                  now={[c.identity.street, c.identity.city, [c.identity.state, c.identity.zip].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ")}
                />
              </div>
            </Section>
          )}

          {canEdit && (
            <Section title="Actions">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setStartOpen(true)}>
                  <ScanFace className="size-4" />
                  {c.ai.state === "none" ? "Send a verification link" : "Re-verify"}
                </Button>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                The customer opens the link themselves and photographs their licence and their face.
                Nothing on this panel can be typed in — that is what makes it evidence.
              </p>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section
            title="CheckMyDriver"
            description="Checks the licence against the issuing state directly, which the document scan cannot do."
            right={<Pill tone={CMD_TONE[c.cmd.state]}>{CMD_WORD[c.cmd.state]}</Pill>}
          >
            <div className={listCls}>
              <Row label="Holder" value={c.cmd.holder || "—"} />
              <Row label="Licence number" value={c.cmd.number || "—"} mono />
              <Row label="Expires" value={fmtDate(c.cmd.expires)} />
              <Row label="Issued in" value={c.cmd.place || "—"} />
              <Row label="Last update" value={fmtDate(c.cmd.lastEventAt)} tone="muted" />
            </div>

            {c.cmd.documents.length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {c.cmd.documents.map((url, i) => (
                  <Thumb
                    key={url}
                    className="aspect-[3/4] w-full"
                    src={url}
                    caption={`Document ${i + 1}`}
                    onClick={() => window.open(url, "_blank")}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section
            title="The link"
            description="Sent to the customer, opened by them, and it expires. Nothing happens until they do."
          >
            <div className="flex flex-wrap items-center gap-2">
              {c.cmd.channels.map((ch) => {
                const Icon = CHANNEL_ICON[ch] || Mail;
                return (
                  <Pill key={ch} tone="primary">
                    <Icon className="size-3" />
                    {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
                  </Pill>
                );
              })}
              {c.cmd.channels.length === 0 && (
                <p className="text-xs text-muted-foreground">No delivery channel recorded.</p>
              )}
              {c.cmd.linkExpiresAt && (
                <Pill tone="neutral">Link expires {fmtDate(c.cmd.linkExpiresAt)}</Pill>
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

            {canEdit && c.cmd.applicantVerificationId && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={resendCmd.isPending}
                  onClick={() =>
                    resendCmd.mutate({
                      verificationId: c.cmd.applicantVerificationId!,
                      customerId: c.id,
                      channels: (c.cmd.channels.length ? c.cmd.channels : ["email"]) as CmdChannel[],
                    })
                  }
                >
                  <Link2 className="size-4" />
                  Resend the link
                </Button>
              </div>
            )}
          </Section>
        </>
      )}

      <StartVerificationDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        customerId={c.id}
        customerName={c.identity.name}
      />
    </Panel>
  );
}

/** One value as the provider read it, beside the same value as it stands now. */
function ComparisonRow({ label, was, now }: { label: string; was: string; now: string }) {
  // `fmtDate(null)` is an em dash, not an empty string, so a plain truthiness
  // test on a formatted date reports two unknowns as a match. Both forms of
  // "nothing here" have to count as unknown or the row claims agreement
  // between two blanks.
  const blank = (v: string) => !v.trim() || v.trim() === "—";
  const known = !blank(was) && !blank(now);
  const changed = known && was.trim().toLowerCase() !== now.trim().toLowerCase();
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
      ) : known ? (
        <Check className="size-3.5 shrink-0 text-success/60" />
      ) : (
        <Minus className="size-3.5 shrink-0 text-muted-foreground/40" />
      )}
      <span
        className={cn(
          "min-w-0 truncate text-right text-[13px]",
          changed ? "font-semibold text-warning" : "text-muted-foreground"
        )}
      >
        {changed ? now : known ? "matches" : "not comparable"}
      </span>
    </div>
  );
}
