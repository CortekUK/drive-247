'use client';

import { useFormContext } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClipboardCheck, FileText, Wrench } from 'lucide-react';
import {
  SECURITY_FEATURE_OPTIONS,
  type BonzahOnboardingFormData,
  type FileUrls,
} from '../schema';
import { FileUpload } from '../file-upload';
import { SectionTitle } from './section-title';
import { YesNoField } from './yes-no-field';

interface Props {
  fileUrls: FileUrls;
  setFileUrls: React.Dispatch<React.SetStateAction<FileUrls>>;
}

export function Step6Policies({ fileUrls, setFileUrls }: Props) {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={ClipboardCheck}
        title="Driver & Operations Policy"
        description="How you screen drivers and secure your fleet."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="require_drivers_valid_license"
          label="Do you require all drivers, including employees, to hold a valid driver's license?"
          required
        />
        <YesNoField
          name="check_employee_driving_records"
          label="Do you check the driving records of your employees?"
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          control={form.control}
          name="vehicle_storage_security"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Which security features do you have where you store your vehicles when they are not being rented?{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select security features" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SECURITY_FEATURE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <YesNoField
          name="deliver_or_pickup"
          label="Do you deliver and/or pick-up rental vehicles to/from renters?"
          required
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="minimum_age_renters"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Minimum age requirement for renters{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="number" min="0" placeholder="e.g. 21" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <YesNoField
          name="rent_more_than_30_days"
          label="Do you rent vehicles for more than 30 days?"
          required
        />
      </div>

      <FormField
        control={form.control}
        name="average_rental_duration"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              What is the average rental duration?{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Input placeholder="e.g. 3 days" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <SectionTitle
        icon={FileText}
        title="Renter Screening & Documentation"
        description="Your process for vetting renters and the records you keep."
      />

      <FormField
        control={form.control}
        name="renter_screening_process"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Describe your renter onboarding and screening process{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={4} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="renter_stolen_vehicle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Has a renter ever stolen or converted a vehicle?{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Yes / No — please explain if Yes" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <YesNoField
          name="photocopy_driver_ids"
          label="Do you take a photocopy of all driver IDs?"
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="require_renters_primary_insurance"
          label="Do you require renters to have or purchase primary insurance?"
          required
        />
        <YesNoField
          name="verify_renter_insurance"
          label="Do you verify a renter's insurance is active?"
          required
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="pct_renters_with_insurance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                What percentage of renters have personal auto insurance?{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="e.g. 80%" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="retain_renter_insurance_proof"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Do you retain renter's proof of primary insurance? If yes, how long?{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="e.g. 12 months" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <SectionTitle
        icon={Wrench}
        title="Payments & Maintenance"
        description="How you collect from renters and how you keep vehicles roadworthy."
      />

      <FormField
        control={form.control}
        name="payment_methods"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              What payment methods do you accept?{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="e.g. Cash, CashApp, Credit Card" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="cash_app_card_on_file"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                When accepting cash or app payments (Paypal, Venmo, CashApp, etc.), do you also require a card to be on file?
              </FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="offers_otc_insurance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Do you currently offer over-the-counter insurance products for vehicle renters to purchase? If yes, which products?
              </FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="vehicle_maintenance_program"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Describe your vehicle maintenance program</FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="inspect_vehicles"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              How and when do you inspect vehicles?{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="what_else_should_we_know"
        render={({ field }) => (
          <FormItem>
            <FormLabel>What else should we know?</FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="own_other_businesses"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Do you own or operate any other businesses?{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={3} placeholder="If yes, briefly describe each one" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium">Upload additional information</label>
        <FileUpload
          field="additional_information_file"
          files={fileUrls.additional_information_file ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, additional_information_file: files }))
          }
          maxFiles={5}
        />
      </div>
    </div>
  );
}
