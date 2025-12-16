import { Badge } from "@/components/ui/badge";
import { getDocumentStatus } from "@/hooks/use-customer-documents";

interface DocumentStatusBadgeProps {
  endDate?: string;
  className?: string;
}

export default function DocumentStatusBadge({ endDate, className }: DocumentStatusBadgeProps) {
  const status = getDocumentStatus(endDate);

  const statusConfig = {
    'Active': { variant: 'default' as const, label: 'Active' },
    'Expired': { variant: 'destructive' as const, label: 'Expired' },
    'Expires Soon': { variant: 'secondary' as const, label: 'Expires Soon' },
    'Unknown': { variant: 'outline' as const, label: 'Unknown' },
  };

  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}