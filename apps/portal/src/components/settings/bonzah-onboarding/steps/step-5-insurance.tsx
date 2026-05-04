'use client';

import { useFormContext } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Shield, Car } from 'lucide-react';
import { type BonzahOnboardingFormData, type FileUrls } from '../schema';
import { FileUpload } from '../file-upload';
import { SectionTitle } from './section-title';
import { YesNoField } from './yes-no-field';

interface Props {
  fileUrls: FileUrls;
  setFileUrls: React.Dispatch<React.SetStateAction<FileUrls>>;
}

export function Step5Insurance({ fileUrls, setFileUrls }: Props) {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={Shield}
        title="Insurance & Fleet Documents"
        description="Current coverage, policy documents, and your vehicle schedule."
      />

      <FormField
        control={form.control}
        name="current_insurance_carrier"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Are your vehicles currently insured? Who is your current insurance carrier / provider?{' '}
              <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Input placeholder="Carrier name (or 'Not insured')" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="what_can_we_help_with"
        render={({ field }) => (
          <FormItem>
            <FormLabel>What can we help you with?</FormLabel>
            <FormControl>
              <Textarea rows={3} placeholder="Optional — anything specific you'd like our team to focus on" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Upload a copy of your fleet insurance policy{' '}
            <span className="text-destructive">*</span>
          </label>
          <FileUpload
            field="fleet_insurance_policy"
            files={fileUrls.fleet_insurance_policy ?? []}
            onChange={(files) =>
              setFileUrls((prev) => ({ ...prev, fleet_insurance_policy: files }))
            }
            maxFiles={3}
            helperText="Renter's and Driver's policy, if applicable"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Upload a copy of the rental agreement <span className="text-destructive">*</span>
          </label>
          <FileUpload
            field="rental_agreement_file"
            files={fileUrls.rental_agreement_file ?? []}
            onChange={(files) =>
              setFileUrls((prev) => ({ ...prev, rental_agreement_file: files }))
            }
            maxFiles={3}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Upload a copy of your loss runs</label>
        <FileUpload
          field="loss_runs_file"
          files={fileUrls.loss_runs_file ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, loss_runs_file: files }))
          }
          maxFiles={3}
          helperText="If applicable"
        />
      </div>

      <YesNoField
        name="rental_agreement_has_timestamp"
        label="Does your Rental Agreement have a digital or mechanical timestamp?"
        required
      />

      <SectionTitle
        icon={Car}
        title="Vehicle & Fleet"
        description="Information about the vehicles you'll be insuring."
      />

      <div className="space-y-2">
        <label className="text-sm font-medium">
          Vehicle Schedule <span className="text-destructive">*</span>
        </label>
        <FileUpload
          field="vehicle_schedule_file"
          files={fileUrls.vehicle_schedule_file ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, vehicle_schedule_file: files }))
          }
          maxFiles={1}
          helperText="Spreadsheet with VIN, current mileage, registrant name & address, lienholder name & address"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="vehicles_have_gps"
          label="Do your vehicles have GPS or tracking devices?"
          required
        />
        <FormField
          control={form.control}
          name="gps_brand"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What Brand?</FormLabel>
              <FormControl>
                <Input placeholder="GPS / tracking brand if applicable" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="vehicles_registered_in_company_name"
          label="Are all vehicles registered in company name or leased to the business?"
          required
        />
        <YesNoField
          name="any_vehicles_salvage"
          label="Do any of your vehicles have salvage or rebuilt title?"
          required
        />
      </div>

      <YesNoField
        name="rent_for_hire"
        label='Do you rent any vehicles that are used "for hire" or for use with Transportation Networks (Uber, Lyft, Doordash, etc.)?'
        required
      />

      <YesNoField
        name="vehicles_used_outside_rentals"
        label="Do you allow your vehicles to be used for any other purpose outside of private rentals?"
      />

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="had_commercial_auto_losses"
          label="Have you had any Commercial Auto losses?"
          required
        />
        <YesNoField
          name="has_loss_summary"
          label="Do you have a loss summary (loss run) from your previous carrier?"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Loss History</label>
        <FormDescription>
          Upload your Turo, business, and personal loss history over the last 5 years including any pending claims.
        </FormDescription>
        <FileUpload
          field="loss_history_file"
          files={fileUrls.loss_history_file ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, loss_history_file: files }))
          }
          maxFiles={3}
        />
      </div>
    </div>
  );
}
