"use client";

interface BreakdownLine { label: string; amount: number }

interface Props {
  rentalTotal: number;
  upfront: BreakdownLine[];
  splittableLabel?: string;
  splittableAmount: number;
  installmentAmount: number;
  installmentCount: number;
  currencyCode?: string;
}

function fmt(amount: number, code = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
}

export function InstallmentBreakdown({
  rentalTotal, upfront, splittableLabel = "Splittable",
  splittableAmount, installmentAmount, installmentCount, currencyCode = "USD",
}: Props) {
  const upfrontTotal = upfront.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="bg-card border border-border/60 rounded-lg p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Rental total</span>
        <span className="text-lg font-semibold text-foreground">{fmt(rentalTotal, currencyCode)}</span>
      </div>

      <div className="border-t border-border/60 pt-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">Paid upfront</div>
        <div className="space-y-1 text-sm">
          {upfront.map((l) => (
            <div key={l.label} className="flex justify-between">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="text-foreground/90">{fmt(l.amount, currencyCode)}</span>
            </div>
          ))}
          <div className="flex justify-between font-medium pt-1 border-t border-border/60">
            <span className="text-foreground">Subtotal</span>
            <span className="text-foreground">{fmt(upfrontTotal, currencyCode)}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 pt-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">{splittableLabel}</div>
        <div className="text-sm text-foreground/90 mb-1">
          {fmt(splittableAmount, currencyCode)} → {installmentCount}× {fmt(installmentAmount, currencyCode)}
        </div>
      </div>
    </div>
  );
}

export default InstallmentBreakdown;
