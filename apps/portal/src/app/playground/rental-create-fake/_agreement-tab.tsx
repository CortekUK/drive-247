"use client";

/**
 * Agreement — DESIGN SANDBOX. Nothing here is real.
 *
 * The first of the two OUTPUTS: a document produced from the terms, which then
 * stops moving while the terms carry on. Everything interesting about this panel
 * is the amber banner at the top and the two ways out of it — re-issue the
 * document, or accept that the one already signed still stands.
 *
 * The rows under "What this agreement says" render the SNAPSHOT, not the live
 * terms. That is the point: it shows what the customer actually agreed to, which
 * is not necessarily what the rental currently says.
 *
 * OWNS: nothing. Renders its own `Panel`.
 */

import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fmtDateTime,
  Panel,
  cardCls,
  OutOfDateBanner,
  Timeline,
  ActionButton,
  EmptyHint,
  type Drift,
} from "@/app/playground/_shared";

export type AgreementState = "not_sent" | "sent" | "opened" | "signed";

export function AgreementTab({
  state,
  drift,
  sentAt,
  signedAt,
  rows,
  customerName,
  setupComplete,
  onSend,
  onAcceptDrift,
  onSimulateOpen,
  onSimulateSign,
}: {
  state: AgreementState;
  drift: Drift[];
  sentAt: Date | null;
  signedAt: Date | null;
  /** The snapshot, already rendered — what the document says, not what the rental says. */
  rows: { label: string; value: string }[];
  customerName: string | null;
  setupComplete: boolean;
  onSend: () => void;
  onAcceptDrift: () => void;
  onSimulateOpen: () => void;
  onSimulateSign: () => void;
}) {
  return (
    <Panel title="Agreement" description="Produced from the terms. Re-issue it whenever the terms move.">
      {drift.length > 0 && (
        <OutOfDateBanner
          title="This agreement is out of date"
          meta={
            state === "signed" && signedAt
              ? `Signed ${fmtDateTime(signedAt)} by ${customerName ?? "the customer"}`
              : sentAt
                ? `Sent ${fmtDateTime(sentAt)}, not yet signed`
                : undefined
          }
          drift={drift}
          primaryLabel={state === "signed" ? "Send an updated agreement" : "Resend with the new terms"}
          onPrimary={onSend}
          secondaryLabel={state === "signed" ? "Keep the signed one" : "Keep as sent"}
          onSecondary={onAcceptDrift}
        />
      )}

      {state === "not_sent" ? (
        <>
          <EmptyHint>
            Nothing has been sent to {customerName ?? "the customer"} yet. The agreement goes out only when you send
            it.
          </EmptyHint>
          <ActionButton onClick={onSend} disabled={!setupComplete}>
            <Send className="size-4" />
            Send the agreement
          </ActionButton>
          {!setupComplete && (
            <p className="text-xs text-muted-foreground">
              Pick a customer, a car, and settle the when-and-where first.
            </p>
          )}
        </>
      ) : (
        <>
          <div className={cn(cardCls, "p-6")}>
            <Timeline
              steps={[
                { label: "Sent for signature", at: sentAt ? fmtDateTime(sentAt) : undefined, done: true },
                {
                  label: "Opened by the customer",
                  at: state !== "sent" && sentAt ? fmtDateTime(sentAt) : undefined,
                  done: state === "opened" || state === "signed",
                },
                { label: "Signed", at: signedAt ? fmtDateTime(signedAt) : undefined, done: state === "signed" },
              ]}
            />
          </div>

          <div className={cn(cardCls, "p-6")}>
            <p className="mb-3 font-heading text-sm font-semibold">What this agreement says</p>
            <dl className="space-y-2 text-sm">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="text-right font-medium">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            {state === "sent" && (
              <ActionButton variant="outline" onClick={onSimulateOpen}>
                Simulate: the customer opens it
              </ActionButton>
            )}
            {state === "opened" && (
              <ActionButton variant="outline" onClick={onSimulateSign}>
                Simulate: the customer signs
              </ActionButton>
            )}
            <ActionButton variant="outline" onClick={onSend}>
              <Send className="size-4" />
              Resend
            </ActionButton>
          </div>
        </>
      )}
    </Panel>
  );
}
