'use client';

import { useFormContext, type Path } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { BonzahOnboardingFormData } from '../schema';

interface YesNoFieldProps {
  name: Path<BonzahOnboardingFormData>;
  label: string;
  required?: boolean;
  description?: string;
  className?: string;
}

export function YesNoField({
  name,
  label,
  required,
  description,
  className,
}: YesNoFieldProps) {
  const form = useFormContext<BonzahOnboardingFormData>();

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn('space-y-3', className)}>
          <FormLabel className="text-sm font-medium leading-snug">
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </FormLabel>
          {description && <FormDescription>{description}</FormDescription>}
          <FormControl>
            <RadioGroup
              onValueChange={field.onChange}
              value={(field.value as string) || ''}
              className="flex gap-6"
            >
              <label
                className={cn(
                  'flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 transition-colors',
                  'hover:bg-muted/60 dark:hover:bg-gray-900/60',
                  field.value === 'yes'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-input',
                )}
              >
                <RadioGroupItem value="yes" />
                <span className="text-sm font-medium">Yes</span>
              </label>
              <label
                className={cn(
                  'flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 transition-colors',
                  'hover:bg-muted/60 dark:hover:bg-gray-900/60',
                  field.value === 'no'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-input',
                )}
              >
                <RadioGroupItem value="no" />
                <span className="text-sm font-medium">No</span>
              </label>
            </RadioGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
