import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  idVerificationStatusEnum,
  idVerificationDecisionSourceEnum,
  requiredDocumentTypeEnum,
} from './enums';
import { tenants } from './tenants';
import { customers } from './customers';
import { appUsers } from './app-users';
import { blockedIdentities } from './blocked-identities';

export const idVerifications = pgTable(
  'id_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    initiatedByUserId: uuid('initiated_by_user_id').references(
      () => appUsers.id,
      { onDelete: 'set null' },
    ),

    // Session / QR — raw token is never stored. Only sha-256 hash.
    sessionTokenHash: text('session_token_hash').notNull(),
    sessionExpiresAt: timestamp('session_expires_at', {
      withTimezone: true,
    }).notNull(),
    currentStep: text('current_step'),

    // Document requirements snapshot at session creation time
    requiredDocumentType: requiredDocumentTypeEnum(
      'required_document_type',
    ).notNull(),

    // S3 object keys (never public URLs — always signed on read)
    documentFrontS3Key: text('document_front_s3_key'),
    documentBackS3Key: text('document_back_s3_key'),
    selfieS3Key: text('selfie_s3_key'),

    // OCR extracted data
    firstName: text('first_name'),
    lastName: text('last_name'),
    dateOfBirth: date('date_of_birth'),
    documentNumber: text('document_number'),
    documentCountry: text('document_country'),
    documentExpiryDate: date('document_expiry_date'),
    documentDetectedType: text('document_detected_type'),
    ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
    ocrRaw: jsonb('ocr_raw'),

    // Face match
    faceMatchScore: numeric('face_match_score', { precision: 5, scale: 2 }),
    faceMatchRaw: jsonb('face_match_raw'),

    // Decision
    status: idVerificationStatusEnum('status').notNull().default('initiated'),
    decisionSource: idVerificationDecisionSourceEnum('decision_source'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    rejectionReason: text('rejection_reason'),
    manualReviewNotes: text('manual_review_notes'),

    // Block match snapshot (if matched at decision time)
    matchedBlockId: uuid('matched_block_id').references(
      () => blockedIdentities.id,
      { onDelete: 'set null' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'id_verifications_expiry_after_creation',
      sql`${table.sessionExpiresAt} > ${table.createdAt}`,
    ),
    uniqueIndex('id_verifications_session_token_hash_idx').on(
      table.sessionTokenHash,
    ),
    index('id_verifications_tenant_customer_idx').on(
      table.tenantId,
      table.customerId,
    ),
    index('id_verifications_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
    index('id_verifications_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);
