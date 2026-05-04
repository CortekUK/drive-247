'use client';

import { useFieldArray, useFormContext } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, User, Users } from 'lucide-react';
import {
  MARITAL_STATUS_OPTIONS,
  type BonzahOnboardingFormData,
  type FileUrls,
} from '../schema';
import { FileUpload } from '../file-upload';
import { SectionTitle } from './section-title';

interface Props {
  fileUrls: FileUrls;
  setFileUrls: React.Dispatch<React.SetStateAction<FileUrls>>;
}

export function Step3Contacts({ fileUrls, setFileUrls }: Props) {
  const form = useFormContext<BonzahOnboardingFormData>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'additional_users',
  });

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={User}
        title="Primary Contact"
        description="The main person we'll work with on your account."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="primary_first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                First Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="First name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="primary_last_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Last Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Last name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="primary_email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Email <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="email" placeholder="contact@yourcompany.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="primary_phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Phone <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="tel" placeholder="+1 (555) 123-4567" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <FormField
          control={form.control}
          name="primary_date_of_birth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Date of Birth <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="primary_years_driving"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Years Driving <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input type="number" min="0" placeholder="e.g. 15" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="primary_marital_status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Marital Status <span className="text-destructive">*</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {MARITAL_STATUS_OPTIONS.map((opt) => (
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

      <SectionTitle
        icon={Users}
        title="Additional Drivers / Users"
        description="Optional — add up to 5 additional drivers who will operate the vehicles."
      />

      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 dark:bg-gray-900/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">No additional drivers added yet.</p>
        </div>
      )}

      {fields.map((arrayField, index) => (
        <div
          key={arrayField.id}
          className="rounded-lg border bg-background dark:bg-gray-900/40 p-5 space-y-5 relative"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-primary">
              Additional Driver — {index + 1}
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
              className="h-8 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Remove
            </Button>
          </div>

          <FormField
            control={form.control}
            name={`additional_users.${index}.full_name`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full Name</FormLabel>
                <FormControl>
                  <Input placeholder="Full name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              control={form.control}
              name={`additional_users.${index}.email`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="email@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`additional_users.${index}.phone`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <FormField
              control={form.control}
              name={`additional_users.${index}.date_of_birth`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`additional_users.${index}.years_driving`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Years Driving</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`additional_users.${index}.marital_status`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marital Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MARITAL_STATUS_OPTIONS.map((opt) => (
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
        </div>
      ))}

      {fields.length < 5 && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            append({
              full_name: '',
              email: '',
              phone: '',
              date_of_birth: '',
              years_driving: '',
              marital_status: '',
            })
          }
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Driver
        </Button>
      )}

      <div className="space-y-2 pt-2">
        <label className="text-sm font-medium">
          Upload Driver's Licenses of any business owners and drivers{' '}
          <span className="text-destructive">*</span>
        </label>
        <FileUpload
          field="driver_licenses"
          files={fileUrls.driver_licenses ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, driver_licenses: files }))
          }
          maxFiles={10}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Additional Users Spreadsheet</label>
        <FileUpload
          field="additional_users_spreadsheet"
          files={fileUrls.additional_users_spreadsheet ?? []}
          onChange={(files) =>
            setFileUrls((prev) => ({ ...prev, additional_users_spreadsheet: files }))
          }
          maxFiles={1}
          helperText="If you have many additional users, upload a spreadsheet with name, email, and phone columns"
        />
      </div>
    </div>
  );
}
