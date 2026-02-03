'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LocationAutocomplete } from '@/components/ui/location-autocomplete';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Car,
  RotateCcw,
  Check,
  X,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  useDeliveryLocations,
  DeliveryLocation,
} from '@/hooks/use-delivery-locations';
import { useTenant } from '@/contexts/TenantContext';

interface LocationFormData {
  name: string;
  address: string;
  delivery_fee: number;
  collection_fee: number;
  is_delivery_enabled: boolean;
  is_collection_enabled: boolean;
  is_active: boolean;
}

const EMPTY_FORM: LocationFormData = {
  name: '',
  address: '',
  delivery_fee: 0,
  collection_fee: 0,
  is_delivery_enabled: true,
  is_collection_enabled: true,
  is_active: true,
};

export function DeliveryCollectionSettings() {
  const { tenant } = useTenant();
  const {
    deliverySettings,
    isLoadingSettings,
    updateSettings,
    isUpdatingSettings,
    locations,
    isLoadingLocations,
    createLocation,
    isCreating,
    updateLocation,
    isUpdating,
    deleteLocation,
    isDeleting,
  } = useDeliveryLocations();

  // Global settings state
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [collectionEnabled, setCollectionEnabled] = useState(false);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<DeliveryLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>(EMPTY_FORM);

  // Sync local state with fetched settings
  useEffect(() => {
    if (deliverySettings) {
      setDeliveryEnabled(deliverySettings.delivery_enabled);
      setCollectionEnabled(deliverySettings.collection_enabled);
    }
  }, [deliverySettings]);

  const handleToggleDelivery = async (enabled: boolean) => {
    setDeliveryEnabled(enabled);
    try {
      await updateSettings({ delivery_enabled: enabled });
    } catch {
      setDeliveryEnabled(!enabled); // Revert on error
    }
  };

  const handleToggleCollection = async (enabled: boolean) => {
    setCollectionEnabled(enabled);
    try {
      await updateSettings({ collection_enabled: enabled });
    } catch {
      setCollectionEnabled(!enabled); // Revert on error
    }
  };

  const handleOpenAddDialog = () => {
    setEditingLocation(null);
    setFormData(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (location: DeliveryLocation) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address: location.address,
      delivery_fee: location.delivery_fee,
      collection_fee: location.collection_fee,
      is_delivery_enabled: location.is_delivery_enabled,
      is_collection_enabled: location.is_collection_enabled,
      is_active: location.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSaveLocation = async () => {
    if (!formData.name.trim() || !formData.address.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter both name and address.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.is_delivery_enabled && !formData.is_collection_enabled) {
      toast({
        title: 'Validation Error',
        description: 'Location must be enabled for at least one service (delivery or collection).',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingLocation) {
        await updateLocation({
          id: editingLocation.id,
          name: formData.name.trim(),
          address: formData.address.trim(),
          delivery_fee: formData.delivery_fee,
          collection_fee: formData.collection_fee,
          is_delivery_enabled: formData.is_delivery_enabled,
          is_collection_enabled: formData.is_collection_enabled,
          is_active: formData.is_active,
        });
      } else {
        await createLocation({
          name: formData.name.trim(),
          address: formData.address.trim(),
          delivery_fee: formData.delivery_fee,
          collection_fee: formData.collection_fee,
          is_delivery_enabled: formData.is_delivery_enabled,
          is_collection_enabled: formData.is_collection_enabled,
          is_active: formData.is_active,
        });
      }
      setIsDialogOpen(false);
      setFormData(EMPTY_FORM);
      setEditingLocation(null);
    } catch {
      // Error handled in hook
    }
  };

  const handleDeleteLocation = async (id: string) => {
    try {
      await deleteLocation(id);
    } catch {
      // Error handled in hook
    }
  };

  const handleToggleActive = async (location: DeliveryLocation) => {
    try {
      await updateLocation({
        id: location.id,
        is_active: !location.is_active,
      });
    } catch {
      // Error handled in hook
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(amount);
  };

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading delivery settings...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Global Service Controls */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Truck className="h-5 w-5 text-accent" />
            Delivery & Collection Service
          </CardTitle>
          <CardDescription>
            Enable services to deliver vehicles to customers and collect them from specific locations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Delivery Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-green-600" />
                <Label htmlFor="delivery-toggle" className="font-medium">
                  Enable Delivery Service
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Allow customers to request vehicle delivery to their chosen location
              </p>
            </div>
            <Switch
              id="delivery-toggle"
              checked={deliveryEnabled}
              onCheckedChange={handleToggleDelivery}
              disabled={isUpdatingSettings}
            />
          </div>

          {/* Collection Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-blue-600" />
                <Label htmlFor="collection-toggle" className="font-medium">
                  Enable Collection Service
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Allow customers to request vehicle collection from their chosen location
              </p>
            </div>
            <Switch
              id="collection-toggle"
              checked={collectionEnabled}
              onCheckedChange={handleToggleCollection}
              disabled={isUpdatingSettings}
            />
          </div>
        </CardContent>
      </Card>

      {/* Locations Table */}
      {(deliveryEnabled || collectionEnabled) && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Delivery & Collection Locations</CardTitle>
                <CardDescription>
                  Manage locations where you can deliver or collect vehicles
                </CardDescription>
              </div>
              <Button onClick={handleOpenAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Location
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingLocations ? (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : locations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No delivery locations added yet</p>
                <p className="text-sm mt-1">Add locations to enable delivery and collection services</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col items-center">
                          <span>Delivery</span>
                          <span className="text-xs font-normal text-muted-foreground">Fee | Enabled</span>
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col items-center">
                          <span>Collection</span>
                          <span className="text-xs font-normal text-muted-foreground">Fee | Enabled</span>
                        </div>
                      </TableHead>
                      <TableHead className="text-center w-[80px]">Active</TableHead>
                      <TableHead className="text-right w-[90px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((location) => (
                      <TableRow key={location.id} className={!location.is_active ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{location.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                          {location.address}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm font-medium">
                              {formatCurrency(location.delivery_fee)}
                            </span>
                            <span className="text-muted-foreground">|</span>
                            {location.is_delivery_enabled ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm font-medium">
                              {formatCurrency(location.collection_fee)}
                            </span>
                            <span className="text-muted-foreground">|</span>
                            {location.is_collection_enabled ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={location.is_active}
                            onCheckedChange={() => handleToggleActive(location)}
                            disabled={isUpdating}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleOpenEditDialog(location)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Location</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{location.name}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteLocation(location.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Location Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingLocation ? 'Edit Delivery Location' : 'Add Delivery Location'}
            </DialogTitle>
            <DialogDescription>
              {editingLocation
                ? 'Update the location details and service options'
                : 'Add a new location for delivery and/or collection services'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="locationName">Location Name *</Label>
              <Input
                id="locationName"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Heathrow Airport Terminal 5"
              />
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="locationAddress">Address *</Label>
              <LocationAutocomplete
                id="locationAddress"
                value={formData.address}
                onChange={(value) => setFormData((prev) => ({ ...prev, address: value }))}
                placeholder="Search for an address..."
              />
            </div>

            {/* Service Options */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Service Options</Label>

              {/* Delivery Option */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-green-600" />
                    <Label htmlFor="is_delivery_enabled" className="cursor-pointer">
                      Available for Delivery
                    </Label>
                  </div>
                  <Switch
                    id="is_delivery_enabled"
                    checked={formData.is_delivery_enabled}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, is_delivery_enabled: checked }))
                    }
                  />
                </div>
                {formData.is_delivery_enabled && (
                  <div className="flex items-center gap-2 ml-6">
                    <Label htmlFor="delivery_fee" className="text-sm whitespace-nowrap">
                      Delivery Fee:
                    </Label>
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        £
                      </span>
                      <Input
                        id="delivery_fee"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.delivery_fee}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            delivery_fee: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="pl-7"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Collection Option */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-blue-600" />
                    <Label htmlFor="is_collection_enabled" className="cursor-pointer">
                      Available for Collection
                    </Label>
                  </div>
                  <Switch
                    id="is_collection_enabled"
                    checked={formData.is_collection_enabled}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, is_collection_enabled: checked }))
                    }
                  />
                </div>
                {formData.is_collection_enabled && (
                  <div className="flex items-center gap-2 ml-6">
                    <Label htmlFor="collection_fee" className="text-sm whitespace-nowrap">
                      Collection Fee:
                    </Label>
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        £
                      </span>
                      <Input
                        id="collection_fee"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.collection_fee}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            collection_fee: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="pl-7"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="is_active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-sm text-muted-foreground">
                  Show this location to customers
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_active: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLocation} disabled={isCreating || isUpdating}>
              {isCreating || isUpdating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {editingLocation ? 'Update Location' : 'Save Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DeliveryCollectionSettings;
