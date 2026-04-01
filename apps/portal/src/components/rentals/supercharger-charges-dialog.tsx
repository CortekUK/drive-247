'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Zap, MapPin, BatteryCharging } from 'lucide-react';
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
        return <span className="text-xs font-medium text-amber-500">Pending</span>;
      case 'charged':
        return <span className="text-xs font-medium text-green-500">Charged</span>;
      case 'waived':
        return <span className="text-xs font-medium text-muted-foreground line-through">Waived</span>;
      default:
        return <span className="text-xs text-muted-foreground">{status}</span>;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[800px] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <DialogHeader className="p-0 space-y-0">
              <DialogTitle className="flex items-center gap-2.5 text-lg">
                <TeslaLogo size={22} className="text-red-500" />
                Supercharger Charges
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {charges.length} session{charges.length !== 1 ? 's' : ''} detected during this rental
              </p>
            </DialogHeader>
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="gap-1.5 h-8 text-xs shrink-0"
            >
              {isSyncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </Button>
          </div>

          {/* Content */}
          <div className="max-h-[60vh] overflow-y-auto">
            {charges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BatteryCharging className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No Supercharger sessions found</p>
                <p className="text-xs mt-1">Click Refresh to check for new charges</p>
              </div>
            ) : (
              <div className="divide-y">
                {charges.map((charge) => (
                  <div key={charge.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30 transition-colors">
                    {/* Date */}
                    <div className="w-[100px] shrink-0">
                      <p className="text-sm font-medium">{format(new Date(charge.charge_date), 'MMM d, yyyy')}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(charge.charge_date), 'h:mm a')}</p>
                    </div>

                    {/* Location */}
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{charge.location || 'Unknown location'}</span>
                    </div>

                    {/* kWh */}
                    <div className="w-[50px] text-center shrink-0">
                      {charge.kwh_used != null ? (
                        <span className="text-sm tabular-nums">{Number(charge.kwh_used).toFixed(1)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      <p className="text-[10px] text-muted-foreground">kWh</p>
                    </div>

                    {/* Amount */}
                    <div className="w-[70px] text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{formatCurrency(Number(charge.amount), currencyCode)}</p>
                    </div>

                    {/* Status */}
                    <div className="w-[55px] text-center shrink-0">
                      {getStatusBadge(charge.status)}
                    </div>

                    {/* Actions */}
                    <div className="w-[120px] flex items-center justify-end gap-1 shrink-0">
                      {charge.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 bg-red-600 hover:bg-red-700"
                            onClick={() => onCharge(charge)}
                          >
                            <Zap className="h-3 w-3" />
                            Charge
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setWaiveConfirmId(charge.id)}
                          >
                            Waive
                          </Button>
                        </>
                      )}
                      {charge.status === 'charged' && (
                        <span className="text-xs text-green-500 font-medium">
                          {formatCurrency(Number(charge.charged_amount || charge.amount), currencyCode)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {charges.length > 0 && (
            <div className="flex items-center justify-between px-6 py-3 border-t bg-muted/20">
              <div className="flex items-center gap-4 text-xs">
                {pendingTotal > 0 && (
                  <span className="text-amber-500 font-medium">
                    Pending: {formatCurrency(pendingTotal, currencyCode)}
                  </span>
                )}
                {chargedTotal > 0 && (
                  <span className="text-green-500 font-medium">
                    Charged: {formatCurrency(chargedTotal, currencyCode)}
                  </span>
                )}
                {waivedTotal > 0 && (
                  <span className="text-muted-foreground">
                    Waived: {formatCurrency(waivedTotal, currencyCode)}
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold">
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
              This will mark the charge as waived and the customer will not be billed for it.
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
