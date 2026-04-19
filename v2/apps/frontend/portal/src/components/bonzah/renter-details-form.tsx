'use client';

import { Input, Label } from '@drive247/ui';
import type { RenterDetails } from '@drive247/shared-types';

interface Props {
  value: RenterDetails;
  onChange: (value: RenterDetails) => void;
}

/**
 * Renter details form. Pre-fill from the rental's customer record before
 * mounting — this component is dumb and just edits the in-memory object.
 *
 * Email is labeled clearly (rule #17): the policy confirmation is sent
 * to this address, not the tenant's customer record email.
 */
export function RenterDetailsForm({ value, onChange }: Props) {
  const set = <K extends keyof RenterDetails>(k: K, v: RenterDetails[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input
            value={value.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            required
            className="bg-white"
          />
        </Field>
        <Field label="Last name">
          <Input
            value={value.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            required
            className="bg-white"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <Input
            type="date"
            value={value.dob}
            onChange={(e) => set('dob', e.target.value)}
            required
            className="bg-white"
          />
        </Field>
        <Field label="US phone (11 digits: 1 + area code + number)">
          <Input
            inputMode="numeric"
            pattern="\d{11}"
            value={value.phone}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
            required
            placeholder="19175551234"
            className="bg-white"
          />
          <p className="text-xs text-muted-foreground">
            Bonzah is US-only. Use a US number like <code>19175551234</code>.
            Non-US numbers are not accepted.
          </p>
        </Field>
      </div>

      <Field label="Email — policy confirmation will be sent here">
        <Input
          type="email"
          value={value.email}
          onChange={(e) => set('email', e.target.value)}
          required
          className="bg-white"
        />
      </Field>

      <div className="space-y-2 pt-2 border-t">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Driver License
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="License number">
            <Input
              value={value.license.number}
              onChange={(e) =>
                onChange({
                  ...value,
                  license: { ...value.license, number: e.target.value },
                })
              }
              required
              className="bg-white"
            />
          </Field>
          <Field label="Issuing state (2-letter)">
            <Input
              value={value.license.state}
              maxLength={2}
              onChange={(e) =>
                onChange({
                  ...value,
                  license: {
                    ...value.license,
                    state: e.target.value.toUpperCase(),
                  },
                })
              }
              required
              className="bg-white"
            />
          </Field>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Residence Address
        </div>
        <Field label="Street">
          <Input
            value={value.address.street}
            onChange={(e) =>
              onChange({
                ...value,
                address: { ...value.address, street: e.target.value },
              })
            }
            required
            className="bg-white"
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City">
            <Input
              value={value.address.city}
              onChange={(e) =>
                onChange({
                  ...value,
                  address: { ...value.address, city: e.target.value },
                })
              }
              required
              className="bg-white"
            />
          </Field>
          <Field label="State">
            <Input
              value={value.address.state}
              maxLength={2}
              onChange={(e) =>
                onChange({
                  ...value,
                  address: {
                    ...value.address,
                    state: e.target.value.toUpperCase(),
                  },
                })
              }
              required
              className="bg-white"
            />
          </Field>
          <Field label="ZIP">
            <Input
              value={value.address.zip}
              onChange={(e) =>
                onChange({
                  ...value,
                  address: { ...value.address, zip: e.target.value },
                })
              }
              required
              className="bg-white"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
