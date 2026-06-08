import { getInsuranceStatusInfo, type InsurancePolicyStatus } from "@/lib/insurance-utils";
import { StatusPill, type StatusTone } from "@/components/bento";

interface InsurancePolicyStatusChipProps {
  status: InsurancePolicyStatus;
  expiryDate: string;
  className?: string;
}

export function InsurancePolicyStatusChip({
  status,
  expiryDate,
  className,
}: InsurancePolicyStatusChipProps) {
  const statusInfo = getInsuranceStatusInfo(status, expiryDate);

  const getTone = (): StatusTone => {
    switch (statusInfo.level) {
      case "ok":
        return "success";
      case "due_soon":
        return "warn";
      case "expired":
      case "suspended":
      case "cancelled":
        return "danger";
      case "inactive":
        return "neutral";
      default:
        return "neutral";
    }
  };

  return (
    <StatusPill tone={getTone()} dot className={className}>
      {statusInfo.label}
    </StatusPill>
  );
}
