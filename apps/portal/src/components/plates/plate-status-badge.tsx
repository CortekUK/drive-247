import { Badge } from "@/components/ui/badge";

interface PlateStatusBadgeProps {
  status: string;
  showTooltip?: boolean;
}

export const PlateStatusBadge = ({ status, showTooltip }: PlateStatusBadgeProps) => {
  const getStatusConfig = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'ordered':
        return {
          variant: 'secondary' as const,
          className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
          label: 'Ordered'
        };
      case 'received':
        return {
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
          label: 'Received'
        };
      case 'fitted':
      case 'assigned':
        return {
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
          label: 'Assigned'
        };
      case 'expired':
        return {
          variant: 'secondary' as const,
          className: 'bg-gray-800 text-gray-100',
          label: 'Expired'
        };
      default:
        return {
          variant: 'secondary' as const,
          className: 'bg-secondary text-secondary-foreground',
          label: status || 'Unknown'
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <Badge
      variant={config.variant}
      className={config.className}
      title={showTooltip ? config.label : undefined}
    >
      {config.label}
    </Badge>
  );
};