'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Zap, MapPin, BatteryCharging, Clock } from 'lucide-react';
import { TeslaLogo } from '@/components/icons/tesla-logo';
import { formatCurrency } from '@/lib/format-utils';
import { format } from 'date-fns';
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[540px] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-5 pb-4">
            <DialogHeader className="p-0 space-y-1">
              <DialogTitle className="flex items-center gap-2.5 text-lg">
                <TeslaLogo size={22} className="text-red-500" />
                Supercharger Charges
              </DialogTitle>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {charges.length} session{charges.length !== 1 ? 's' : ''} · {formatCurrency(totalAmount, currencyCode)} total
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSync}
                  disabled={isSyncing}
                  className="gap-1.5 h-7 text-xs text-muted-foreground"
                >
                  {isSyncing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Refresh
                </Button>
              </div>
            </DialogHeader>
          </div>

          {/* Charges List */}
          <div className="max-h-[55vh] overflow-y-auto border-t">
            {charges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BatteryCharging className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No Supercharger sessions found</p>
                <p className="text-xs mt-1">Click Refresh to check for new charges</p>
              </div>
            ) : (
              <div className="divide-y">
                {charges.map((charge) => (
                  <div key={charge.id} className="px-5 py-3.5 hover:bg-muted/30 transition-colors">
                    {/* Top row: location + amount */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-red-400 shrink-0" />
                          <span className="text-sm font-medium">{charge.location || 'Unknown location'}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(charge.charge_date), 'MMM d, yyyy · h:mm a')}
                          </span>
                          {charge.kwh_used != null && (
                            <span className="flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {Number(charge.kwh_used).toFixed(1)} kWh
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-semibold tabular-nums shrink-0">
                        {formatCurrency(Number(charge.amount), currencyCode)}
                      </span>
                    </div>

                    {/* Bottom row: status + actions */}
                    {charge.status === 'pending' && (
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-xs text-amber-500 font-medium">Pending</span>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 bg-red-600 hover:bg-red-700 px-3"
                            onClick={() => onCharge(charge)}
                          >
                            <Zap className="h-3 w-3" />
                            Charge Customer
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
                      </div>
                    )}
                    {charge.status === 'charged' && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-green-500 font-medium">Charged</span>
                        <span className="text-xs text-green-500">
                          Billed {formatCurrency(Number(charge.charged_amount || charge.amount), currencyCode)}
                        </span>
                      </div>
                    )}
                    {charge.status === 'waived' && (
                      <div className="mt-2">
                        <span className="text-xs text-muted-foreground">Waived</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {charges.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t text-xs">
              <div className="flex items-center gap-3">
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
                {formatCurrency(totalAmount, currencyCode)}
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
