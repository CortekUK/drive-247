'use client';

import { useFieldArray, useFormContext } from 'react-hook-form';
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
import { ScrollText, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
              A short summary is fine — the structured list below is what Bonzah receives.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Bonzah requires this as a structured block, not prose: "List every person
          with >=10% ownership." A paragraph cannot be checked against a threshold,
          and an underwriter reads it as a declaration either way. */}
      <BusinessOwnersList />

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

/**
 * Repeating owner rows.
 *
 * Ownership percentage is collected explicitly because Bonzah's own threshold is
 * stated in percent — an owner list without percentages cannot be checked
 * against "every person with >=10% ownership".
 */
function BusinessOwnersList() {
  const form = useFormContext<BonzahOnboardingFormData>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'business_owners_list',
  });

  return (
    <div className="space-y-3">
      <FormLabel>Owners with 10% or more ownership</FormLabel>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No owners added yet. Bonzah requires at least one.
        </p>
      )}

      {fields.map((row, i) => (
        <div key={row.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-4">
          <FormField
            control={form.control}
            name={`business_owners_list.${i}.full_name` as const}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Full name</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`business_owners_list.${i}.ownership_percent` as const}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Ownership %</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" {...field} value={field.value ?? ''} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`business_owners_list.${i}.date_of_birth` as const}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Date of birth</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ''} />
                </FormControl>
              </FormItem>
            )}
          />
          <div className="flex items-end gap-2">
            <FormField
              control={form.control}
              name={`business_owners_list.${i}.email` as const}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel className="text-xs">Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} value={field.value ?? ''} />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove owner ${i + 1}`}
              onClick={() => remove(i)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          append({ full_name: '', ownership_percent: '', date_of_birth: '', email: '' })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add owner
      </Button>
    </div>
  );
}
