import React from 'react';
import { format } from 'date-fns';
import { X, FileText, Download, FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ReportFilters } from '@/pages/Reports';

interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string;
  reportTitle: string;
  filters: ReportFilters;
  onExport: (format: 'csv' | 'xlsx' | 'pdf') => void;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  onClose,
  reportId,
  reportTitle,
  filters,
  onExport
}) => {
  const { data: previewData, isLoading } = useQuery({
    queryKey: ['report-preview', reportId, filters],
    queryFn: async () => {
      const fromDate = format(filters.fromDate, 'yyyy-MM-dd');
      const toDate = format(filters.toDate, 'yyyy-MM-dd');

      let query;
      
      switch (reportId) {
        case 'payments':
          query = supabase
            .from('view_payments_export')
            .select('*')
            .gte('payment_date', fromDate)
            .lte('payment_date', toDate)
            .limit(10);
          break;
        
        case 'pl-report':
          query = supabase
            .from('view_pl_by_vehicle')
            .select('*')
            .limit(10);
          break;
        
        case 'rentals':
          query = supabase
            .from('view_rentals_export')
            .select('*')
            .gte('start_date', fromDate)
            .lte('start_date', toDate)
            .limit(10);
          break;
        
        case 'fines':
          query = supabase
            .from('view_fines_export')
            .select('*')
            .gte('issue_date', fromDate)
            .lte('issue_date', toDate)
            .limit(10);
          break;
        
        case 'customer-statements':
          query = supabase
            .from('view_customer_statements')
            .select('*')
            .gte('entry_date', fromDate)
            .lte('entry_date', toDate)
            .limit(10);
          break;
        
        case 'aging':
          query = supabase
            .from('view_aging_receivables')
            .select('*')
            .limit(10);
          break;
        
        default:
          return { data: [], count: 0 };
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
    enabled: isOpen
  });

  const getColumns = () => {
    switch (reportId) {
      case 'payments':
        return [
          { key: 'payment_date', label: 'Date', type: 'date' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'payment_type', label: 'Type' }
        ];
      case 'pl-report':
        return [
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'total_revenue', label: 'Revenue', type: 'currency' },
          { key: 'total_costs', label: 'Costs', type: 'currency' },
          { key: 'net_profit', label: 'Profit', type: 'currency' }
        ];
      case 'rentals':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'monthly_amount', label: 'Monthly', type: 'currency' },
          { key: 'status', label: 'Status' }
        ];
      case 'fines':
        return [
          { key: 'reference_no', label: 'Reference' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'status', label: 'Status' }
        ];
      case 'customer-statements':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'entry_date', label: 'Date', type: 'date' },
          { key: 'type', label: 'Type' },
          { key: 'transaction_amount', label: 'Amount', type: 'currency' }
        ];
      case 'aging':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'bucket_0_30', label: '0-30 Days', type: 'currency' },
          { key: 'bucket_31_60', label: '31-60 Days', type: 'currency' },
          { key: 'total_due', label: 'Total Due', type: 'currency' }
        ];
      default:
        return [];
    }
  };

  const formatValue = (value: any, type?: string) => {
    if (value === null || value === undefined) return '-';
    
    switch (type) {
      case 'currency':
        return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      case 'date':
        return format(new Date(value), 'dd/MM/yyyy');
      default:
        return String(value);
    }
  };

  const getActiveFilters = () => {
    const active = [];
    if (filters.customers.length) active.push(`${filters.customers.length} customers`);
    if (filters.vehicles.length) active.push(`${filters.vehicles.length} vehicles`);
    if (filters.paymentTypes.length) active.push(`${filters.paymentTypes.length} payment types`);
    if (filters.statuses.length) active.push(`${filters.statuses.length} statuses`);
    return active;
  };

  const columns = getColumns();
  const activeFilters = getActiveFilters();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{reportTitle} Preview</span>
            {/* <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button> */}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Filters Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Applied Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">
                  {format(filters.fromDate, 'dd/MM/yyyy')} - {format(filters.toDate, 'dd/MM/yyyy')}
                </Badge>
                {activeFilters.map((filter, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {filter}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sample Data Preview */}
          <Card className="flex-1 min-h-0">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Sample Data (First 10 rows)</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onExport('csv')}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onExport('xlsx')}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    XLSX
                  </Button>
                  {reportId === 'customer-statements' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onExport('pdf')}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      PDF
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-auto">
              {isLoading ? (
                <div className="animate-pulse space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 bg-muted rounded" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((column) => (
                        <TableHead key={column.key} className="font-medium">
                          {column.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData?.data?.slice(0, 10).map((row, index) => (
                      <TableRow key={index}>
                        {columns.map((column) => (
                          <TableCell key={column.key}>
                            {formatValue(row[column.key], column.type)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              
              {previewData?.data?.length === 0 && !isLoading && (
                <div className="text-center py-8 text-muted-foreground">
                  No data found for the selected filters
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};