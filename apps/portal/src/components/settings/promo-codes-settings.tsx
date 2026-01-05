'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Ticket, Plus, MoreHorizontal, Pencil, Trash2, Copy, Loader2 } from 'lucide-react';
import { format, isPast, isFuture, parseISO } from 'date-fns';
import { usePromoCodes, PromoCode } from '@/hooks/use-promo-codes';
import { PromoCodeDialog } from './promo-code-dialog';
import { toast } from '@/hooks/use-toast';

export const PromoCodesSettings = () => {
  const { promoCodes, isLoading, deletePromoCode, togglePromoCodeStatus } = usePromoCodes();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromoCode, setEditingPromoCode] = useState<PromoCode | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promoToDelete, setPromoToDelete] = useState<PromoCode | null>(null);

  const handleEdit = (promo: PromoCode) => {
    setEditingPromoCode(promo);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingPromoCode(null);
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingPromoCode(null);
  };

  const handleDelete = (promo: PromoCode) => {
    setPromoToDelete(promo);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (promoToDelete) {
      await deletePromoCode.mutateAsync(promoToDelete.id);
      setDeleteDialogOpen(false);
      setPromoToDelete(null);
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied!",
      description: `Promo code "${code}" copied to clipboard.`,
    });
  };

  const getPromoStatus = (promo: PromoCode) => {
    if (!promo.is_active) return { label: 'Inactive', variant: 'secondary' as const };
    const startDate = parseISO(promo.start_date);
    const endDate = parseISO(promo.end_date);

    if (isPast(endDate)) return { label: 'Expired', variant: 'destructive' as const };
    if (isFuture(startDate)) return { label: 'Scheduled', variant: 'outline' as const };
    return { label: 'Active', variant: 'default' as const };
  };

  const formatDiscount = (promo: PromoCode) => {
    if (promo.discount_type === 'percentage') {
      return `${promo.discount_value}%`;
    }
    return `$${promo.discount_value.toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading promo codes...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-primary" />
                Promo Codes
              </CardTitle>
              <CardDescription>
                Create and manage promotional discount codes for your customers
              </CardDescription>
            </div>
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Promo Code
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {promoCodes.length === 0 ? (
            <div className="text-center py-12">
              <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Promo Codes</h3>
              <p className="text-muted-foreground mb-4">
                Create your first promo code to offer discounts to customers.
              </p>
              <Button onClick={handleCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Create Promo Code
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Valid Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-[70px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promoCodes.map((promo) => {
                    const status = getPromoStatus(promo);
                    return (
                      <TableRow key={promo.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                              {promo.promo_code || '-'}
                            </code>
                            {promo.promo_code && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(promo.promo_code!)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{promo.title}</div>
                            <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {promo.description}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {formatDiscount(promo)}
                            {promo.discount_type === 'percentage' ? ' off' : ' off'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{format(parseISO(promo.start_date), 'MMM dd, yyyy')}</div>
                            <div className="text-muted-foreground">
                              to {format(parseISO(promo.end_date), 'MMM dd, yyyy')}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={promo.is_active ?? false}
                            onCheckedChange={(checked) =>
                              togglePromoCodeStatus.mutate({ id: promo.id, is_active: checked })
                            }
                            disabled={togglePromoCodeStatus.isPending}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(promo)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(promo)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <PromoCodeDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        promoCode={editingPromoCode}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Promo Code?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the promo code "{promoToDelete?.promo_code}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePromoCode.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
