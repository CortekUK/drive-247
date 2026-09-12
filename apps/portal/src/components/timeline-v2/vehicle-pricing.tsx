import { formatCurrency } from "@/lib/format-utils";
import type { TimelineVehicle } from "./model";

export function VehicleTimelinePricing({ vehicle, currency }: { vehicle: TimelineVehicle; currency: string }) {
  return <><dl className="tl-rate-grid">{([
    ["Daily", vehicle.daily, "/day"], ["Weekly", vehicle.weekly, "/week"], ["Monthly", vehicle.monthly, "/month"],
  ] as const).map(([label, amount, unit]) => <div key={label}><dt>{label}</dt><dd>{amount == null ? "Not set" : formatCurrency(amount, currency)}{amount != null && <small className="block">{unit}</small>}</dd></div>)}</dl>
    <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">Date cells show custom daily prices where set, otherwise the base daily rate. A trip's final price follows its existing pricing rules.</p>
  </>;
}
