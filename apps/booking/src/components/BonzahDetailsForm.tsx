import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, UserCheck, MapPin } from "lucide-react";
import { US_STATES } from "@/lib/us-states";

export interface BonzahDetailsValues {
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  licenseNumber: string;
  licenseState: string;
  driverDOB: string;
}

interface BonzahDetailsFormProps {
  initialValues: BonzahDetailsValues;
  isAuthenticated: boolean;
  onSubmit: (values: BonzahDetailsValues) => void;
  onBack: () => void;
}

export default function BonzahDetailsForm({
  initialValues,
  isAuthenticated,
  onSubmit,
  onBack,
}: BonzahDetailsFormProps) {
  const [values, setValues] = useState<BonzahDetailsValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof BonzahDetailsValues, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof BonzahDetailsValues, string>> = {};

    if (!values.addressStreet.trim()) newErrors.addressStreet = "Street address is required";
    if (!values.addressCity.trim()) newErrors.addressCity = "City is required";
    if (!values.addressState) newErrors.addressState = "State is required";
    if (!values.addressZip.trim()) {
      newErrors.addressZip = "ZIP code is required";
    } else if (!/^\d{5}(-\d{4})?$/.test(values.addressZip.trim())) {
      newErrors.addressZip = "Enter a valid ZIP code (e.g. 33101)";
    }
    if (!values.licenseNumber.trim()) newErrors.licenseNumber = "License number is required";
    if (!values.licenseState) newErrors.licenseState = "License state is required";
    if (!values.driverDOB) {
      newErrors.driverDOB = "Date of birth is required";
    } else {
      const dob = new Date(values.driverDOB);
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      if (age < 21) newErrors.driverDOB = "You must be at least 21 years old";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSubmit(values);
    }
  };

  const hasPrefilledData = isAuthenticated && (
    initialValues.addressStreet || initialValues.addressCity || initialValues.licenseNumber
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card className="overflow-hidden border-2 border-border/50">
        <div className="p-6 md:p-8 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-accent/10">
              <MapPin className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h4 className="text-lg font-semibold">Insurance Details</h4>
              <p className="text-sm text-muted-foreground">
                Required to generate your insurance quote
              </p>
            </div>
          </div>

          {/* Auth pre-fill banner */}
          {hasPrefilledData && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                <p className="text-sm text-primary font-medium">
                  Pre-filled from your account. Review and continue.
                </p>
              </div>
            </div>
          )}

          {/* Address Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bonzah-street" className="font-medium">Street Address *</Label>
              <Input
                id="bonzah-street"
                value={values.addressStreet}
                onChange={e => {
                  setValues(prev => ({ ...prev, addressStreet: e.target.value }));
                  if (errors.addressStreet) setErrors(prev => ({ ...prev, addressStreet: undefined }));
                }}
                placeholder="123 Main Street"
                className={`h-12 focus-visible:ring-primary ${errors.addressStreet ? 'border-destructive' : ''}`}
              />
              {errors.addressStreet && <p className="text-xs text-destructive">{errors.addressStreet}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bonzah-city" className="font-medium">City *</Label>
                <Input
                  id="bonzah-city"
                  value={values.addressCity}
                  onChange={e => {
                    setValues(prev => ({ ...prev, addressCity: e.target.value }));
                    if (errors.addressCity) setErrors(prev => ({ ...prev, addressCity: undefined }));
                  }}
                  placeholder="Miami"
                  className={`h-12 focus-visible:ring-primary ${errors.addressCity ? 'border-destructive' : ''}`}
                />
                {errors.addressCity && <p className="text-xs text-destructive">{errors.addressCity}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonzah-state" className="font-medium">State *</Label>
                <Select
                  value={values.addressState}
                  onValueChange={value => {
                    setValues(prev => ({ ...prev, addressState: value }));
                    if (errors.addressState) setErrors(prev => ({ ...prev, addressState: undefined }));
                  }}
                >
                  <SelectTrigger id="bonzah-state" className={`h-12 focus-visible:ring-primary ${errors.addressState ? 'border-destructive' : ''}`}>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {US_STATES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.addressState && <p className="text-xs text-destructive">{errors.addressState}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonzah-zip" className="font-medium">ZIP Code *</Label>
                <Input
                  id="bonzah-zip"
                  value={values.addressZip}
                  onChange={e => {
                    setValues(prev => ({ ...prev, addressZip: e.target.value }));
                    if (errors.addressZip) setErrors(prev => ({ ...prev, addressZip: undefined }));
                  }}
                  placeholder="33101"
                  className={`h-12 focus-visible:ring-primary ${errors.addressZip ? 'border-destructive' : ''}`}
                  maxLength={10}
                />
                {errors.addressZip && <p className="text-xs text-destructive">{errors.addressZip}</p>}
              </div>
            </div>
          </div>

          {/* License & DOB Fields */}
          <div className="border-t border-border/50 pt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bonzah-license" className="font-medium">Driver's License Number *</Label>
                <Input
                  id="bonzah-license"
                  value={values.licenseNumber}
                  onChange={e => {
                    setValues(prev => ({ ...prev, licenseNumber: e.target.value }));
                    if (errors.licenseNumber) setErrors(prev => ({ ...prev, licenseNumber: undefined }));
                  }}
                  placeholder="License number"
                  className={`h-12 focus-visible:ring-primary ${errors.licenseNumber ? 'border-destructive' : ''}`}
                />
                {errors.licenseNumber && <p className="text-xs text-destructive">{errors.licenseNumber}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonzah-license-state" className="font-medium">License State *</Label>
                <Select
                  value={values.licenseState}
                  onValueChange={value => {
                    setValues(prev => ({ ...prev, licenseState: value }));
                    if (errors.licenseState) setErrors(prev => ({ ...prev, licenseState: undefined }));
                  }}
                >
                  <SelectTrigger id="bonzah-license-state" className={`h-12 focus-visible:ring-primary ${errors.licenseState ? 'border-destructive' : ''}`}>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {US_STATES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.licenseState && <p className="text-xs text-destructive">{errors.licenseState}</p>}
              </div>
            </div>

            <div className="space-y-2 max-w-xs">
              <Label htmlFor="bonzah-dob" className="font-medium">Date of Birth *</Label>
              <Input
                id="bonzah-dob"
                type="date"
                value={values.driverDOB}
                onChange={e => {
                  setValues(prev => ({ ...prev, driverDOB: e.target.value }));
                  if (errors.driverDOB) setErrors(prev => ({ ...prev, driverDOB: undefined }));
                }}
                className={`h-12 focus-visible:ring-primary ${errors.driverDOB ? 'border-destructive' : ''}`}
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 21)).toISOString().split('T')[0]}
              />
              {errors.driverDOB && <p className="text-xs text-destructive">{errors.driverDOB}</p>}
              <p className="text-xs text-muted-foreground">You must be at least 21 years old</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Navigation */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          onClick={onBack}
          variant="outline"
          className="w-full sm:flex-1"
          size="lg"
        >
          <ChevronLeft className="mr-2 w-5 h-5" /> Go Back
        </Button>
        <Button
          onClick={handleSubmit}
          className="w-full sm:flex-1 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold shadow-md hover:shadow-lg transition-all"
          size="lg"
        >
          Continue to Coverage <ChevronRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
