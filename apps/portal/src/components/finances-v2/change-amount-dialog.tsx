"use client";

/**
 * Change a line's amount — the only way a line changes.
 *
 *   DRAFT invoice   → the line is simply edited ("Edit amount").
 *   ISSUED invoice  → the line is never touched. The difference becomes a note
 *                     under it, with its reason:
 *                       higher → a DEBIT NOTE  (+, "they owe more")
 *                       lower  → a CREDIT NOTE (−, "they owe less")
 *                     and if a credit frees money that was already paid, the
 *                     operator says what happens to it: kept on the customer's
 *                     account, or refunded.
 *
 * The box under the inputs says, as you type, exactly what will be created —
 * so nobody needs to know the words "debit" or "credit" to use it.
 */

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { changeLineAmount } from "./finance-mock";

export type ChangeAmountTarget = {
  chargeId: string;
  label: string;
  invoiceNumber: string;
  entityRef: string | null;
  /** What the line is billed at now (original ± notes). */
  current: number;
  /** What is still owed on it. */
  remaining: number;
  isDraft: boolean;
  /** Where a refund would go: "card (Stripe)", "card (Square)", or null → by hand. */
  refundTo: string | null;
};

const EPS = 0.005;

export function ChangeAmountDialog({
  target,
  currencyCode,
  onOpenChange,
}: {
  target: ChangeAmountTarget | null;
  currencyCode: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currencyCode);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [settle, setSettle] = useState<"account" | "refund">("account");

  useEffect(() => {
    if (!target) return;
    setValue(target.current.toFixed(2));
    setReason("");
    setSettle("account");
  }, [target]);

  if (!target) return <Dialog open={false} onOpenChange={onOpenChange} />;

  const next = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(next) && next >= 0;
  const delta = valid ? Math.round((next - target.current) * 100) / 100 : 0;
  const up = delta > EPS;
  const down = delta < -EPS;
  // A credit bigger than what is still owed frees money already paid.
  const freed = down ? Math.max(0, -delta - target.remaining) : 0;
  const needsReason = !target.isDraft && (up || down);
  const canSave = valid && (up || down) && (!needsReason || reason.trim().length > 0);

  const save = () => {
    changeLineAmount(target.chargeId, next, reason.trim() || "Edited", settle);
    toast({
      title: target.isDraft
        ? `${target.label} updated`
        : up
          ? `Debit note added · +${money(delta)}`
          : `Credit note added · −${money(-delta)}`,
      description: target.isDraft
        ? `Now ${money(next)} on ${target.invoiceNumber}.`
        : freed > EPS
          ? settle === "refund"
            ? `${money(freed)} refunded ${target.refundTo ? `to ${target.refundTo}` : "by hand"}.`
            : `${money(freed)} kept on the customer's account.`
          : `${target.label} on ${target.invoiceNumber} is now ${money(next)}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {target.isDraft ? "Edit amount" : "Change amount"} · {target.label}
          </DialogTitle>
          <DialogDescription>
            {[target.invoiceNumber, target.entityRef].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Current amount</span>
            <span className="font-medium tabular-nums">{money(target.current)}</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ca-amount">New amount</Label>
            <Input
              id="ca-amount"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
              autoFocus
            />
          </div>
          {!target.isDraft && (
            <div className="grid gap-1.5">
              <Label htmlFor="ca-reason">Reason</Label>
              <Input
                id="ca-reason"
                placeholder={up ? "e.g. Upgraded to full cover" : "e.g. Basic cover only"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {/* What this will create — updates as you type. */}
          {!target.isDraft && (up || down) && (
            <div
              className={cn(
                "rounded-lg border px-3 py-2.5 text-sm",
                up
                  ? "border-amber-500/20 bg-amber-500/5"
                  : "border-emerald-500/20 bg-emerald-500/5",
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                {up
                  ? `This adds a debit note of +${money(delta)}`
                  : `This adds a credit note of −${money(-delta)}`}
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {up
                  ? `The customer will owe ${money(delta)} more.`
                  : freed > EPS
                    ? `${money(freed)} was already paid — after this, the customer is owed ${money(freed)}.`
                    : `The customer will owe ${money(-delta)} less.`}
              </p>
              {freed > EPS && (
                <div className="mt-2 grid gap-1.5" role="radiogroup" aria-label="What happens to the money owed back">
                  {(
                    [
                      ["account", "Keep on their account"],
                      ["refund", target.refundTo ? `Refund to their ${target.refundTo}` : "Refund by hand"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="ca-settle"
                        checked={settle === key}
                        onChange={() => setSettle(key)}
                        className="accent-[hsl(var(--primary))]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {target.isDraft ? "Save" : up ? "Add debit note" : down ? "Add credit note" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
