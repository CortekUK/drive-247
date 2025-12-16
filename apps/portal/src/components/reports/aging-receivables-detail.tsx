import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface AgingReceivablesDetailProps {
  isOpen: boolean;
}

export const AgingReceivablesDetail: React.FC<AgingReceivablesDetailProps> = ({ isOpen }) => {
  const { data: agingData, isLoading } = useQuery({
    queryKey: ['aging-receivables-detail'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('view_aging_receivables')
        .select('*')
        .order('total_due', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen
  });

  const formatCurrency = (value: number) => {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getBucketIcon = (bucket: string) => {
    switch (bucket) {
      case '0-30':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case '31-60':
        return <Clock className="h-4 w-4 text-orange-500" />;
      case '61-90':
        return <Clock className="h-4 w-4 text-red-500" />;
      case '90+':
        return <AlertTriangle className="h-4 w-4 text-red-700" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getBucketColor = (days: string) => {
    switch (days) {
      case '0-30':
        return 'bg-yellow-100 text-yellow-800';
      case '31-60':
        return 'bg-orange-100 text-orange-800';
      case '61-90':
        return 'bg-red-100 text-red-800';
      case '90+':
        return 'bg-red-200 text-red-900';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {agingData && (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">0-30 Days</div>
                    <div className="font-semibold">
                      {formatCurrency(
                        agingData.reduce((sum, item) => sum + (Number(item.bucket_0_30) || 0), 0)
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">31-60 Days</div>
                    <div className="font-semibold">
                      {formatCurrency(
                        agingData.reduce((sum, item) => sum + (Number(item.bucket_31_60) || 0), 0)
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-red-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">61-90 Days</div>
                    <div className="font-semibold">
                      {formatCurrency(
                        agingData.reduce((sum, item) => sum + (Number(item.bucket_61_90) || 0), 0)
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="h-4 w-4 text-red-700" />
                  <div>
                    <div className="text-xs text-muted-foreground">90+ Days</div>
                    <div className="font-semibold">
                      {formatCurrency(
                        agingData.reduce((sum, item) => sum + (Number(item.bucket_90_plus) || 0), 0)
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Detailed Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Customer Aging Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">0-30 Days</TableHead>
                  <TableHead className="text-right">31-60 Days</TableHead>
                  <TableHead className="text-right">61-90 Days</TableHead>
                  <TableHead className="text-right">90+ Days</TableHead>
                  <TableHead className="text-right">Total Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agingData?.map((customer, index) => {
                  const worstBucket = Number(customer.bucket_90_plus) > 0 ? '90+' :
                                    Number(customer.bucket_61_90) > 0 ? '61-90' :
                                    Number(customer.bucket_31_60) > 0 ? '31-60' : '0-30';
                  
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {getBucketIcon(worstBucket)}
                          {customer.customer_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.bucket_0_30 ? formatCurrency(Number(customer.bucket_0_30)) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.bucket_31_60 ? formatCurrency(Number(customer.bucket_31_60)) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.bucket_61_90 ? formatCurrency(Number(customer.bucket_61_90)) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.bucket_90_plus ? formatCurrency(Number(customer.bucket_90_plus)) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(Number(customer.total_due))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};