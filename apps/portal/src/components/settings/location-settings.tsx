'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Car,
  RotateCcw,
  List,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  usePickupLocations,
  LocationMode,
  PickupLocation,
} from '@/hooks/use-pickup-locations';

interface LocationFormData {
  name: string;
  address: string;
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
}

const EMPTY_FORM: LocationFormData = {
  name: '',
  address: '',
  is_pickup_enabled: true,
  is_return_enabled: true,
};

export function LocationSettings() {
  const {
    locationSettings,
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
  } = usePickupLocations();

  // Pickup settings
  const [pickupMode, setPickupMode] = useState<LocationMode>('custom');
  const [fixedPickupAddress, setFixedPickupAddress] = useState('');

  // Return settings
  const [returnMode, setReturnMode] = useState<LocationMode>('custom');
  const [fixedReturnAddress, setFixedReturnAddress] = useState('');

  const [hasChanges, setHasChanges] = useState(false);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<PickupLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>(EMPTY_FORM);
  const [dialogType, setDialogType] = useState<'pickup' | 'return' | 'both'>('both');

  // Sync local state with fetched settings
  useEffect(() => {
    if (locationSettings) {
      setPickupMode(locationSettings.pickup_location_mode || 'custom');
      setReturnMode(locationSettings.return_location_mode || 'custom');
      setFixedPickupAddress(locationSettings.fixed_pickup_address || '');
      setFixedReturnAddress(locationSettings.fixed_return_address || '');
      setHasChanges(false);
    }
  }, [locationSettings]);

  // Track changes
  useEffect(() => {
    if (!locationSettings) return;

    const changed =
      pickupMode !== (locationSettings.pickup_location_mode || 'custom') ||
      returnMode !== (locationSettings.return_location_mode || 'custom') ||
      fixedPickupAddress !== (locationSettings.fixed_pickup_address || '') ||
      fixedReturnAddress !== (locationSettings.fixed_return_address || '');
    setHasChanges(changed);
  }, [pickupMode, returnMode, fixedPickupAddress, fixedReturnAddress, locationSettings]);

  // Filter locations by type
  const pickupLocations = locations.filter(loc => loc.is_pickup_enabled);
  const returnLocations = locations.filter(loc => loc.is_return_enabled);

  const handleSaveSettings = async () => {
    try {
      await updateSettings({
        pickup_location_mode: pickupMode,
        return_location_mode: returnMode,
        fixed_pickup_address: pickupMode === 'fixed' ? fixedPickupAddress : null,
        fixed_return_address: returnMode === 'fixed' ? fixedReturnAddress : null,
      });
      setHasChanges(false);
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleOpenAddDialog = (type: 'pickup' | 'return') => {
    setEditingLocation(null);
    setDialogType(type);
    setFormData({
      ...EMPTY_FORM,
      is_pickup_enabled: type === 'pickup',
      is_return_enabled: type === 'return',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (location: PickupLocation) => {
    setEditingLocation(location);
    setDialogType('both');
    setFormData({
      name: location.name,
      address: location.address,
      is_pickup_enabled: location.is_pickup_enabled,
      is_return_enabled: location.is_return_enabled,
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

    try {
      if (editingLocation) {
        await updateLocation({
          id: editingLocation.id,
          name: formData.name.trim(),
          address: formData.address.trim(),
          is_pickup_enabled: formData.is_pickup_enabled,
          is_return_enabled: formData.is_return_enabled,
        });
      } else {
        await createLocation({
          name: formData.name.trim(),
          address: formData.address.trim(),
          is_pickup_enabled: formData.is_pickup_enabled,
          is_return_enabled: formData.is_return_enabled,
        });
      }
      setIsDialogOpen(false);
      setFormData(EMPTY_FORM);
      setEditingLocation(null);
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleDeleteLocation = async (id: string) => {
    try {
      await deleteLocation(id);
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleToggleActive = async (location: PickupLocation) => {
    try {
      await updateLocation({
        id: location.id,
        is_active: !location.is_active,
      });
    } catch (error) {
      // Error handled in hook
    }
  };

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading location settings...</span>
        </CardContent>
      </Card>
    );
  }

  // Inline locations table component
  const LocationsTable = ({
    type,
    locationsList
  }: {
    type: 'pickup' | 'return';
    locationsList: PickupLocation[]
  }) => (
    <div className="mt-4 ml-6 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {locationsList.length === 0
            ? 'No locations added yet'
            : `${locationsList.length} location${locationsList.length > 1 ? 's' : ''}`}
        </p>
        <Button size="sm" variant="outline" onClick={() => handleOpenAddDialog(type)}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {locationsList.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="w-[60px] text-center">Active</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locationsList.map((location) => (
                <TableRow key={location.id} className={!location.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium py-2">{location.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm py-2 max-w-[180px] truncate">
                    {location.address}
                  </TableCell>
                  <TableCell className="text-center py-2">
                    <Switch
                      checked={location.is_active}
                      onCheckedChange={() => handleToggleActive(location)}
                      disabled={isUpdating}
                    />
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleOpenEditDialog(location)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Location</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{location.name}"?
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
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Pickup Location Settings */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Car className="h-5 w-5 text-green-600" />
            Pickup Location
          </CardTitle>
          <CardDescription>
            How customers select where to pick up the vehicle
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={pickupMode}
            onValueChange={(value: LocationMode) => {
              setPickupMode(value);
              setHasChanges(true);
            }}
            className="space-y-3"
          >
            {/* Fixed Address Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                pickupMode === 'fixed'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setPickupMode('fixed'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="fixed" id="pickup-fixed" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="pickup-fixed" className="font-medium cursor-pointer">
                    Fixed Address
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    All customers pick up from one location
                  </p>
                </div>
              </div>
              {pickupMode === 'fixed' && (
                <div className="mt-3 ml-6" onClick={(e) => e.stopPropagation()}>
                  <LocationAutocomplete
                    value={fixedPickupAddress}
                    onChange={(value) => {
                      setFixedPickupAddress(value);
                      setHasChanges(true);
                    }}
                    placeholder="Enter the fixed pickup address"
                  />
                </div>
              )}
            </div>

            {/* Custom Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                pickupMode === 'custom'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setPickupMode('custom'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="custom" id="pickup-custom" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="pickup-custom" className="font-medium cursor-pointer">
                    Custom
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Customers can enter any address
                  </p>
                </div>
              </div>
            </div>

            {/* Multiple Select Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                pickupMode === 'multiple'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setPickupMode('multiple'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="multiple" id="pickup-multiple" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="pickup-multiple" className="font-medium cursor-pointer flex items-center gap-2">
                    <List className="h-4 w-4" />
                    Multiple Locations
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Customers choose from predefined locations
                  </p>
                </div>
              </div>
              {pickupMode === 'multiple' && (
                <div onClick={(e) => e.stopPropagation()}>
                  <LocationsTable type="pickup" locationsList={pickupLocations} />
                </div>
              )}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Return Location Settings */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <RotateCcw className="h-5 w-5 text-blue-600" />
            Return Location
          </CardTitle>
          <CardDescription>
            How customers select where to return the vehicle
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={returnMode}
            onValueChange={(value: LocationMode) => {
              setReturnMode(value);
              setHasChanges(true);
            }}
            className="space-y-3"
          >
            {/* Fixed Address Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                returnMode === 'fixed'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setReturnMode('fixed'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="fixed" id="return-fixed" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="return-fixed" className="font-medium cursor-pointer">
                    Fixed Address
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    All customers return to one location
                  </p>
                </div>
              </div>
              {returnMode === 'fixed' && (
                <div className="mt-3 ml-6" onClick={(e) => e.stopPropagation()}>
                  <LocationAutocomplete
                    value={fixedReturnAddress}
                    onChange={(value) => {
                      setFixedReturnAddress(value);
                      setHasChanges(true);
                    }}
                    placeholder="Enter the fixed return address"
                  />
                </div>
              )}
            </div>

            {/* Custom Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                returnMode === 'custom'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setReturnMode('custom'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="custom" id="return-custom" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="return-custom" className="font-medium cursor-pointer">
                    Custom
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Customers can enter any address
                  </p>
                </div>
              </div>
            </div>

            {/* Multiple Select Option */}
            <div
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                returnMode === 'multiple'
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
              onClick={() => { setReturnMode('multiple'); setHasChanges(true); }}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="multiple" id="return-multiple" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="return-multiple" className="font-medium cursor-pointer flex items-center gap-2">
                    <List className="h-4 w-4" />
                    Multiple Locations
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Customers choose from predefined locations
                  </p>
                </div>
              </div>
              {returnMode === 'multiple' && (
                <div onClick={(e) => e.stopPropagation()}>
                  <LocationsTable type="return" locationsList={returnLocations} />
                </div>
              )}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSaveSettings} disabled={!hasChanges || isUpdatingSettings}>
          {isUpdatingSettings ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </div>

      {/* Add/Edit Location Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingLocation ? 'Edit Location' : 'Add Location'}
            </DialogTitle>
            <DialogDescription>
              {editingLocation
                ? 'Update the location details'
                : `Add a new ${dialogType} location`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="locationName">Name *</Label>
              <Input
                id="locationName"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Downtown Office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="locationAddress">Address *</Label>
              <LocationAutocomplete
                id="locationAddress"
                value={formData.address}
                onChange={(value) => setFormData((prev) => ({ ...prev, address: value }))}
                placeholder="Start typing an address..."
              />
            </div>
            {editingLocation && (
              <div className="space-y-3 pt-2">
                <Label>Available for</Label>
                <div className="flex items-center space-x-6">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_pickup_enabled"
                      checked={formData.is_pickup_enabled}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, is_pickup_enabled: checked }))
                      }
                    />
                    <Label htmlFor="is_pickup_enabled" className="cursor-pointer">
                      Pickup
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_return_enabled"
                      checked={formData.is_return_enabled}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, is_return_enabled: checked }))
                      }
                    />
                    <Label htmlFor="is_return_enabled" className="cursor-pointer">
                      Return
                    </Label>
                  </div>
                </div>
              </div>
            )}
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
              {editingLocation ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LocationSettings;
