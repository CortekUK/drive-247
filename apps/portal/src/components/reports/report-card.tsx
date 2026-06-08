import React from 'react';
import { LucideIcon, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Tile, StatusPill } from '@/components/bento';
import { Button } from '@/components/ui/button';

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
    <Tile
      interactive
      onClick={onClick}
      className="group h-full relative overflow-hidden flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile-sm [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-bold tracking-tight text-foreground truncate">{title}</h3>
      </div>

      <div className="min-w-0">
        <div className="text-2xl font-extrabold tracking-tight text-foreground truncate" title={value}>{value}</div>
        <p className="text-sm text-muted-foreground mt-1 truncate" title={subtitle}>{subtitle}</p>
      </div>

      {metadata && (
        <div className="flex flex-wrap gap-1">
          <StatusPill tone="neutral" className="truncate max-w-full font-mono tabular-nums" title={metadata}>
            {metadata}
          </StatusPill>
        </div>
      )}

      <p className="text-xs text-muted-foreground line-clamp-2">
        {description}
      </p>

      {/* Export Icons - Bottom Right */}
      <div className="absolute bottom-4 right-4 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
    </Tile>
  );
};