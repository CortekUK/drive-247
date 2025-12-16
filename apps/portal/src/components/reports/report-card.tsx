import React from 'react';
import { LucideIcon, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ReportCardProps {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  value: string;
  subtitle: string;
  metadata?: string;
  onClick: () => void;
  onExport?: (format: 'csv' | 'xlsx' | 'pdf') => void;
  exportingReport?: string | null;
}

export const ReportCard: React.FC<ReportCardProps> = ({
  id,
  title,
  description,
  icon: Icon,
  value,
  subtitle,
  metadata,
  onClick,
  onExport,
  exportingReport
}) => {
  const handleExportClick = (e: React.MouseEvent, format: 'csv' | 'xlsx' | 'pdf') => {
    e.stopPropagation();
    onExport?.(format);
  };

  const isExporting = (format: string) => exportingReport === `${id}-${format}`;

  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all duration-200",
        "hover:shadow-lg hover:shadow-primary/5 hover:scale-[1.02] hover:border-primary/20",
        "active:scale-[0.98] h-full relative overflow-hidden"
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-2 sm:space-y-0 pb-3">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="p-2 rounded-md bg-primary/10 shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-sm font-semibold truncate">{title}</CardTitle>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="min-w-0">
          <div className="text-lg sm:text-2xl font-bold text-foreground truncate" title={value}>{value}</div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 truncate" title={subtitle}>{subtitle}</p>
        </div>
        
        {metadata && (
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-[10px] sm:text-xs truncate max-w-full" title={metadata}>
              {metadata}
            </Badge>
          </div>
        )}
        
        <CardDescription className="text-[10px] sm:text-xs line-clamp-2">
          {description}
        </CardDescription>
        
        {/* Export Icons - Bottom Right */}
        <div className="absolute bottom-3 right-3 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-primary/10"
            onClick={(e) => handleExportClick(e, 'csv')}
            title="Export CSV"
            disabled={!!exportingReport}
          >
            {isExporting('csv') ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-primary/10"
            onClick={(e) => handleExportClick(e, 'xlsx')}
            title="Export XLSX"
            disabled={!!exportingReport}
          >
            {isExporting('xlsx') ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3 w-3" />
            )}
          </Button>
          {id === 'customer-statements' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-primary/10"
              onClick={(e) => handleExportClick(e, 'pdf')}
              title="Export PDF"
              disabled={!!exportingReport}
            >
              {isExporting('pdf') ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};