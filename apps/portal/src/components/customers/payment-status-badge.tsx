import { Badge } from "@/components/ui/badge";

interface PaymentStatusBadgeProps {
  applied: number;
  amount: number;
}

export const PaymentStatusBadge = ({ applied, amount }: PaymentStatusBadgeProps) => {
  if (applied >= amount) {
    return (
      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">
        Paid
      </Badge>
    );
  } else {
    return (
      <Badge variant="secondary" className="text-xs">
        Partial
      </Badge>
    );
  }
};