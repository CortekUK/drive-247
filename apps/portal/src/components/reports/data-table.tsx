import React, { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import type { ReportFilters } from '@/pages/Reports';

interface DataTableProps {
  reportType: string;
  filters: ReportFilters;
}

const ROWS_PER_PAGE = 50;

export const DataTable: React.FC<DataTableProps> = ({ reportType, filters }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['report-data', reportType, filters, currentPage],
    queryFn: async () => {
      const fromDate = format(filters.fromDate, 'yyyy-MM-dd');
      const toDate = format(filters.toDate, 'yyyy-MM-dd');
      const offset = (currentPage - 1) * ROWS_PER_PAGE;

      switch (reportType) {
        case 'payments': {
          let query = supabase
            .from('view_payments_export')
            .select('*')
            .gte('payment_date', fromDate)
            .lte('payment_date', toDate)
            .range(offset, offset + ROWS_PER_PAGE - 1);

          if (filters.customers.length > 0) {
            query = query.in('customer_id', filters.customers);
          }
          if (filters.vehicles.length > 0) {
            query = query.in('vehicle_id', filters.vehicles);
          }
          if (filters.paymentTypes.length > 0) {
            query = query.in('payment_type', filters.paymentTypes);
          }

          const { data, error } = await query;
          if (error) throw error;
          return data;
        }

        case 'pl-report': {
          const { data, error } = await supabase
            .from('view_pl_by_vehicle')
            .select('*')
            .range(offset, offset + ROWS_PER_PAGE - 1);
          if (error) throw error;
          return data;
        }

        case 'rentals': {
          let query = supabase
            .from('view_rentals_export')
            .select('*')
            .gte('start_date', fromDate)
            .lte('start_date', toDate)
            .range(offset, offset + ROWS_PER_PAGE - 1);

          if (filters.customers.length > 0) {
            // Note: would need to join on customer name for this filter
          }

          const { data, error } = await query;
          if (error) throw error;
          return data;
        }

        case 'customer-statements': {
          let query = supabase
            .from('view_customer_statements')
            .select('*')
            .gte('entry_date', fromDate)
            .lte('entry_date', toDate)
            .range(offset, offset + ROWS_PER_PAGE - 1);

          if (filters.customers.length > 0) {
            query = query.in('customer_id', filters.customers);
          }

          const { data, error } = await query;
          if (error) throw error;
          return data;
        }

        case 'fines': {
          let query = supabase
            .from('view_fines_export')
            .select('*')
            .gte('issue_date', fromDate)
            .lte('issue_date', toDate)
            .range(offset, offset + ROWS_PER_PAGE - 1);

          if (filters.customers.length > 0) {
            // Filtering will need to be done by customer_name for this view
          }

          const { data, error } = await query;
          if (error) throw error;
          return data;
        }

        case 'aging': {
          const { data, error } = await supabase
            .from('view_aging_receivables')
            .select('*')
            .range(offset, offset + ROWS_PER_PAGE - 1);
          if (error) throw error;
          return data;
        }

        default:
          return [];
      }
    }
  });

  const getColumns = () => {
    switch (reportType) {
      case 'payments':
        return [
          { key: 'payment_date', label: 'Date', type: 'date' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'payment_type', label: 'Type' },
          { key: 'method', label: 'Method' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'applied_amount', label: 'Applied', type: 'currency' },
          { key: 'unapplied_amount', label: 'Unapplied', type: 'currency' }
        ];
      case 'pl-report':
        return [
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'make_model', label: 'Make/Model' },
          { key: 'revenue_rental', label: 'Rental Revenue', type: 'currency' },
          { key: 'revenue_fees', label: 'Fee Revenue', type: 'currency' },
          { key: 'cost_acquisition', label: 'Acquisition Cost', type: 'currency' },
          { key: 'total_revenue', label: 'Total Revenue', type: 'currency' },
          { key: 'total_costs', label: 'Total Costs', type: 'currency' },
          { key: 'net_profit', label: 'Net Profit', type: 'currency' }
        ];
      case 'rentals':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'start_date', label: 'Start Date', type: 'date' },
          { key: 'end_date', label: 'End Date', type: 'date' },
          { key: 'monthly_amount', label: 'Monthly Amount', type: 'currency' },
          { key: 'status', label: 'Status' },
          { key: 'balance', label: 'Balance', type: 'currency' }
        ];
      case 'customer-statements':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'entry_date', label: 'Date', type: 'date' },
          { key: 'type', label: 'Type' },
          { key: 'category', label: 'Category' },
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'transaction_amount', label: 'Amount', type: 'currency' },
          { key: 'running_balance', label: 'Balance', type: 'currency' }
        ];
      case 'fines':
        return [
          { key: 'reference_no', label: 'Reference' },
          { key: 'type', label: 'Type' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'vehicle_reg', label: 'Vehicle' },
          { key: 'issue_date', label: 'Issue Date', type: 'date' },
          { key: 'due_date', label: 'Due Date', type: 'date' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'remaining_amount', label: 'Remaining', type: 'currency' },
          { key: 'liability', label: 'Liability' },
          { key: 'status', label: 'Status' },
          { key: 'appeal_status', label: 'Appeal Status' }
        ];
      case 'aging':
        return [
          { key: 'customer_name', label: 'Customer' },
          { key: 'bucket_0_30', label: '0-30 Days', type: 'currency' },
          { key: 'bucket_31_60', label: '31-60 Days', type: 'currency' },
          { key: 'bucket_61_90', label: '61-90 Days', type: 'currency' },
          { key: 'bucket_90_plus', label: '90+ Days', type: 'currency' },
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

  const getTotals = () => {
    if (!data || data.length === 0) return null;

    const columns = getColumns();
    const totals: Record<string, number> = {};

    columns.forEach(column => {
      if (column.type === 'currency') {
        totals[column.key] = data.reduce((sum, row) => {
          const value = Number(row[column.key]) || 0;
          return sum + value;
        }, 0);
      }
    });

    return totals;
  };

  const columns = getColumns();
  const totals = getTotals();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 bg-muted rounded w-full"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="capitalize">{reportType.replace('-', ' ')} Report</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-2" />
              Columns
            </Button>
            <Badge variant="outline">
              Page {currentPage} • {data?.length || 0} rows
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Header Totals */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
            {Object.entries(totals).slice(0, 4).map(([key, value]) => {
              const column = columns.find(c => c.key === key);
              return (
                <div key={key} className="text-center">
                  <div className="text-sm text-muted-foreground">{column?.label}</div>
                  <div className="font-semibold">{formatValue(value, column?.type)}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Data Table */}
        <div className="border rounded-lg overflow-hidden">
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
              {data?.map((row, index) => (
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
        </div>

        {/* Footer Totals */}
        {totals && (
          <div className="mt-4 p-4 bg-muted/30 rounded-lg">
            <div className="font-medium text-sm mb-2">Totals (Current Page)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {Object.entries(totals).map(([key, value]) => {
                const column = columns.find(c => c.key === key);
                return (
                  <div key={key}>
                    <span className="text-muted-foreground">{column?.label}: </span>
                    <span className="font-medium">{formatValue(value, column?.type)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>
          
          <span className="text-sm text-muted-foreground">
            Page {currentPage}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            disabled={!data || data.length < ROWS_PER_PAGE}
            onClick={() => setCurrentPage(prev => prev + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};