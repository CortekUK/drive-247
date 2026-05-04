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
import { ScrollText } from 'lucide-react';
import type { BonzahOnboardingFormData } from '../schema';
import { SectionTitle } from './section-title';
import { YesNoField } from './yes-no-field';

export function Step2Operations() {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={ScrollText}
        title="Operations & Ownership"
        description="Where you operate, your licensing posture, and who owns the business."
      />

      <FormField
        control={form.control}
        name="states_where_you_do_business"
        render={({ field }) => (
          <FormItem>
            <FormLabel>States Where You Do Business</FormLabel>
            <FormControl>
              <Input placeholder="e.g. CA, NV, AZ" {...field} />
            </FormControl>
            <FormDescription>
              List the states where you have an office or where your rentals originate from.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="licensed_in_all_locations"
          label="Are you licensed to do business in all locations where you do business?"
          required
        />
        <YesNoField
          name="adhering_to_license_requirements"
          label="Are you adhering to relevant auto dealership and/or auto rental operation business license requirements in your locations/jurisdictions?"
          required
        />
      </div>

      <FormField
        control={form.control}
        name="business_owners"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Who are the business owners? <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea
                rows={5}
                placeholder="Include names, ownership percentage, address, and date of birth for each owner."
                {...field}
              />
            </FormControl>
            <FormDescription>
              Include names, ownership percentage, address, and date of birth.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="years_in_private_auto_rental"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Years in Private Auto Rental <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="number" min="0" placeholder="e.g. 5" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="years_on_turo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Years on Turo <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="number" min="0" placeholder="e.g. 3" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
