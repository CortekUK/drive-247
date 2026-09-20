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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Loader2, ImageIcon, GripVertical, Star, X, MoreHorizontal, Pencil, Trash2, Power, AlertTriangle, PackagePlus, Car } from 'lucide-react';
import { useRentalExtras, type RentalExtra } from '@/hooks/use-rental-extras';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency, getCurrencySymbol } from '@/lib/format-utils';
import { useV2 } from '@/lib/v2-context';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { ExtrasTableV2 } from '@/components/settings-v2/extras-table-v2';
import { Button as ButtonV2 } from '@/components/ui-v2/button';
import { Input as InputV2 } from '@/components/ui-v2/input';
import { Label as LabelV2 } from '@/components/ui-v2/label';
import { Switch as SwitchV2 } from '@/components/ui-v2/switch';
import { Textarea as TextareaV2 } from '@/components/ui-v2/textarea';
import { Select as SelectV2, SelectContent as SelectContentV2, SelectItem as SelectItemV2, SelectTrigger as SelectTriggerV2, SelectValue as SelectValueV2 } from '@/components/ui-v2/select';
import { Dialog as DialogV2, DialogContent as DialogContentV2, DialogDescription as DialogDescriptionV2, DialogFooter as DialogFooterV2, DialogHeader as DialogHeaderV2, DialogTitle as DialogTitleV2 } from '@/components/ui-v2/dialog';
import { AlertDialog as AlertDialogV2, AlertDialogAction as AlertDialogActionV2, AlertDialogCancel as AlertDialogCancelV2, AlertDialogContent as AlertDialogContentV2, AlertDialogDescription as AlertDialogDescriptionV2, AlertDialogFooter as AlertDialogFooterV2, AlertDialogHeader as AlertDialogHeaderV2, AlertDialogTitle as AlertDialogTitleV2 } from '@/components/ui-v2/alert-dialog';
import { Package } from 'lucide-react';
import {
  SettingsDependencyNotice,
  SettingsEmptyState,
  SettingsLoadError,
  SettingsSaveState,
  SettingsSectionSkeleton,
  describeSaveError,
  formatSettingsNumber,
} from '@/components/settings-v2/section-states';
import { getExtraFormIssues, lowStockSentence } from '@/lib/settings-money-states';
import { SETTINGS_SECTION_TITLE } from '@/components/settings-v2/settings-kit';
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

interface VehiclePricingRow {
  vehicle_id: string;
  price: string;
  vehicle_reg?: string;
  vehicle_make?: string;
  vehicle_model?: string;
}

interface ExtraFormData {
  name: string;
  description: string;
  price: string;
  pricing_type: 'global' | 'per_vehicle';
  billing_type: 'per_trip' | 'per_day';
  vehicle_pricing: VehiclePricingRow[];
  image_urls: string[];
  max_quantity: string;
  is_quantity_based: boolean;
  is_active: boolean;
}

const EMPTY_FORM: ExtraFormData = {
  name: '',
  description: '',
  price: '',
  pricing_type: 'global',
  billing_type: 'per_trip',
  vehicle_pricing: [],
  image_urls: [],
  max_quantity: '10',
  is_quantity_based: false,
  is_active: true,
};

/**
 * v2 only: the Add/Edit Extra dialog's option cards and image tiles follow the
 * v2 rounded system (cards and fields `rounded-xl`) and hover light purple,
 * with the --v2-hover tint in dark mode where primary/10 all but vanishes.
 * Every tenant on v1 keeps `rounded-lg` and the grey `hover:bg-muted/50` it
 * has today.
 */
const V2_CARD_RADIUS = 'rounded-xl';
const V2_OPTION_HOVER = 'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]';

/**
 * The parts the four dialogs (Add/Edit, Update Stock, Delete, Discard) are
 * drawn with. v1 keeps exactly the components it always used; the v2 canary
 * gets the v2 ones, so the vehicle dropdown never opens under a v1 dialog.
 * Typed as v1's: every prop the dialogs pass is one both sets accept.
 */
const EXTRAS_DIALOG_UI_V1 = {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Button, Input, Label, Switch, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
};
const EXTRAS_DIALOG_UI_V2 = {
  Dialog: DialogV2, DialogContent: DialogContentV2, DialogDescription: DialogDescriptionV2, DialogFooter: DialogFooterV2, DialogHeader: DialogHeaderV2, DialogTitle: DialogTitleV2,
  AlertDialog: AlertDialogV2, AlertDialogAction: AlertDialogActionV2, AlertDialogCancel: AlertDialogCancelV2, AlertDialogContent: AlertDialogContentV2, AlertDialogDescription: AlertDialogDescriptionV2, AlertDialogFooter: AlertDialogFooterV2, AlertDialogHeader: AlertDialogHeaderV2, AlertDialogTitle: AlertDialogTitleV2,
  Button: ButtonV2, Input: InputV2, Label: LabelV2, Switch: SwitchV2, Textarea: TextareaV2, Select: SelectV2, SelectItem: SelectItemV2, SelectTrigger: SelectTriggerV2, SelectValue: SelectValueV2,
  // The tone is bound here rather than at the call site because `ui.SelectContent`
  // is shared with v1, which has no such prop: v1's markup stays byte for byte
  // what it was. Surface = the page's own colours; the v2 default is a
  // translucent near-black panel, which reads as an OS menu on this light,
  // text-heavy screen. See components/ui-v2/select.tsx.
  SelectContent: (props: Parameters<typeof SelectContentV2>[0]) => <SelectContentV2 tone="surface" {...props} />,
} as unknown as typeof EXTRAS_DIALOG_UI_V1;

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
  touchVisible = false,
  v2 = false,
}: {
  url: string;
  index: number;
  onRemove: () => void;
  /** v2: the drag handle and remove button stay visible below `sm` (touch has no hover). */
  touchVisible?: boolean;
  /** v2: rounded like the Add tile beside it (`rounded-xl`); v1 keeps `rounded-lg`. */
  v2?: boolean;
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
      className={`relative group flex-shrink-0 ${index === 0 ? `ring-2 ring-primary ${v2 ? V2_CARD_RADIUS : 'rounded-lg'}` : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className={`absolute top-0 left-0 right-0 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing bg-black/40 ${v2 ? 'rounded-t-xl' : 'rounded-t-lg'} ${touchVisible ? 'sm:opacity-0 sm:group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
      >
        <GripVertical className="h-3 w-3 text-white" />
      </div>
      <img
        src={url}
        alt={`Image ${index + 1}`}
        className={`w-20 h-20 ${v2 ? V2_CARD_RADIUS : 'rounded-lg'} object-cover border`}
      />
      {index === 0 && (
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Star className="h-3 w-3" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center ${touchVisible ? 'sm:opacity-0 sm:group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
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
    error: extrasError,
    refetch: refetchExtras,
    isFetching: isFetchingExtras,
    hasLoaded: extrasLoaded,
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

  // v2 chrome (northwind only; every other tenant keeps v1). Above the loading
  // return, so both hooks run on every render. `canEditSettings('extras')` is
  // the check behind the Settings page's view-only banner for this tab.
  const v2Chrome = useV2('chrome');
  const { canEditSettings } = useManagerPermissions();
  // The dialogs' parts for this tenant's design (see EXTRAS_DIALOG_UI_V1 / _V2).
  const ui = v2Chrome ? EXTRAS_DIALOG_UI_V2 : EXTRAS_DIALOG_UI_V1;

  // v2: which extra's Activate/Deactivate is in flight; the stock and delete
  // dialogs' save errors (they stay open on a failure instead of closing
  // first); and whether the Add/Edit form has been submitted once, so its
  // inline errors wait for a Save click.
  const [togglingIdV2, setTogglingIdV2] = useState<string | null>(null);
  const [stockErrorV2, setStockErrorV2] = useState<unknown>(null);
  const [deleteErrorV2, setDeleteErrorV2] = useState<unknown>(null);
  const [formTriedV2, setFormTriedV2] = useState(false);
  // v2: the Add/Edit save's failure, shown in the dialog (it stays open) until
  // the next attempt or the next time the dialog opens.
  const [saveErrorV2, setSaveErrorV2] = useState<unknown>(null);
  // v2: the form as it was when the dialog opened, so closing it over typed
  // changes (or uploaded images) asks first instead of dropping them.
  const [formOpenedAsV2, setFormOpenedAsV2] = useState('');
  const [confirmDiscardV2, setConfirmDiscardV2] = useState(false);

  // Fetch all tenant vehicles for per-vehicle pricing picker. Its own key under
  // the 'vehicles-list' prefix: /vehicles caches every column plus photos at
  // exactly ['vehicles-list', tenantId], and sharing it served that page these
  // reg-ordered, photo-less rows (or this picker Disposed cars) for up to the
  // 60s stale time. Prefix invalidations of ['vehicles-list'] still reach it.
  const { data: allVehicles, isLoading: vehiclesLoadingV2, isError: vehiclesErrorV2, refetch: refetchVehiclesV2 } = useQuery({
    queryKey: ['vehicles-list', tenant?.id, 'extras-picker'],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, reg, make, model')
        .eq('tenant_id', tenant.id)
        .neq('status', 'Disposed')
        .order('reg');
      // v2: a failed read is an error, not "you have no vehicles".
      if (error && v2Chrome) throw error;
      return data || [];
    },
    enabled: !!tenant?.id,
  });

  // Notify admin about low stock items
  useEffect(() => {
    // v2 says this inline above the table instead of a red toast on every visit.
    if (v2Chrome) return;
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
    setFormTriedV2(false);
    setSaveErrorV2(null);
    if (v2Chrome) setFormOpenedAsV2(JSON.stringify(EMPTY_FORM));
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (extra: RentalExtra) => {
    setEditingExtra(extra);
    const openedFormV2: ExtraFormData = {
      name: extra.name,
      description: extra.description || '',
      price: String(extra.price),
      pricing_type: extra.pricing_type || 'global',
      billing_type: extra.billing_type || 'per_trip',
      vehicle_pricing: (extra.vehicle_pricing || []).map((vp) => ({
        vehicle_id: vp.vehicle_id,
        price: String(vp.price),
        vehicle_reg: vp.vehicle_reg,
        vehicle_make: vp.vehicle_make,
        vehicle_model: vp.vehicle_model,
      })),
      image_urls: extra.image_urls || [],
      max_quantity: extra.max_quantity ? String(extra.max_quantity) : '10',
      is_quantity_based: extra.max_quantity !== null,
      is_active: extra.is_active,
    };
    setFormData(openedFormV2);
    setFormTriedV2(false);
    setSaveErrorV2(null);
    if (v2Chrome) setFormOpenedAsV2(JSON.stringify(openedFormV2));
    setIsDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    // v2: collected outside the try, so a failure part-way keeps what uploaded.
    const newUrlsV2: string[] = [];
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
        newUrlsV2.push(urlData.publicUrl);
      }
      setFormData((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...newUrls] }));
    } catch (err: any) {
      // v2: the files uploaded before the failure are kept in the form, so
      // only the one that failed has to be added again.
      if (v2Chrome && newUrlsV2.length > 0) {
        setFormData((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...newUrlsV2] }));
      }
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
    // v2: every problem shows under its own field at once instead of one toast
    // per click, and the first one scrolls into view. The price checks are
    // v1's own, so no price that saved before is refused.
    if (v2Chrome) {
      const issues = getExtraFormIssues(formData);
      if (Object.keys(issues).length > 0) {
        setFormTriedV2(true);
        toast({ title: 'Check the highlighted fields', description: Object.values(issues)[0], variant: 'destructive' });
        requestAnimationFrame(() => {
          document.querySelector('[data-extra-field-error]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        return;
      }
      setFormTriedV2(false);
      setSaveErrorV2(null);
    }
    if (!formData.name.trim()) {
      toast({ title: 'Error', description: 'Name is required.', variant: 'destructive' });
      return;
    }
    if (formData.image_urls.length === 0) {
      toast({ title: 'Error', description: 'At least one image is required.', variant: 'destructive' });
      return;
    }

    // Validate price for global extras
    if (formData.pricing_type === 'global') {
      const price = parseFloat(formData.price);
      if (isNaN(price) || price < 0) {
        toast({ title: 'Error', description: 'Price must be a valid positive number.', variant: 'destructive' });
        return;
      }
    }

    // Validate vehicle pricing for per_vehicle extras
    if (formData.pricing_type === 'per_vehicle') {
      if (formData.vehicle_pricing.length === 0) {
        toast({ title: 'Error', description: 'Add at least one vehicle with pricing.', variant: 'destructive' });
        return;
      }
      for (const vp of formData.vehicle_pricing) {
        const vpPrice = parseFloat(vp.price);
        if (isNaN(vpPrice) || vpPrice < 0) {
          toast({ title: 'Error', description: 'All vehicle prices must be valid positive numbers.', variant: 'destructive' });
          return;
        }
      }
    }

    const price = formData.pricing_type === 'global' ? parseFloat(formData.price) : 0;

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      price,
      pricing_type: formData.pricing_type,
      billing_type: formData.billing_type,
      vehicle_pricing: formData.vehicle_pricing.map((vp) => ({
        vehicle_id: vp.vehicle_id,
        price: parseFloat(vp.price),
      })),
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
    } catch (err) {
      // Error handled by mutation callbacks
      // v2: and said in the dialog, which stays open with the form as typed.
      if (v2Chrome) setSaveErrorV2(err ?? new Error('Save failed'));
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

  // v2 handlers. The dialogs stay open until the write succeeds and say why
  // when it does not. The values written are exactly v1's.
  const handleToggleActiveV2 = async (extra: RentalExtra) => {
    if (togglingIdV2) return;
    setTogglingIdV2(extra.id);
    try {
      await handleToggleActive(extra);
    } finally {
      setTogglingIdV2(null);
    }
  };

  const stockAddV2 = stockValue.trim() === '' ? null : Number(stockValue);
  const stockInvalidV2 = stockAddV2 !== null && !(Number.isInteger(stockAddV2) && stockAddV2 > 0);

  const handleAddStockV2 = async () => {
    if (!stockTarget || isUpdating || stockAddV2 === null || stockInvalidV2) return;
    setStockErrorV2(null);
    try {
      await updateExtra({ id: stockTarget.id, max_quantity: (stockTarget.max_quantity || 0) + stockAddV2 });
      setStockTarget(null);
    } catch (err) {
      setStockErrorV2(err);
    }
  };

  const handleDeleteV2 = async () => {
    if (!deleteTarget || isDeleting) return;
    setDeleteErrorV2(null);
    try {
      await deleteExtra(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteErrorV2(err);
    }
  };

  const formIssuesV2: ReturnType<typeof getExtraFormIssues> = v2Chrome && formTriedV2 ? getExtraFormIssues(formData) : {};
  const fieldErrorV2 = (message?: string) =>
    message ? (
      <p role="alert" data-extra-field-error="" className="text-xs text-destructive">
        {message}
      </p>
    ) : null;

  const canEditExtrasV2 = canEditSettings('extras');
  const formDirtyV2 = v2Chrome && isDialogOpen && formOpenedAsV2 !== '' && JSON.stringify(formData) !== formOpenedAsV2;
  // v2: every way out of the Add/Edit dialog (Cancel, X, Escape, outside click)
  // asks before dropping typed changes. Saving closes it directly.
  const uploadedSinceOpenV2 = (() => {
    if (!formDirtyV2) return false;
    try {
      const opened = JSON.parse(formOpenedAsV2) as ExtraFormData;
      return formData.image_urls.some((url) => !opened.image_urls.includes(url));
    } catch {
      return false;
    }
  })();
  const requestCloseDialogV2 = (open: boolean) => {
    if (!open && formDirtyV2 && !isCreating && !isUpdating) {
      setConfirmDiscardV2(true);
      return;
    }
    if (!open && (isCreating || isUpdating)) return;
    setIsDialogOpen(open);
  };
  const currencySymbolV2 = getCurrencySymbol(tenant?.currency_code || 'USD');
  // v2: the page's own header already names and describes Extras, so the list
  // gets a plain section title (like "All promo codes") and the Add button.
  const extrasHeaderV2 = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className={SETTINGS_SECTION_TITLE}>All extras</h2>
      {canEditExtrasV2 && extrasLoaded && extras.length > 0 && (
        <ButtonV2 onClick={handleOpenAdd} className="w-full shrink-0 sm:w-auto">
          <Plus data-icon="inline-start" />
          Add Extra
        </ButtonV2>
      )}
    </div>
  );

  // v2: the header stays put while the list loads (a table-shaped skeleton, so
  // nothing jumps when rows land), and a failed first read says so with a
  // retry instead of "No extras configured yet".
  if (v2Chrome && !extrasLoaded) {
    return (
      <div className="pointer-events-auto space-y-3">
        {extrasHeaderV2}
        {extrasError ? (
          <SettingsLoadError
            thing="rental extras"
            error={extrasError}
            onRetry={() => refetchExtras()}
            retrying={isFetchingExtras}
          />
        ) : (
          <>
            <SettingsSectionSkeleton variant="rows" rows={4} thumbnail label="Loading rental extras" className="sm:hidden" />
            <SettingsSectionSkeleton variant="table" rows={4} columns={7} label="Loading rental extras" className="hidden sm:block" />
          </>
        )}
      </div>
    );
  }

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
      {v2Chrome ? (
        // v2: no card inside a card. The header sits above and the kit's
        // ListTable is the card; the empty message is v1's, centred, with no
        // table. `pointer-events-auto` because a view-only manager's tab body is
        // `pointer-events-none`: without it the table could neither scroll nor
        // show more than its first 25 extras. Add Extra and the row menu render
        // only for `canEditSettings('extras')`, and every handler is this
        // component's own, so the dialogs below serve both branches.
        <div className="pointer-events-auto space-y-3">
          {extrasHeaderV2}
          {extrasError ? (
            <SettingsLoadError
              variant="inline"
              thing="rental extras"
              error={extrasError}
              onRetry={() => refetchExtras()}
              retrying={isFetchingExtras}
            />
          ) : null}
          {extras.some((e) => e.stock_unknown || e.vehicle_pricing_unknown) && (
            <SettingsDependencyNotice
              tone="warning"
              title="Some details couldn't be loaded"
              body="Stock left and per-vehicle prices show a dash below. Editing a per-vehicle extra waits until they load."
              action={{ label: 'Try again', onClick: () => void refetchExtras() }}
            />
          )}
          {(() => {
            const low = extras.filter((e) => e.is_active && !e.stock_unknown && isLowStock(e));
            return low.length > 0 ? (
              <SettingsDependencyNotice
                tone="warning"
                icon={AlertTriangle}
                title={lowStockSentence(low.map((e) => e.name))}
                body={canEditExtrasV2 ? 'Use Update Stock in its menu to add more.' : 'Ask an admin to add more stock.'}
              />
            ) : null;
          })()}
          {extras.length === 0 ? (
            <SettingsEmptyState
              icon={Package}
              headline={canEditExtrasV2 ? 'Offer add-ons with every booking' : 'No extras have been set up yet'}
              body={
                canEditExtrasV2
                  ? 'Extras are things customers can add when they book, like a child seat, GPS or a cooler.'
                  : 'Add-ons customers can buy with a rental will be listed here once an admin sets them up.'
              }
              points={
                canEditExtrasV2
                  ? ['Charge once per trip or per day', 'One price, or a price per vehicle', 'Limit how many can be booked']
                  : undefined
              }
              primaryAction={canEditExtrasV2 ? { label: 'Add your first extra', icon: Plus, onClick: handleOpenAdd } : undefined}
            />
          ) : (
            <ExtrasTableV2
              extras={extras}
              resetKey={tenant?.id ?? ''}
              currencyCode={tenant?.currency_code || 'USD'}
              canEdit={canEditExtrasV2}
              isLowStock={isLowStock}
              busyId={togglingIdV2}
              onEdit={(extra) => {
                // Saving replaces every vehicle price, so an edit opened over a
                // failed price read would save none of them.
                if (extra.pricing_type === 'per_vehicle' && extra.vehicle_pricing_unknown) {
                  toast({
                    title: "Vehicle prices didn't load",
                    description: `Try again before editing ${extra.name}, so its vehicle prices are not lost.`,
                    variant: 'destructive',
                  });
                  return;
                }
                handleOpenEdit(extra);
              }}
              onUpdateStock={(extra) => { setStockErrorV2(null); setStockTarget(extra); setStockValue(''); }}
              onToggleActive={handleToggleActiveV2}
              onDelete={(extra) => { setDeleteErrorV2(null); setDeleteTarget(extra); }}
            />
          )}
        </div>
      ) : (
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Rental Extras</CardTitle>
              <CardDescription>
                Manage optional add-ons customers can select during booking (GPS, baby seats, drinks, etc.)
              </CardDescription>
            </div>
            <Button onClick={handleOpenAdd} className="w-full sm:w-auto shrink-0">
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
                  <TableHead>Pricing</TableHead>
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
                      <TableCell className="font-semibold">
                        {extra.pricing_type === 'per_vehicle'
                          ? <span className="text-muted-foreground text-xs">Varies</span>
                          : formatCurrency(Number(extra.price), tenant?.currency_code || 'USD')
                        }
                      </TableCell>
                      <TableCell>
                        {extra.pricing_type === 'per_vehicle' ? (
                          <Badge variant="secondary" className="gap-1">
                            <Car className="h-3 w-3" />
                            Per Vehicle ({extra.vehicle_pricing?.length || 0})
                          </Badge>
                        ) : (
                          <Badge variant="outline">Global</Badge>
                        )}
                      </TableCell>
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
      )}

      {/* Delete Confirmation Dialog */}
      <ui.AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <ui.AlertDialogContent>
          <ui.AlertDialogHeader>
            <ui.AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</ui.AlertDialogTitle>
            <ui.AlertDialogDescription>
              This will permanently remove this extra. Existing bookings with this extra will not be affected.
            </ui.AlertDialogDescription>
          </ui.AlertDialogHeader>
          {v2Chrome && deleteErrorV2 ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t delete this extra. Nothing was deleted. Try again, or deactivate it instead.
            </p>
          ) : null}
          <ui.AlertDialogFooter>
            <ui.AlertDialogCancel>Cancel</ui.AlertDialogCancel>
            {v2Chrome ? (
              <ui.AlertDialogAction
                onClick={(e) => {
                  // Stay open until the delete lands, so a failure is seen here.
                  e.preventDefault();
                  void handleDeleteV2();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting}
              >
                {isDeleting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Deleting…</> : 'Delete'}
              </ui.AlertDialogAction>
            ) : (
            <ui.AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </ui.AlertDialogAction>
            )}
          </ui.AlertDialogFooter>
        </ui.AlertDialogContent>
      </ui.AlertDialog>

      {/* Update Stock Dialog */}
      <ui.Dialog open={!!stockTarget} onOpenChange={(open) => !open && setStockTarget(null)}>
        <ui.DialogContent className="sm:max-w-sm">
          <ui.DialogHeader>
            <ui.DialogTitle>Update Stock</ui.DialogTitle>
            <ui.DialogDescription>
              Add stock to &quot;{stockTarget?.name}&quot;. Current total: {stockTarget?.max_quantity ?? 0}
            </ui.DialogDescription>
          </ui.DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <ui.Label>Add Quantity</ui.Label>
              <ui.Input
                type="number"
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
                onKeyDown={(e) => {
                  if (v2Chrome) {
                    if (e.key === 'Enter') void handleAddStockV2();
                    return;
                  }
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
            {(v2Chrome ? stockAddV2 !== null && !stockInvalidV2 : stockValue && parseInt(stockValue) > 0) && (
              <p className="text-xs text-muted-foreground">
                New total will be: {v2Chrome ? formatSettingsNumber((stockTarget?.max_quantity || 0) + (stockAddV2 ?? 0)) : (stockTarget?.max_quantity || 0) + parseInt(stockValue)}
              </p>
            )}
            {v2Chrome && stockTarget && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="tabular-nums">
                  Total {formatSettingsNumber(stockTarget.max_quantity)} · Booked{' '}
                  {stockTarget.stock_unknown ? '—' : formatSettingsNumber(stockTarget.booked_quantity)} · Left{' '}
                  {stockTarget.stock_unknown ? '—' : formatSettingsNumber(stockTarget.remaining_stock)}
                </p>
                <p>To lower stock, edit the extra and change its quantity.</p>
                {stockInvalidV2 && <p role="alert" className="text-destructive">Enter a whole number above 0.</p>}
                {stockErrorV2 ? (
                  <p role="alert" className="text-destructive">
                    Couldn&apos;t add stock. {describeSaveError(stockErrorV2)}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <ui.DialogFooter>
            <ui.Button variant="outline" onClick={() => setStockTarget(null)}>Cancel</ui.Button>
            {v2Chrome ? (
              <ui.Button
                onClick={() => void handleAddStockV2()}
                disabled={isUpdating || stockAddV2 === null || stockInvalidV2}
              >
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Stock
              </ui.Button>
            ) : (
            <ui.Button
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
            </ui.Button>
            )}
          </ui.DialogFooter>
        </ui.DialogContent>
      </ui.Dialog>

      {/* Add/Edit Dialog */}
      <ui.Dialog open={isDialogOpen} onOpenChange={v2Chrome ? requestCloseDialogV2 : setIsDialogOpen}>
        <ui.DialogContent className="sm:max-w-2xl">
          <ui.DialogHeader>
            <ui.DialogTitle>
              {editingExtra ? 'Edit Extra' : 'Add Extra'}
            </ui.DialogTitle>
            <ui.DialogDescription>
              {editingExtra
                ? 'Update the rental extra details'
                : 'Add a new optional extra for customers'}
            </ui.DialogDescription>
          </ui.DialogHeader>

          <div className="space-y-4 py-2 px-1 -mx-1 max-h-[70vh] overflow-y-auto">
            {/* Row 1: Name + Price (global only) */}
            <div className={`grid gap-4 ${formData.pricing_type === 'global' ? (v2Chrome ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-3') : 'grid-cols-1'}`}>
              <div className={formData.pricing_type === 'global' ? (v2Chrome ? 'sm:col-span-2 space-y-2' : 'col-span-2 space-y-2') : 'space-y-2'}>
                <ui.Label>Name *</ui.Label>
                <ui.Input
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., GPS Navigation"
                />
                {fieldErrorV2(formIssuesV2.name)}
              </div>
              {formData.pricing_type === 'global' && (
                <div className="space-y-2">
                  <ui.Label>Price *</ui.Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{v2Chrome ? currencySymbolV2 : '$'}</span>
                    <ui.Input
                      type="number"
                      value={formData.price}
                      onChange={(e) => setFormData((p) => ({ ...p, price: e.target.value }))}
                      className={v2Chrome && currencySymbolV2.length > 1 ? 'pl-12' : 'pl-7'}
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                    />
                  </div>
                  {fieldErrorV2(formIssuesV2.price)}
                </div>
              )}
            </div>

            {/* Billing frequency: per trip (flat) vs per day (x rental days) */}
            <div className="space-y-2">
              <ui.Label>Billing</ui.Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, billing_type: 'per_trip' }))}
                  className={`${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-3 text-left text-sm transition-colors ${
                    formData.billing_type === 'per_trip'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : v2Chrome ? V2_OPTION_HOVER : 'hover:bg-muted/50'
                  }`}
                >
                  <p className="font-medium">Per trip</p>
                  <p className="text-xs text-muted-foreground">Charged once for the whole rental</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, billing_type: 'per_day' }))}
                  className={`${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-3 text-left text-sm transition-colors ${
                    formData.billing_type === 'per_day'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : v2Chrome ? V2_OPTION_HOVER : 'hover:bg-muted/50'
                  }`}
                >
                  <p className="font-medium">Per day</p>
                  <p className="text-xs text-muted-foreground">Price x number of rental days</p>
                </button>
              </div>
            </div>

            {/* Pricing Type */}
            <div className="space-y-2">
              <ui.Label>Pricing Type</ui.Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, pricing_type: 'global' }))}
                  className={`flex items-center gap-2 ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-3 text-left text-sm transition-colors ${
                    formData.pricing_type === 'global'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : v2Chrome ? V2_OPTION_HOVER : 'hover:bg-muted/50'
                  }`}
                >
                  <div>
                    <p className="font-medium">Same price for all vehicles</p>
                    <p className="text-xs text-muted-foreground">Single global price</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, pricing_type: 'per_vehicle' }))}
                  className={`flex items-center gap-2 ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-3 text-left text-sm transition-colors ${
                    formData.pricing_type === 'per_vehicle'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : v2Chrome ? V2_OPTION_HOVER : 'hover:bg-muted/50'
                  }`}
                >
                  <div>
                    <p className="font-medium">Different price per vehicle</p>
                    <p className="text-xs text-muted-foreground">Set price for each vehicle</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Per-Vehicle Pricing Section */}
            {formData.pricing_type === 'per_vehicle' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <ui.Label>Vehicle Pricing *</ui.Label>
                  <p className="text-xs text-muted-foreground">{formData.vehicle_pricing.length} vehicle(s) assigned</p>
                </div>
                {fieldErrorV2(formIssuesV2.vehicle_pricing)}
                {formData.vehicle_pricing.length > 0 && (
                  <div className="space-y-2">
                    {formData.vehicle_pricing.map((vp, idx) => {
                      const vehicle = allVehicles?.find((v) => v.id === vp.vehicle_id);
                      const label = vehicle
                        ? `${vehicle.reg} - ${vehicle.make || ''} ${vehicle.model || ''}`
                        : vp.vehicle_reg
                          ? `${vp.vehicle_reg} - ${vp.vehicle_make || ''} ${vp.vehicle_model || ''}`
                          : vp.vehicle_id;
                      return (
                        <div key={vp.vehicle_id} className={`flex items-center gap-2 ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-2`}>
                          <span className="flex-1 text-sm truncate">{label}</span>
                          <div className={v2Chrome && currencySymbolV2.length > 1 ? 'relative w-28 flex-shrink-0' : 'relative w-24'}>
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{v2Chrome ? currencySymbolV2 : '$'}</span>
                            <ui.Input
                              type="number"
                              value={vp.price}
                              onChange={(e) => {
                                setFormData((p) => {
                                  const updated = [...p.vehicle_pricing];
                                  updated[idx] = { ...updated[idx], price: e.target.value };
                                  return { ...p, vehicle_pricing: updated };
                                });
                              }}
                              className={v2Chrome && currencySymbolV2.length > 1 ? 'h-8 text-sm pl-10' : 'h-8 text-sm pl-5'}
                              min={0}
                              step={0.01}
                            />
                          </div>
                          <ui.Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0"
                            onClick={() => {
                              setFormData((p) => ({
                                ...p,
                                vehicle_pricing: p.vehicle_pricing.filter((_, i) => i !== idx),
                              }));
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </ui.Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Add vehicle picker */}
                {(() => {
                  const assignedIds = new Set(formData.vehicle_pricing.map((vp) => vp.vehicle_id));
                  const available = (allVehicles || []).filter((v) => !assignedIds.has(v.id));
                  if (v2Chrome) {
                    if (vehiclesErrorV2) {
                      return (
                        <SettingsDependencyNotice
                          tone="warning"
                          title="Couldn't load your vehicles"
                          body="Vehicles already priced above are kept. Try again to add more."
                          action={{ label: 'Try again', onClick: () => void refetchVehiclesV2() }}
                        />
                      );
                    }
                    if (vehiclesLoadingV2) {
                      return <p className="text-xs text-muted-foreground">Loading vehicles…</p>;
                    }
                    if ((allVehicles || []).length === 0) {
                      return (
                        <SettingsDependencyNotice
                          title="You have no vehicles yet"
                          body="Add a vehicle before setting per-vehicle prices, or use one price for all vehicles."
                          action={{ label: 'Add a vehicle', href: '/vehicles' }}
                        />
                      );
                    }
                    if (available.length === 0) {
                      return <p className="text-xs text-muted-foreground">Every vehicle has a price.</p>;
                    }
                  }
                  if (available.length === 0) return null;
                  return (
                    <ui.Select
                      onValueChange={(vehicleId) => {
                        const vehicle = allVehicles?.find((v) => v.id === vehicleId);
                        if (!vehicle) return;
                        setFormData((p) => ({
                          ...p,
                          vehicle_pricing: [
                            ...p.vehicle_pricing,
                            {
                              vehicle_id: vehicle.id,
                              price: '',
                              vehicle_reg: vehicle.reg,
                              vehicle_make: vehicle.make || undefined,
                              vehicle_model: vehicle.model || undefined,
                            },
                          ],
                        }));
                      }}
                      value=""
                    >
                      <ui.SelectTrigger className="h-9">
                        <ui.SelectValue placeholder="Add a vehicle..." />
                      </ui.SelectTrigger>
                      <ui.SelectContent>
                        {available.map((v) => (
                          <ui.SelectItem key={v.id} value={v.id}>
                            {v.reg} - {v.make || ''} {v.model || ''}
                          </ui.SelectItem>
                        ))}
                      </ui.SelectContent>
                    </ui.Select>
                  );
                })()}
              </div>
            )}

            {/* Row 2: Description */}
            <div className="space-y-2">
              <ui.Label>Description</ui.Label>
              <ui.Textarea
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description of the extra"
                rows={2}
              />
            </div>

            {/* Row 3: Images */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <ui.Label>Images *</ui.Label>
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
                            touchVisible={v2Chrome}
                            v2={v2Chrome}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
                <label className={`w-20 h-20 ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 ${v2Chrome ? V2_OPTION_HOVER : 'hover:bg-muted/50'} transition-colors flex-shrink-0`}>
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
              {fieldErrorV2(formIssuesV2.images)}
            </div>

            {/* Row 4: Toggles */}
            <div className={v2Chrome ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3'}>
              <div className={`flex items-center justify-between ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-2.5`}>
                <div>
                  <ui.Label className="text-sm font-medium">Quantity-based</ui.Label>
                  <p className="text-xs text-muted-foreground">Multiple units</p>
                </div>
                <div className="flex items-center gap-2">
                  {formData.is_quantity_based && (
                    <div className="relative w-16">
                      <ui.Input
                        type="number"
                        value={formData.max_quantity}
                        onChange={(e) => setFormData((p) => ({ ...p, max_quantity: e.target.value }))}
                        className="h-7 text-xs text-center px-1"
                        min={1}
                        placeholder="10"
                      />
                    </div>
                  )}
                  <ui.Switch
                    checked={formData.is_quantity_based}
                    onCheckedChange={(checked) =>
                      setFormData((p) => ({ ...p, is_quantity_based: checked }))
                    }
                  />
                </div>
              </div>

              <div className={`flex items-center justify-between ${v2Chrome ? V2_CARD_RADIUS : 'rounded-lg'} border p-2.5`}>
                <div>
                  <ui.Label className="text-sm font-medium">Active</ui.Label>
                  <p className="text-xs text-muted-foreground">Visible to customers</p>
                </div>
                <ui.Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData((p) => ({ ...p, is_active: checked }))
                  }
                />
              </div>
            </div>
            {fieldErrorV2(formIssuesV2.max_quantity)}
          </div>

          {v2Chrome && saveErrorV2 && !isCreating && !isUpdating ? (
            <SettingsSaveState status="error" error={saveErrorV2} onRetry={handleSave} />
          ) : null}
          <ui.DialogFooter>
            <ui.Button variant="outline" onClick={() => (v2Chrome ? requestCloseDialogV2(false) : setIsDialogOpen(false))}>
              Cancel
            </ui.Button>
            <ui.Button onClick={handleSave} disabled={isCreating || isUpdating || uploading}>
              {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingExtra ? 'Save Changes' : 'Add Extra'}
            </ui.Button>
          </ui.DialogFooter>
        </ui.DialogContent>
      </ui.Dialog>

      {v2Chrome && (
        // A v2 Dialog (role alertdialog), the Add/Edit dialog's own kind: same
        // layer, portalled after it, so it opens on top of it.
        <ui.Dialog open={confirmDiscardV2} onOpenChange={setConfirmDiscardV2}>
          <ui.DialogContent role="alertdialog" className="sm:max-w-md">
            <ui.DialogHeader>
              <ui.DialogTitle>Discard your changes?</ui.DialogTitle>
              <ui.DialogDescription className="[overflow-wrap:anywhere]">
                {editingExtra
                  ? `Your edits to "${editingExtra.name}" haven't been saved.`
                  : "This extra hasn't been added yet."}
                {uploadedSinceOpenV2 ? ' The images you just uploaded won\'t be attached to it.' : ''}
              </ui.DialogDescription>
            </ui.DialogHeader>
            <ui.DialogFooter>
              <ui.Button variant="outline" onClick={() => setConfirmDiscardV2(false)}>
                Keep editing
              </ui.Button>
              <ui.Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setConfirmDiscardV2(false);
                  setIsDialogOpen(false);
                }}
              >
                Discard
              </ui.Button>
            </ui.DialogFooter>
          </ui.DialogContent>
        </ui.Dialog>
      )}
    </div>
  );
}
