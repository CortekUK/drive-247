import { z } from 'zod';

const yesNo = z.enum(['yes', 'no'], { required_error: 'Please select an option' });
const optYesNo = z.enum(['yes', 'no']).optional();
const optStr = z.string().optional().or(z.literal(''));
const reqStr = (msg = 'Required') => z.string().min(1, msg);

const additionalUserSchema = z.object({
  full_name: optStr,
  email: optStr,
  phone: optStr,
  date_of_birth: optStr,
  years_driving: optStr,
  marital_status: optStr,
});

export const bonzahOnboardingSchema = z
  .object({
    // Step 1 — Business Info
    business_trade_name: reqStr('Business trade name is required'),
    business_legal_name: reqStr('Business legal name is required'),
    business_address: reqStr('Business address is required'),
    city: optStr,
    state: optStr,
    country: optStr,
    postal_code: optStr,
    business_phone: reqStr('Business phone is required'),
    alternative_business_phone: optStr,
    ein: reqStr('Tax ID / EIN is required'),
    company_type: reqStr('Please select company type'),
    business_start_date: optStr,
    company_website: optStr,

    // Step 2 — Operations & Owners
    states_where_you_do_business: optStr,
    licensed_in_all_locations: yesNo,
    adhering_to_license_requirements: yesNo,
    business_owners: reqStr('Please describe the business owners'),
    years_in_private_auto_rental: reqStr('Required'),
    years_on_turo: reqStr('Required'),

    // Step 3 — Contacts
    primary_first_name: reqStr('First name is required'),
    primary_last_name: reqStr('Last name is required'),
    primary_email: z.string().email('Enter a valid email'),
    primary_phone: reqStr('Phone is required'),
    primary_date_of_birth: reqStr('Date of birth is required'),
    primary_years_driving: reqStr('Required'),
    primary_marital_status: reqStr('Please select marital status'),
    additional_users: z.array(additionalUserSchema).max(5),

    // Step 4 — Banking & Payment
    bank_account_name: reqStr('Required'),
    bank_account_type: reqStr('Please select account type'),
    bank_name: reqStr('Required'),
    routing_number: reqStr('Required'),
    account_number: reqStr('Required'),
    reenter_account_number: reqStr('Required'),
    bank_account_address: reqStr('Required'),
    credit_card_number: reqStr('Required'),
    card_expiration_date: reqStr('Required'),
    card_security_code: reqStr('Required'),
    card_name: reqStr('Required'),
    card_billing_address: reqStr('Required'),
    desired_starting_balance: optStr,
    rental_management_system: optStr,
    explore_embedding_bonzah: optYesNo,

    // Step 5 — Insurance & Fleet
    current_insurance_carrier: reqStr('Required'),
    what_can_we_help_with: optStr,
    rental_agreement_has_timestamp: yesNo,
    vehicles_have_gps: yesNo,
    gps_brand: optStr,
    vehicles_registered_in_company_name: yesNo,
    any_vehicles_salvage: yesNo,
    rent_for_hire: yesNo,
    vehicles_used_outside_rentals: optYesNo,
    had_commercial_auto_losses: yesNo,
    has_loss_summary: optYesNo,

    // Step 6 — Renter Policies
    require_drivers_valid_license: yesNo,
    check_employee_driving_records: yesNo,
    vehicle_storage_security: reqStr('Please select an option'),
    deliver_or_pickup: yesNo,
    minimum_age_renters: reqStr('Required'),
    rent_more_than_30_days: yesNo,
    average_rental_duration: reqStr('Required'),
    renter_screening_process: reqStr('Required'),
    renter_stolen_vehicle: reqStr('Required'),
    photocopy_driver_ids: yesNo,
    require_renters_primary_insurance: yesNo,
    verify_renter_insurance: yesNo,
    pct_renters_with_insurance: reqStr('Required'),
    retain_renter_insurance_proof: reqStr('Required'),
    payment_methods: reqStr('Required'),
    cash_app_card_on_file: optStr,
    offers_otc_insurance: optStr,
    vehicle_maintenance_program: optStr,
    inspect_vehicles: reqStr('Required'),
    what_else_should_we_know: optStr,
    own_other_businesses: reqStr('Required'),

    // Step 7 — Underwriting
    uw_accidents_past_3_years: yesNo,
    uw_canceled_policy: yesNo,
    uw_insurance_fraud: yesNo,
    uw_dui_violations: yesNo,
    uw_invalid_license_drivers: yesNo,
    uw_salvage_title: yesNo,
    uw_modified_for_performance: yesNo,
    uw_other_use: yesNo,

    // Step 8 — Sign & Submit
    declare_complete_accurate: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm this declaration' }),
    }),
    declare_authorized: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm this declaration' }),
    }),
    declare_authorize_bonzah: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm this declaration' }),
    }),
    signature_data_url: reqStr('Please sign in the box'),
    agree_user_agreement: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to continue' }),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.account_number && data.reenter_account_number && data.account_number !== data.reenter_account_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reenter_account_number'],
        message: 'Account numbers do not match',
      });
    }
  });

export type BonzahOnboardingFormData = z.infer<typeof bonzahOnboardingSchema>;

// Field groups per step — used to validate only the current step on Next
export const stepFields: Record<number, (keyof BonzahOnboardingFormData)[]> = {
  1: [
    'business_trade_name',
    'business_legal_name',
    'business_address',
    'city',
    'state',
    'country',
    'postal_code',
    'business_phone',
    'alternative_business_phone',
    'ein',
    'company_type',
    'business_start_date',
    'company_website',
  ],
  2: [
    'states_where_you_do_business',
    'licensed_in_all_locations',
    'adhering_to_license_requirements',
    'business_owners',
    'years_in_private_auto_rental',
    'years_on_turo',
  ],
  3: [
    'primary_first_name',
    'primary_last_name',
    'primary_email',
    'primary_phone',
    'primary_date_of_birth',
    'primary_years_driving',
    'primary_marital_status',
    'additional_users',
  ],
  4: [
    'bank_account_name',
    'bank_account_type',
    'bank_name',
    'routing_number',
    'account_number',
    'reenter_account_number',
    'bank_account_address',
    'credit_card_number',
    'card_expiration_date',
    'card_security_code',
    'card_name',
    'card_billing_address',
    'desired_starting_balance',
    'rental_management_system',
    'explore_embedding_bonzah',
  ],
  5: [
    'current_insurance_carrier',
    'what_can_we_help_with',
    'rental_agreement_has_timestamp',
    'vehicles_have_gps',
    'gps_brand',
    'vehicles_registered_in_company_name',
    'any_vehicles_salvage',
    'rent_for_hire',
    'vehicles_used_outside_rentals',
    'had_commercial_auto_losses',
    'has_loss_summary',
  ],
  6: [
    'require_drivers_valid_license',
    'check_employee_driving_records',
    'vehicle_storage_security',
    'deliver_or_pickup',
    'minimum_age_renters',
    'rent_more_than_30_days',
    'average_rental_duration',
    'renter_screening_process',
    'renter_stolen_vehicle',
    'photocopy_driver_ids',
    'require_renters_primary_insurance',
    'verify_renter_insurance',
    'pct_renters_with_insurance',
    'retain_renter_insurance_proof',
    'payment_methods',
    'cash_app_card_on_file',
    'offers_otc_insurance',
    'vehicle_maintenance_program',
    'inspect_vehicles',
    'what_else_should_we_know',
    'own_other_businesses',
  ],
  7: [
    'uw_accidents_past_3_years',
    'uw_canceled_policy',
    'uw_insurance_fraud',
    'uw_dui_violations',
    'uw_invalid_license_drivers',
    'uw_salvage_title',
    'uw_modified_for_performance',
    'uw_other_use',
  ],
  // 8 (Training) and 9 (Quiz) have no react-hook-form fields — they are gated by
  // local state in index.tsx (training acknowledgement + server-graded quiz).
  8: [],
  9: [],
  10: [
    'declare_complete_accurate',
    'declare_authorized',
    'declare_authorize_bonzah',
    'signature_data_url',
    'agree_user_agreement',
  ],
};

export const FILE_FIELDS = [
  'business_logo',
  'driver_licenses',
  'additional_users_spreadsheet',
  'fleet_insurance_policy',
  'rental_agreement_file',
  'loss_runs_file',
  'vehicle_schedule_file',
  'loss_history_file',
  'additional_information_file',
] as const;

export type FileField = (typeof FILE_FIELDS)[number];

export interface UploadedFile {
  url: string;
  path: string;
  name: string;
  size: number;
}

export type FileUrls = Partial<Record<FileField, UploadedFile[]>>;

export const COMPANY_TYPE_OPTIONS = [
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'llc', label: 'LLC' },
  { value: 'partnership', label: 'Partnership' },
  { value: 's_corp', label: 'S-Corp' },
  { value: 'c_corp', label: 'C-Corp' },
  { value: 'other', label: 'Other' },
] as const;

export const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
] as const;

export const BANK_ACCOUNT_TYPE_OPTIONS = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'business_checking', label: 'Business Checking' },
  { value: 'business_savings', label: 'Business Savings' },
] as const;

export const SECURITY_FEATURE_OPTIONS = [
  { value: 'locked_garage', label: 'Locked Garage' },
  { value: 'locked_lot', label: 'Locked / Fenced Lot' },
  { value: 'cameras', label: 'Surveillance Cameras' },
  { value: 'alarm', label: 'Alarm System' },
  { value: 'gps_tracking', label: 'GPS Tracking' },
  { value: 'multiple', label: 'Multiple of the Above' },
  { value: 'other', label: 'Other' },
] as const;

export const COUNTRY_OPTIONS = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const STEPS = [
  { id: 1, key: 'business', title: 'Business', description: 'Company details and registration' },
  { id: 2, key: 'operations', title: 'Operations', description: 'Licensing and ownership' },
  { id: 3, key: 'contacts', title: 'Contacts', description: 'Primary contact and additional drivers' },
  { id: 4, key: 'banking', title: 'Banking', description: 'Bank and card information' },
  { id: 5, key: 'insurance', title: 'Insurance', description: 'Coverage and fleet details' },
  { id: 6, key: 'policies', title: 'Policies', description: 'Renter screening and operations' },
  { id: 7, key: 'underwriting', title: 'Underwriting', description: 'Risk questions' },
  { id: 8, key: 'training', title: 'Training', description: 'How Bonzah works' },
  { id: 9, key: 'quiz', title: 'Quiz', description: 'Quick knowledge check' },
  { id: 10, key: 'review', title: 'Review & Sign', description: 'Confirm and submit' },
] as const;

export const TOTAL_STEPS = STEPS.length;

export const DEFAULT_VALUES: Partial<BonzahOnboardingFormData> = {
  business_trade_name: '',
  business_legal_name: '',
  business_address: '',
  city: '',
  state: '',
  country: '',
  postal_code: '',
  business_phone: '',
  alternative_business_phone: '',
  ein: '',
  company_type: '',
  business_start_date: '',
  company_website: '',
  states_where_you_do_business: '',
  business_owners: '',
  years_in_private_auto_rental: '',
  years_on_turo: '',
  primary_first_name: '',
  primary_last_name: '',
  primary_email: '',
  primary_phone: '',
  primary_date_of_birth: '',
  primary_years_driving: '',
  primary_marital_status: '',
  additional_users: [],
  bank_account_name: '',
  bank_account_type: '',
  bank_name: '',
  routing_number: '',
  account_number: '',
  reenter_account_number: '',
  bank_account_address: '',
  credit_card_number: '',
  card_expiration_date: '',
  card_security_code: '',
  card_name: '',
  card_billing_address: '',
  desired_starting_balance: '',
  rental_management_system: '',
  current_insurance_carrier: '',
  what_can_we_help_with: '',
  gps_brand: '',
  minimum_age_renters: '',
  average_rental_duration: '',
  renter_screening_process: '',
  renter_stolen_vehicle: '',
  pct_renters_with_insurance: '',
  retain_renter_insurance_proof: '',
  payment_methods: '',
  cash_app_card_on_file: '',
  offers_otc_insurance: '',
  vehicle_maintenance_program: '',
  inspect_vehicles: '',
  what_else_should_we_know: '',
  own_other_businesses: '',
  vehicle_storage_security: '',
  signature_data_url: '',
};
