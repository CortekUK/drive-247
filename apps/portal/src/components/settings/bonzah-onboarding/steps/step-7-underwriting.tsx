'use client';

import { ShieldAlert } from 'lucide-react';
import { SectionTitle } from './section-title';
import { YesNoField } from './yes-no-field';

export function Step7Underwriting() {
  return (
    <div className="space-y-8">
      <SectionTitle
        icon={ShieldAlert}
        title="Underwriting Questions"
        description="These questions help Bonzah assess risk. Please answer accurately — incorrect answers can void coverage."
      />

      <div className="rounded-lg border bg-amber-50/60 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/60 p-4">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          <strong>Heads up:</strong> a "Yes" on one of these doesn't necessarily disqualify
          you, but full disclosure is required. Coverage can be voided if material facts are
          omitted.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="uw_accidents_past_3_years"
          label="Have any of the operators had any accidents or claims in the past 3 years?"
          required
        />
        <YesNoField
          name="uw_canceled_policy"
          label="Do you have a previously canceled or non-renewed insurance policy?"
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="uw_insurance_fraud"
          label="Has any person on the policy ever been convicted of insurance fraud?"
          required
        />
        <YesNoField
          name="uw_dui_violations"
          label="Do you or any drivers have any DUI, reckless driving or other serious violations or evidence of multiple types of violations in the last 3 years?"
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="uw_invalid_license_drivers"
          label="Do any of your drivers operate without a valid license, or with a revoked/suspended/cancelled license? Are any of them under the age of 16?"
          required
        />
        <YesNoField
          name="uw_salvage_title"
          label="Do any of your vehicles have a salvage title?"
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <YesNoField
          name="uw_modified_for_performance"
          label="Has any of your vehicles been modified for performance?"
          required
        />
        <YesNoField
          name="uw_other_use"
          label="Will any vehicle on the policy be used for any reasons other than for rentals (on a rental platform or through rental platform software) or routine maintenance use?"
          required
        />
      </div>
    </div>
  );
}
