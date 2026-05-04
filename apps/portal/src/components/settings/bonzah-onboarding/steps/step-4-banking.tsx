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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Banknote, CreditCard, Lock } from 'lucide-react';
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  type BonzahOnboardingFormData,
} from '../schema';
import { SectionTitle } from './section-title';
import { YesNoField } from './yes-no-field';

export function Step4Banking() {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <div className="space-y-8">
      <div className="rounded-lg border bg-blue-50/60 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/60 p-4 flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
          <Lock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="text-sm text-blue-900 dark:text-blue-200">
          Banking and card information is sent directly to Bonzah for setup. Drive247 stores
          submissions encrypted at rest and only super admins can view them.
        </div>
      </div>

      <SectionTitle
        icon={Banknote}
        title="Bank Information"
        description="The bank account associated with your business."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="bank_account_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Name on Bank Account <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Your company name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="bank_account_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Bank Account Type <span className="text-destructive">*</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {BANK_ACCOUNT_TYPE_OPTIONS.map((opt) => (
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
          name="bank_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Bank Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="e.g. Chase, Wells Fargo" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="routing_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Routing Number <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="9 digits" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="account_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Account Number <span className="text-destructive">*</span>
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
          name="reenter_account_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Re-enter Account Number <span className="text-destructive">*</span>
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
        name="bank_account_address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Address Associated with Bank Account <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={3} placeholder="Full mailing address" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <SectionTitle
        icon={CreditCard}
        title="Card Information"
        description="Card on file for insurance prepayment and starting balance."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="credit_card_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Credit Card Number <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="•••• •••• •••• ••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="card_expiration_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Expiration Date <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="MM / YY" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="card_security_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Security Code <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="CVC" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="card_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Name on Card <span className="text-destructive">*</span>
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
        name="card_billing_address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Billing Address for Card <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="desired_starting_balance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Desired Starting Balance</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 500" {...field} />
              </FormControl>
              <FormDescription>Insurance prepayment amount, if any.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="rental_management_system"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rental Management System</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Loopit, Rent Centric, 1Now, HQ, Other" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <YesNoField
        name="explore_embedding_bonzah"
        label="Would you like to explore embedding Bonzah on your site?"
      />
    </div>
  );
}
