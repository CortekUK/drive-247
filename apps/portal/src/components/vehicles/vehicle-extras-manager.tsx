'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Loader2, ImageIcon, Trash2, Pencil } from 'lucide-react';
import { useVehicleExtras } from '@/hooks/use-vehicle-extras';
import { useRentalExtras } from '@/hooks/use-rental-extras';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';

interface VehicleExtrasManagerProps {
  vehicleId: string;
}

export function VehicleExtrasManager({ vehicleId }: VehicleExtrasManagerProps) {
  const { tenant } = useTenant();
  const { vehicleExtras, isLoading, upsertVehicleExtraPrice, isUpserting, removeVehicleExtraPrice, isRemoving } = useVehicleExtras(vehicleId);
  const { extras: allExtras } = useRentalExtras();

  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedExtraId, setSelectedExtraId] = useState('');
  const [assignPrice, setAssignPrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const perVehicleExtras = allExtras.filter((e) => e.pricing_type === 'per_vehicle');
  const globalExtras = allExtras.filter((e) => e.pricing_type === 'global' && e.is_active);
  const assignedExtraIds = new Set(vehicleExtras.map((ve) => ve.extra_id));
  const availableExtras = perVehicleExtras.filter((e) => !assignedExtraIds.has(e.id));

  const handleAssign = async () => {
    const price = parseFloat(assignPrice);
    if (!selectedExtraId || isNaN(price) || price < 0) return;
    try {
      await upsertVehicleExtraPrice({ extraId: selectedExtraId, price });
      setShowAssignDialog(false);
      setSelectedExtraId('');
      setAssignPrice('');
    } catch {
      // Error handled by mutation
    }
  };

  const handleUpdatePrice = async (extraId: string) => {
    const price = parseFloat(editPrice);
    if (isNaN(price) || price < 0) return;
    try {
      await upsertVehicleExtraPrice({ extraId, price });
      setEditingId(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleRemove = async (extraId: string) => {
    try {
      await removeVehicleExtraPrice(extraId);
      setRemoveTarget(null);
    } catch {
      // Error handled by mutation
    }
  };

  if (isLoading) {
    return (
      <div className="py-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-Vehicle Extras */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Per-vehicle extras assigned to this vehicle
        </p>
        {availableExtras.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setShowAssignDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Assign Extra
          </Button>
        )}
      </div>

      {vehicleExtras.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Image</TableHead>
              <TableHead>Extra</TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="text-right w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicleExtras.map((ve) => (
              <TableRow key={ve.id}>
                <TableCell>
                  {ve.extra_image_urls.length > 0 ? (
                    <img src={ve.extra_image_urls[0]} alt={ve.extra_name} className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium text-sm">
                  {ve.extra_name}
                  {!ve.extra_is_active && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === ve.extra_id ? (
                    <div className="flex items-center gap-1.5">
                      <div className="relative w-20">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="h-7 text-sm pl-5"
                          min={0}
                          step={0.01}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdatePrice(ve.extra_id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      </div>
                      <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleUpdatePrice(ve.extra_id)} disabled={isUpserting}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <span className="font-semibold text-sm">{formatCurrency(ve.price, tenant?.currency_code || 'USD')}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setEditingId(ve.extra_id); setEditPrice(String(ve.price)); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setRemoveTarget(ve.extra_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          No per-vehicle extras assigned. {availableExtras.length > 0 ? 'Click "Assign Extra" to add one.' : 'Create per-vehicle extras in Settings first.'}
        </p>
      )}

      {/* Global Extras (read-only) */}
      {globalExtras.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Global Extras (all vehicles)</p>
          <div className="flex flex-wrap gap-2">
            {globalExtras.map((ge) => (
              <Badge key={ge.id} variant="outline" className="gap-1.5 py-1">
                {ge.name}
                <span className="text-muted-foreground">{formatCurrency(Number(ge.price), tenant?.currency_code || 'USD')}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Assign Extra Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Extra</DialogTitle>
            <DialogDescription>Select a per-vehicle extra and set its price for this vehicle.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Extra</Label>
              <Select value={selectedExtraId} onValueChange={setSelectedExtraId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an extra..." />
                </SelectTrigger>
                <SelectContent>
                  {availableExtras.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Price for this vehicle</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={assignPrice}
                  onChange={(e) => setAssignPrice(e.target.value)}
                  className="pl-7"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={isUpserting || !selectedExtraId || !assignPrice}>
              {isUpserting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove extra from this vehicle?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the per-vehicle pricing for this extra. The extra will no longer appear for this vehicle in booking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && handleRemove(removeTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isRemoving}
            >
              {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
