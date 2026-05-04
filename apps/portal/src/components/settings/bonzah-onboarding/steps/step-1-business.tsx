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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2 } from 'lucide-react';
import {
  COMPANY_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  type BonzahOnboardingFormData,
  type FileUrls,
} from '../schema';
import { FileUpload } from '../file-upload';
import { SectionTitle } from './section-title';

interface Props {
  fileUrls: FileUrls;
  setFileUrls: React.Dispatch<React.SetStateAction<FileUrls>>;
}

export function Step1Business({ fileUrls, setFileUrls }: Props) {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={Building2}
        title="Rental Company Information"
        description="Tell us about your business — this becomes the company-of-record on your insurance policy."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="business_trade_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Business Trade Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Your public-facing brand name" {...field} />
              </FormControl>
              <FormDescription>What name do you use to advertise your business?</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="business_legal_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Business Legal Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="LLC, Inc., etc." {...field} />
              </FormControl>
              <FormDescription>The registered legal entity name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="business_address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Business Address <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Input placeholder="Street address" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input placeholder="City" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input placeholder="State / Province" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((opt) => (
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
        <FormField
          control={form.control}
          name="postal_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Postal Code</FormLabel>
              <FormControl>
                <Input placeholder="ZIP / Postal code" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="business_phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Business Phone <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="tel" placeholder="+1 (555) 123-4567" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="alternative_business_phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Alternative Business Phone</FormLabel>
              <FormControl>
                <Input type="tel" placeholder="Optional" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="ein"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Tax ID / EIN <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="XX-XXXXXXX" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="company_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Company Type <span className="text-destructive">*</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select entity type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {COMPANY_TYPE_OPTIONS.map((opt) => (
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
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="business_start_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business Start Date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="company_website"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company Website</FormLabel>
              <FormControl>
                <Input type="url" placeholder="https://" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Business Logo</label>
        <FileUpload
          field="business_logo"
          files={fileUrls.business_logo ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, business_logo: files }))
          }
          maxFiles={5}
        />
      </div>
    </div>
  );
}
