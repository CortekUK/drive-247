'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Zap, MapPin, Clock, BatteryCharging } from 'lucide-react';
import { TeslaLogo } from '@/components/icons/tesla-logo';
import { formatCurrency } from '@/lib/format-utils';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { SuperchargerCharge } from '@/hooks/use-tesla-supercharger-charges';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SuperchargerChargesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charges: SuperchargerCharge[];
  totalAmount: number;
  pendingCount: number;
  currencyCode: string;
  isSyncing: boolean;
  onSync: () => void;
  onWaive: (chargeId: string) => void;
  onCharge: (charge: SuperchargerCharge) => void;
}

export function SuperchargerChargesDialog({
  open,
  onOpenChange,
  charges,
  totalAmount,
  pendingCount,
  currencyCode,
  isSyncing,
  onSync,
  onWaive,
  onCharge,
}: SuperchargerChargesDialogProps) {
  const [waiveConfirmId, setWaiveConfirmId] = useState<string | null>(null);

  const pendingTotal = charges
    .filter(c => c.status === 'pending')
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const chargedTotal = charges
    .filter(c => c.status === 'charged')
    .reduce((sum, c) => sum + Number(c.charged_amount || c.amount), 0);
  const waivedTotal = charges
    .filter(c => c.status === 'waived')
    .reduce((sum, c) => sum + Number(c.amount), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">Pending</Badge>;
      case 'charged':
        return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30">Charged</Badge>;
      case 'waived':
        return <Badge variant="outline" className="text-gray-500 border-gray-300 bg-gray-50 dark:bg-gray-950/30">Waived</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <TeslaLogo size={20} className="text-red-500" />
              </div>
              Supercharger Charges
              {pendingCount > 0 && (
                <Badge className="bg-amber-500 hover:bg-amber-600 ml-2">{pendingCount} pending</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Tesla Supercharger sessions detected during this rental
            </DialogDescription>
          </DialogHeader>

          {/* Refresh Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                {charges.length} session{charges.length !== 1 ? 's' : ''} total
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="gap-2"
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>

          {/* Charges Table */}
          {charges.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <BatteryCharging className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No Supercharger sessions found</p>
              <p className="text-xs mt-1">Click Refresh to check for new charges</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-red-50/50 dark:bg-red-950/20">
                    <TableHead className="text-xs font-medium">Date & Time</TableHead>
                    <TableHead className="text-xs font-medium">Location</TableHead>
                    <TableHead className="text-xs font-medium text-center">kWh</TableHead>
                    <TableHead className="text-xs font-medium text-right">Tesla Cost</TableHead>
                    <TableHead className="text-xs font-medium text-center">Status</TableHead>
                    <TableHead className="text-xs font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.map((charge) => (
                    <TableRow key={charge.id} className="text-sm">
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{format(new Date(charge.charge_date), 'MMM d, yyyy')}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(charge.charge_date), 'h:mm a')}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[180px]">{charge.location || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {charge.kwh_used != null ? (
                          <span className="font-mono text-xs">{Number(charge.kwh_used).toFixed(1)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(Number(charge.amount), currencyCode)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(charge.status)}
                      </TableCell>
                      <TableCell className="text-right">
                        {charge.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs gap-1"
                              onClick={() => onCharge(charge)}
                            >
                              <Zap className="h-3 w-3" />
                              Charge
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => setWaiveConfirmId(charge.id)}
                            >
                              Waive
                            </Button>
                          </div>
                        )}
                        {charge.status === 'charged' && (
                          <span className="text-xs text-green-600 font-medium">
                            {formatCurrency(Number(charge.charged_amount || charge.amount), currencyCode)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary Footer */}
          {charges.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t text-sm">
              <div className="flex items-center gap-4">
                {pendingTotal > 0 && (
                  <span className="text-amber-600">
                    Pending: {formatCurrency(pendingTotal, currencyCode)}
                  </span>
                )}
                {chargedTotal > 0 && (
                  <span className="text-green-600">
                    Charged: {formatCurrency(chargedTotal, currencyCode)}
                  </span>
                )}
                {waivedTotal > 0 && (
                  <span className="text-muted-foreground">
                    Waived: {formatCurrency(waivedTotal, currencyCode)}
                  </span>
                )}
              </div>
              <span className="font-semibold">
                Total: {formatCurrency(totalAmount, currencyCode)}
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Waive Confirmation */}
      <AlertDialog open={!!waiveConfirmId} onOpenChange={(open) => !open && setWaiveConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Waive Supercharger Charge?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the charge as waived and the customer will not be billed for it. This action can be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (waiveConfirmId) {
                  onWaive(waiveConfirmId);
                  setWaiveConfirmId(null);
                }
              }}
            >
              Waive Charge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
