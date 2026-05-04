'use client';

import { useFormContext } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, FileSignature } from 'lucide-react';
import type { BonzahOnboardingFormData, FileUrls } from '../schema';
import { SectionTitle } from './section-title';
import { SignaturePad } from '../signature-pad';

interface Props {
  fileUrls: FileUrls;
}

const summaryItem = (label: string, value: React.ReactNode) => (
  <div className="flex justify-between gap-3 py-2 border-b border-border/50 dark:border-gray-800/60 last:border-0">
    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {label}
    </span>
    <span className="text-sm font-medium text-right truncate max-w-[60%]">
      {value || <span className="text-muted-foreground italic">—</span>}
    </span>
  </div>
);

export function Step8Review({ fileUrls }: Props) {
  const form = useFormContext<BonzahOnboardingFormData>();
  const v = form.watch();

  const totalFiles = Object.values(fileUrls).reduce(
    (acc, arr) => acc + (arr?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={CheckCircle2}
        title="Review & Sign"
        description="Quick summary of what you've entered. Edit any earlier step before signing."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-muted/30 dark:bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Business
          </h4>
          {summaryItem('Trade Name', v.business_trade_name)}
          {summaryItem('Legal Name', v.business_legal_name)}
          {summaryItem('EIN', v.ein)}
          {summaryItem('Phone', v.business_phone)}
          {summaryItem('Address', v.business_address)}
        </div>
        <div className="rounded-lg border bg-muted/30 dark:bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Primary Contact
          </h4>
          {summaryItem('Name', `${v.primary_first_name || ''} ${v.primary_last_name || ''}`.trim())}
          {summaryItem('Email', v.primary_email)}
          {summaryItem('Phone', v.primary_phone)}
          {summaryItem('Years Driving', v.primary_years_driving)}
          {summaryItem('Additional Drivers', String(v.additional_users?.length ?? 0))}
        </div>
        <div className="rounded-lg border bg-muted/30 dark:bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Banking
          </h4>
          {summaryItem('Bank', v.bank_name)}
          {summaryItem('Account Type', v.bank_account_type)}
          {summaryItem('Account Holder', v.bank_account_name)}
          {summaryItem('Card on File', v.card_name ? '•••• Provided' : '')}
        </div>
        <div className="rounded-lg border bg-muted/30 dark:bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Insurance & Documents
          </h4>
          {summaryItem('Carrier', v.current_insurance_carrier)}
          {summaryItem('Files Uploaded', String(totalFiles))}
          {summaryItem('GPS Tracking', v.vehicles_have_gps)}
          {summaryItem('Min Age Renters', v.minimum_age_renters)}
        </div>
      </div>

      <SectionTitle
        icon={FileSignature}
        title="Declaration & Signature"
        description="Confirm and sign to submit the application."
      />

      <div className="space-y-4 rounded-lg border bg-background dark:bg-gray-900/40 p-5">
        <p className="text-sm font-medium">
          I, the Preparer of this form, declare that:
        </p>
        <FormField
          control={form.control}
          name="declare_complete_accurate"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-tight">
                <FormLabel className="text-sm font-normal">
                  All of the information supplied on this form is complete, true, and
                  accurate.
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="declare_authorized"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-tight">
                <FormLabel className="text-sm font-normal">
                  I am authorized to submit this form.
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="declare_authorize_bonzah"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-tight">
                <FormLabel className="text-sm font-normal">
                  I authorize Bonzah and Bonzah's assignees to obtain from any person or
                  organization any further information required.
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="signature_data_url"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Signature of Preparer <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <SignaturePad value={field.value} onChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="agree_user_agreement"
        render={({ field }) => (
          <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-lg border bg-muted/30 dark:bg-gray-900/40 p-4">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <div className="space-y-1 leading-tight">
              <FormLabel className="text-sm font-normal">
                I agree to the{' '}
                <a
                  href="https://bonzah.com/user-agreement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80"
                >
                  User Agreement
                </a>
                .
              </FormLabel>
              <FormMessage />
            </div>
          </FormItem>
        )}
      />
    </div>
  );
}
