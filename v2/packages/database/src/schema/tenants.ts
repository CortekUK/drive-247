import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import {
  tenantTypeEnum,
  tenantStatusEnum,
  bonzahModeEnum,
  requiredDocumentTypeEnum,
} from './enums';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  companyName: text('company_name').notNull(),
  adminName: text('admin_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  tenantType: tenantTypeEnum('tenant_type').notNull().default('production'),
  status: tenantStatusEnum('status').notNull().default('active'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  // Tax settings — snapshotted onto each invoice at creation time
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('0'),
  taxLabel: text('tax_label').notNull().default('Tax'),
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  // Atomic per-tenant counter for invoice numbering
  invoiceSequence: integer('invoice_sequence').notNull().default(0),
  // Bonzah integration — credentials encrypted at rest (AES-256-GCM)
  integrationBonzah: boolean('integration_bonzah').notNull().default(false),
  bonzahMode: bonzahModeEnum('bonzah_mode').notNull().default('test'),
  bonzahUsername: text('bonzah_username'),
  bonzahPasswordEncrypted: text('bonzah_password_encrypted'),
  bonzahBrochureUrl: text('bonzah_brochure_url'),
  // ID verification settings — nullable thresholds override platform defaults.
  idVerificationEnabled: boolean('id_verification_enabled')
    .notNull()
    .default(false),
  requiredDocumentType: requiredDocumentTypeEnum('required_document_type')
    .notNull()
    .default('driving_license'),
  faceMatchAutoApprovePct: numeric('face_match_auto_approve_pct', {
    precision: 5,
    scale: 2,
  }),
  faceMatchReviewPct: numeric('face_match_review_pct', {
    precision: 5,
    scale: 2,
  }),
  minOcrConfidence: numeric('min_ocr_confidence', { precision: 4, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
