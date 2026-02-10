'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Loader2, ImageIcon, GripVertical, Star, X, MoreHorizontal, Pencil, Trash2, Power, AlertTriangle, PackagePlus } from 'lucide-react';
import { useRentalExtras, type RentalExtra } from '@/hooks/use-rental-extras';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ExtraFormData {
  name: string;
  description: string;
  price: string;
  image_urls: string[];
  max_quantity: string;
  is_quantity_based: boolean;
  is_active: boolean;
}

const EMPTY_FORM: ExtraFormData = {
  name: '',
  description: '',
  price: '',
  image_urls: [],
  max_quantity: '10',
  is_quantity_based: false,
  is_active: true,
};

function isLowStock(extra: RentalExtra): boolean {
  if (extra.max_quantity === null || extra.max_quantity === 0) return false;
  const remaining = extra.remaining_stock ?? extra.max_quantity;
  return remaining / extra.max_quantity < 0.2;
}

function getRowClassName(extra: RentalExtra): string {
  if (!extra.is_active) return '!bg-yellow-500/10';
  if (extra.max_quantity !== null && isLowStock(extra)) return '!bg-red-500/8';
  return '!bg-emerald-500/10';
}

function SortableImage({
  url,
  index,
  onRemove,
}: {
  url: string;
  index: number;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: url });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group flex-shrink-0 ${index === 0 ? 'ring-2 ring-primary rounded-lg' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute top-0 left-0 right-0 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing bg-black/40 rounded-t-lg opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-3 w-3 text-white" />
      </div>
      <img
        src={url}
        alt={`Image ${index + 1}`}
        className="w-20 h-20 rounded-lg object-cover border"
      />
      {index === 0 && (
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Star className="h-3 w-3" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ExtrasSettings() {
  const { tenant } = useTenant();
  const {
    extras,
    isLoading,
    createExtra,
    isCreating,
    updateExtra,
    isUpdating,
    deleteExtra,
    isDeleting,
  } = useRentalExtras();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExtra, setEditingExtra] = useState<RentalExtra | null>(null);
  const [formData, setFormData] = useState<ExtraFormData>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RentalExtra | null>(null);
  const [stockTarget, setStockTarget] = useState<RentalExtra | null>(null);
  const [stockValue, setStockValue] = useState('');
  const notifiedRef = useRef(false);

  // Notify admin about low stock items
  useEffect(() => {
    if (notifiedRef.current || !extras.length) return;
    const lowStockItems = extras.filter((e) => e.is_active && isLowStock(e));
    if (lowStockItems.length > 0) {
      notifiedRef.current = true;
      toast({
        title: 'Low Stock Alert',
        description: `${lowStockItems.map((e) => e.name).join(', ')} ${lowStockItems.length === 1 ? 'is' : 'are'} below 20% stock. Consider restocking.`,
        variant: 'destructive',
      });
    }
  }, [extras]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleOpenAdd = () => {
    setEditingExtra(null);
    setFormData(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (extra: RentalExtra) => {
    setEditingExtra(extra);
    setFormData({
      name: extra.name,
      description: extra.description || '',
      price: String(extra.price),
      image_urls: extra.image_urls || [],
      max_quantity: extra.max_quantity ? String(extra.max_quantity) : '10',
      is_quantity_based: extra.max_quantity !== null,
      is_active: extra.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop();
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('rental-extras-images')
          .upload(path, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('rental-extras-images')
          .getPublicUrl(path);

        newUrls.push(urlData.publicUrl);
      }
      setFormData((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...newUrls] }));
    } catch (err: any) {
      toast({
        title: 'Upload Failed',
        description: err.message || 'Failed to upload image',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveImage = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      image_urls: prev.image_urls.filter((_, i) => i !== index),
    }));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setFormData((prev) => {
      const oldIndex = prev.image_urls.indexOf(active.id as string);
      const newIndex = prev.image_urls.indexOf(over.id as string);
      return { ...prev, image_urls: arrayMove(prev.image_urls, oldIndex, newIndex) };
    });
  }, []);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Error', description: 'Name is required.', variant: 'destructive' });
      return;
    }
    if (formData.image_urls.length === 0) {
      toast({ title: 'Error', description: 'At least one image is required.', variant: 'destructive' });
      return;
    }
    const price = parseFloat(formData.price);
    if (isNaN(price) || price < 0) {
      toast({ title: 'Error', description: 'Price must be a valid positive number.', variant: 'destructive' });
      return;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      price,
      image_urls: formData.image_urls,
      max_quantity: formData.is_quantity_based ? parseInt(formData.max_quantity) || 1 : null,
      is_active: formData.is_active,
    };

    try {
      if (editingExtra) {
        await updateExtra({ id: editingExtra.id, ...payload });
      } else {
        await createExtra(payload);
      }
      setIsDialogOpen(false);
    } catch {
      // Error handled by mutation callbacks
    }
  };

  const handleToggleActive = async (extra: RentalExtra) => {
    try {
      await updateExtra({ id: extra.id, is_active: !extra.is_active });
    } catch {
      // Error handled by mutation callbacks
    }
  };

  const handleUpdateStock = async (id: string, newMaxQuantity: number) => {
    try {
      await updateExtra({ id, max_quantity: newMaxQuantity });
    } catch {
      // Error handled by mutation callbacks
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExtra(id);
      setDeleteTarget(null);
    } catch {
      // Error handled by mutation callbacks
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Rental Extras</CardTitle>
              <CardDescription>
                Manage optional add-ons customers can select during booking (GPS, baby seats, drinks, etc.)
              </CardDescription>
            </div>
            <Button onClick={handleOpenAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Extra
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {extras.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No extras configured yet.</p>
              <p className="text-xs mt-1">Add extras that customers can select during booking.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Image</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extras.map((extra) => {
                  const lowStock = isLowStock(extra);
                  return (
                    <TableRow key={extra.id} className={getRowClassName(extra)}>
                      <TableCell>
                        {extra.image_urls.length > 0 ? (
                          <div className="relative">
                            <img
                              src={extra.image_urls[0]}
                              alt={extra.name}
                              className="w-10 h-10 rounded object-cover"
                            />
                            {extra.image_urls.length > 1 && (
                              <span className="absolute -bottom-1 -right-1 text-[10px] font-medium bg-muted border rounded-full w-4 h-4 flex items-center justify-center">
                                {extra.image_urls.length}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {extra.name}
                          {lowStock && extra.is_active && (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                        <span className="block max-w-[200px] truncate">
                          {extra.description || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold">{formatCurrency(Number(extra.price), tenant?.currency_code || 'USD')}</TableCell>
                      <TableCell>
                        {extra.max_quantity !== null ? (
                          <Badge variant="secondary">Quantity</Badge>
                        ) : (
                          <Badge variant="outline">Add-on</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {extra.max_quantity !== null ? (
                          <div className="text-sm">
                            <span className={`font-medium ${
                              extra.remaining_stock === 0
                                ? 'text-red-600'
                                : lowStock
                                  ? 'text-red-500'
                                  : ''
                            }`}>
                              {extra.remaining_stock} left
                            </span>
                            <span className="text-muted-foreground"> / {extra.max_quantity}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {extra.is_active ? (
                          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/20 text-xs">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEdit(extra)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            {extra.max_quantity !== null && (
                              <DropdownMenuItem onClick={() => { setStockTarget(extra); setStockValue(''); }}>
                                <PackagePlus className="h-3.5 w-3.5 mr-2" />
                                Update Stock
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleToggleActive(extra)}>
                              <Power className="h-3.5 w-3.5 mr-2" />
                              {extra.is_active ? 'Deactive' : 'Activate'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(extra)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
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
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this extra. Existing bookings with this extra will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Update Stock Dialog */}
      <Dialog open={!!stockTarget} onOpenChange={(open) => !open && setStockTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Stock</DialogTitle>
            <DialogDescription>
              Add stock to &quot;{stockTarget?.name}&quot;. Current total: {stockTarget?.max_quantity ?? 0}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Add Quantity</Label>
              <Input
                type="number"
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const add = parseInt(stockValue);
                    if (!isNaN(add) && add > 0 && stockTarget) {
                      handleUpdateStock(stockTarget.id, (stockTarget.max_quantity || 0) + add);
                      setStockTarget(null);
                    }
                  }
                }}
                min={1}
                placeholder="e.g. 10"
                autoFocus
              />
            </div>
            {stockValue && parseInt(stockValue) > 0 && (
              <p className="text-xs text-muted-foreground">
                New total will be: {(stockTarget?.max_quantity || 0) + parseInt(stockValue)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const add = parseInt(stockValue);
                if (!isNaN(add) && add > 0 && stockTarget) {
                  handleUpdateStock(stockTarget.id, (stockTarget.max_quantity || 0) + add);
                  setStockTarget(null);
                }
              }}
              disabled={isUpdating || !stockValue || parseInt(stockValue) <= 0}
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingExtra ? 'Edit Extra' : 'Add Extra'}
            </DialogTitle>
            <DialogDescription>
              {editingExtra
                ? 'Update the rental extra details'
                : 'Add a new optional extra for customers'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Row 1: Name + Price */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., GPS Navigation"
                />
              </div>
              <div className="space-y-2">
                <Label>Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData((p) => ({ ...p, price: e.target.value }))}
                    className="pl-7"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Description */}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description of the extra"
                rows={2}
              />
            </div>

            {/* Row 3: Images */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Images *</Label>
                <p className="text-xs text-muted-foreground">
                  {formData.image_urls.length > 1
                    ? 'Drag to reorder. First image is the banner.'
                    : 'Upload multiple images. At least one is required.'}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {formData.image_urls.length > 0 && (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={formData.image_urls} strategy={horizontalListSortingStrategy}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {formData.image_urls.map((url, i) => (
                          <SortableImage
                            key={url}
                            url={url}
                            index={i}
                            onRemove={() => handleRemoveImage(i)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors flex-shrink-0">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Plus className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Row 4: Toggles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-lg border p-2.5">
                <div>
                  <Label className="text-sm font-medium">Quantity-based</Label>
                  <p className="text-xs text-muted-foreground">Multiple units</p>
                </div>
                <div className="flex items-center gap-2">
                  {formData.is_quantity_based && (
                    <div className="relative w-16">
                      <Input
                        type="number"
                        value={formData.max_quantity}
                        onChange={(e) => setFormData((p) => ({ ...p, max_quantity: e.target.value }))}
                        className="h-7 text-xs text-center px-1"
                        min={1}
                        placeholder="10"
                      />
                    </div>
                  )}
                  <Switch
                    checked={formData.is_quantity_based}
                    onCheckedChange={(checked) =>
                      setFormData((p) => ({ ...p, is_quantity_based: checked }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-2.5">
                <div>
                  <Label className="text-sm font-medium">Active</Label>
                  <p className="text-xs text-muted-foreground">Visible to customers</p>
                </div>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData((p) => ({ ...p, is_active: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isCreating || isUpdating || uploading}>
              {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingExtra ? 'Save Changes' : 'Add Extra'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
