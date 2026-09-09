"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Account — status, rejection, and the two blocks with different blast radii.
 *
 * `customers.is_blocked` stops this customer with THIS operator.
 * `blocked_identities` is keyed on a licence, an ID or an email and reaches
 * every tenant on the platform. Confusing the two is the most expensive
 * misclick on this screen, so they are never rendered as one control.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, ShieldOff, Trash2 } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { Button } from "@/components/ui-v2/button";
import {
  DangerSection,
  Field,
  OptionCard,
  Panel,
  Row,
  Section,
  Toggle,
  fmtDate,
  inputCls,
  listCls,
  textareaCls,
} from "./kit";
import type { GlobalBlock } from "./types";
import type { SectionProps } from "./sections";

const BLOCK_KINDS: { kind: GlobalBlock["kind"]; label: string; hint: string }[] = [
  { kind: "license", label: "Licence number", hint: "Follows the person across email addresses" },
  { kind: "id_card", label: "Other ID", hint: "Passport or national ID" },
  { kind: "email", label: "Email", hint: "Weakest — a new address defeats it" },
];

export function SectionAccount({ c, set, onJump, canEdit }: SectionProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [globalKind, setGlobalKind] = useState<GlobalBlock["kind"]>("license");
  const [globalReason, setGlobalReason] = useState("");
  const { blockCustomer, unblockCustomer, addBlockedIdentity, removeBlockedIdentity, isLoading } =
    useCustomerBlockingActions();

  const refreshBlocks = () =>
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "customer-v2-global-blocks" || q.queryKey[0] === "customer-v2-row",
    });

  const valueFor = (kind: GlobalBlock["kind"]) =>
    kind === "license" ? c.licence.number : kind === "email" ? c.identity.email : c.licence.idNumber;

  const setStatus = (status: "Active" | "Inactive" | "Rejected") =>
    set(
      status === "Rejected"
        ? { status, rejected_at: c.account.rejection?.at ?? new Date().toISOString() }
        : { status, rejection_reason: null, rejected_at: null }
    );

  const hasActiveRental = c.rentals.some((r) => r.status === "Active");

  return (
    <Panel
      title="Account"
      description="Whether this person can rent — from you, and from anybody else on the platform."
    >
      <Section
        title="Status"
        description="Inactive keeps the history and stops the account being used. Rejected is a decision with a reason attached."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <OptionCard
            selected={c.account.status === "Active"}
            disabled={!canEdit}
            onClick={() => setStatus("Active")}
            title="Active"
            subtitle="Can book and rent"
          />
          <OptionCard
            selected={c.account.status === "Inactive"}
            disabled={!canEdit}
            onClick={() => setStatus("Inactive")}
            title="Inactive"
            subtitle="Dormant, not refused"
          />
          <OptionCard
            selected={c.account.status === "Rejected"}
            disabled={!canEdit}
            onClick={() => setStatus("Rejected")}
            title="Rejected"
            subtitle="Turned down, with a reason"
          />
        </div>

        {c.account.status === "Rejected" && (
          <div className="mt-5">
            <Field
              label="Why they were rejected"
              hint="Shown to any member of staff who opens this record."
            >
              <textarea
                rows={3}
                className={textareaCls}
                disabled={!canEdit}
                value={c.account.rejection?.reason ?? ""}
                placeholder="e.g. Could not evidence a licence held for the minimum 12 months."
                onChange={(e) => set({ rejection_reason: e.target.value })}
              />
            </Field>
            {c.account.rejection?.at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded on {fmtDate(c.account.rejection.at)}.
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
        {/* `Toggle` takes a fixed prop list and spreads nothing, so the tour's
            anchor rides an inert wrapper rather than widening a primitive that
            all eleven sections share. The div carries no classes — Toggle is
            `w-full` and the Surface around it sets no gap — so it renders
            exactly as it did before. */}
        <div data-tour="customer-block">
          <Toggle
            tone="destructive"
            disabled={!canEdit || isLoading}
            checked={!!c.account.blockedHere}
            onChange={(v) =>
              v
                ? blockCustomer.mutate(
                    { customerId: c.id, reason: "Blocked from the customer record" },
                    { onSuccess: refreshBlocks }
                  )
                : unblockCustomer.mutate(c.id, { onSuccess: refreshBlocks })
            }
            label="Block this customer with us"
            hint="They stay visible in your records and can still be contacted."
          />
        </div>

        {c.account.blockedHere && (
          <div className="mt-5">
            <div className={listCls}>
              <Row label="Reason" value={c.account.blockedHere.reason || "No reason recorded"} />
              <Row label="Blocked on" value={fmtDate(c.account.blockedHere.at)} tone="muted" />
            </div>
          </div>
        )}
      </Section>

      {/* ── global block ─────────────────────────────────────────────────
          A blocklist entry is a different ACT from blocking someone with you:
          it is keyed on an identity rather than on this row, so it follows the
          person into a new account and outlives this record. Collapsing the two
          into one switch hides the larger of them behind the smaller. */}
      <DangerSection
        title="Blocklist"
        description="Keyed on the identity, not on this record — so it follows the person into a new account and outlives the row you are looking at."
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
                    {BLOCK_KINDS.find((k) => k.kind === b.kind)?.label ?? b.kind} · {b.value}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {b.reason || "No reason recorded"} · added {fmtDate(b.addedAt)}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove from the blocklist"
                    disabled={isLoading}
                    onClick={() => removeBlockedIdentity.mutate(b.id, { onSuccess: refreshBlocks })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
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
              <Field label="Reason" hint="Write it for someone who has never met this person.">
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
                disabled={!valueFor(globalKind) || !globalReason.trim() || isLoading}
                onClick={() =>
                  addBlockedIdentity.mutate(
                    {
                      identityType: globalKind,
                      identityNumber: valueFor(globalKind),
                      reason: globalReason.trim(),
                      customerName: c.identity.name,
                    },
                    {
                      onSuccess: () => {
                        setGlobalReason("");
                        refreshBlocks();
                      },
                    }
                  )
                }
              >
                <ShieldOff className="size-4" />
                Add to the blocklist
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
        )}
      </DangerSection>

      {hasActiveRental && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A car is out with this customer right now. Blocking them stops new bookings; it does not end
          the rental already running — close that from{" "}
          <button
            type="button"
            onClick={() => onJump("rentals")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Rentals
          </button>
          .
        </p>
      )}
    </Panel>
  );
}
