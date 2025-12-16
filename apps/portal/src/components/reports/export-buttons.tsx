import React, { useState } from 'react';
import { format } from 'date-fns';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { ReportFilters } from '@/pages/Reports';

interface ExportButtonsProps {
  reportType: string;
  filters: ReportFilters;
}

export const ExportButtons: React.FC<ExportButtonsProps> = ({
  reportType,
  filters
}) => {
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const { toast } = useToast();

  const handleExport = async (exportType: 'csv' | 'xlsx' | 'pdf') => {
    if (isExporting) return;

    setIsExporting(exportType);
    
    try {
      const exportData = {
        reportType,
        exportType,
        filters: {
          ...filters,
          fromDate: format(filters.fromDate, 'yyyy-MM-dd'),
          toDate: format(filters.toDate, 'yyyy-MM-dd')
        }
      };

      const { data, error } = await supabase.functions.invoke('generate-export', {
        body: exportData
      });

      if (error) throw error;

      // Create download link
      let blobData;
      if (exportType === 'xlsx') {
        // Decode base64 for XLSX
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blobData = bytes;
      } else {
        blobData = data.content;
      }

      const blob = new Blob([blobData], {
        type: exportType === 'pdf' ? 'application/pdf' :
              exportType === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
              'text/csv'
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Export successful',
        description: `${reportType.replace('-', ' ')} exported as ${exportType.toUpperCase()}`
      });

    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: 'There was an error generating the export. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport('csv')}
        disabled={isExporting !== null}
        className="text-xs"
      >
        {isExporting === 'csv' ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Download className="h-3 w-3 mr-1" />
        )}
        CSV
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport('xlsx')}
        disabled={isExporting !== null}
        className="text-xs"
      >
        {isExporting === 'xlsx' ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-3 w-3 mr-1" />
        )}
        XLSX
      </Button>

      {reportType === 'customer-statements' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport('pdf')}
          disabled={isExporting !== null}
          className="text-xs"
        >
          {isExporting === 'pdf' ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <FileText className="h-3 w-3 mr-1" />
          )}
          PDF
        </Button>
      )}
    </div>
  );
};