# Drive247 Multi-Tenant Database Schema

## Overview

This document provides a comprehensive reference for the Drive247 SAAS platform database schema. The database is designed for complete multi-tenant isolation where each rental company (tenant) has their own isolated data.

**Supabase Project ID:** `hviqoaokxvlancmftwuo`
**Database:** PostgreSQL with Row Level Security (RLS)

---

## Multi-Tenancy Architecture

### Core Principles

1. **Tenant Isolation**: Every data table has a `tenant_id` column that references the `tenants` table
2. **Row Level Security (RLS)**: Automatic data filtering based on authenticated user's tenant
3. **Super Admin Access**: Users with `is_super_admin = true` can access all tenant data
4. **Global Master Admin**: `admin@cortek.io` with password `Admin@Cortek2024` can access any tenant

### RLS Helper Functions

| Function | Purpose |
|----------|---------|
| `get_user_tenant_id()` | Returns current user's tenant_id (supports impersonation via JWT) |
| `is_super_admin()` | Returns TRUE if user is a super admin |
| `is_primary_super_admin()` | Returns TRUE if user is the primary super admin |
| `is_global_master_admin()` | Returns TRUE if user is admin@cortek.io |
| `verify_global_master_password(email, password)` | Verifies global master password (bcrypt) |

---

## Database Tables

### Tenant Management

#### `tenants`
Primary table for rental companies (tenants).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| slug | TEXT | Unique subdomain identifier (e.g., "drive247") |
| company_name | TEXT | Display name of the company |
| status | TEXT | active, inactive, suspended |
| subscription_plan | TEXT | Subscription tier |
| contact_email | TEXT | Primary contact email |
| contact_phone | TEXT | Primary contact phone |
| master_password_hash | TEXT | Bcrypt hash for per-tenant master password |
| admin_user_id | UUID | Reference to primary admin auth user |
| trial_ends_at | TIMESTAMPTZ | Trial expiration date |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `global_admin_config`
Stores global master admin configuration.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| master_email | TEXT | admin@cortek.io |
| master_password_hash | TEXT | Bcrypt hash for Admin@Cortek2024 |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

---

### User Management

#### `app_users`
Portal users with roles and tenant assignment.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| auth_user_id | UUID | Reference to Supabase auth.users |
| tenant_id | UUID | FK to tenants (NULL for super admins) |
| email | TEXT | User email |
| name | TEXT | Display name |
| role | TEXT | head_admin, admin, ops, viewer |
| is_super_admin | BOOLEAN | Can access all tenants |
| is_primary_super_admin | BOOLEAN | Can manage other super admins |
| is_active | BOOLEAN | Account status |
| must_change_password | BOOLEAN | Force password change on login |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

**Constraint**: Super admins MUST have `tenant_id = NULL`; regular users MUST have `tenant_id NOT NULL`

---

### Core Business Tables

#### `vehicles`
Fleet inventory management.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| reg | TEXT | Registration/license plate |
| make | TEXT | Vehicle manufacturer |
| model | TEXT | Vehicle model |
| year | INTEGER | Manufacturing year |
| color | TEXT | Vehicle color |
| status | TEXT | Available, Rented, Maintenance, Disposed |
| photo_url | TEXT | Primary vehicle photo |
| acquisition_date | DATE | When vehicle was acquired |
| purchase_price | DECIMAL | Purchase price |
| mot_due_date | DATE | MOT expiration |
| tax_due_date | DATE | Tax expiration |
| is_disposed | BOOLEAN | Whether vehicle is disposed |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `customers`
Customer records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| name | TEXT | Customer name |
| type | TEXT | Individual, Company |
| email | TEXT | Email address |
| phone | TEXT | Phone number |
| status | TEXT | active, blocked, pending |
| whatsapp_opt_in | BOOLEAN | WhatsApp consent |
| nok_full_name | TEXT | Next of kin name |
| nok_phone | TEXT | Next of kin phone |
| high_switcher | BOOLEAN | Frequent customer flag |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `rentals`
Active and historical rental agreements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| customer_id | UUID | FK to customers |
| vehicle_id | UUID | FK to vehicles |
| rental_number | TEXT | Human-readable rental ID |
| start_date | DATE | Rental start date |
| end_date | DATE | Rental end date |
| monthly_amount | DECIMAL | Monthly rental fee |
| status | TEXT | active, completed, cancelled |
| schedule | JSONB | Payment schedule |
| docusign_envelope_id | TEXT | DocuSign reference |
| document_status | TEXT | Contract signing status |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

---

### Financial Tables

#### `payments`
Payment records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| customer_id | UUID | FK to customers |
| rental_id | UUID | FK to rentals |
| vehicle_id | UUID | FK to vehicles |
| amount | DECIMAL | Payment amount |
| payment_date | DATE | Date of payment |
| payment_type | TEXT | Type of payment |
| method | TEXT | cash, card, bank_transfer |
| status | TEXT | completed, pending, failed |
| remaining_amount | DECIMAL | Unapplied balance |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `ledger_entries`
Double-entry ledger for financial tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| customer_id | UUID | FK to customers |
| rental_id | UUID | FK to rentals |
| vehicle_id | UUID | FK to vehicles |
| amount | DECIMAL | Entry amount |
| type | TEXT | charge, payment, credit |
| category | TEXT | rent, deposit, fine, etc. |
| entry_date | DATE | Entry date |
| due_date | DATE | Due date for charges |
| remaining_amount | DECIMAL | Unapplied balance |
| payment_id | UUID | FK to payments (if payment) |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `invoices`
Rental invoices.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| rental_id | UUID | FK to rentals |
| customer_id | UUID | FK to customers |
| vehicle_id | UUID | FK to vehicles |
| invoice_number | TEXT | Human-readable invoice ID |
| invoice_date | DATE | Invoice date |
| due_date | DATE | Payment due date |
| total_amount | DECIMAL | Total invoice amount |
| status | TEXT | paid, pending, overdue |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `fines`
Traffic fines management.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| vehicle_id | UUID | FK to vehicles |
| customer_id | UUID | FK to customers |
| type | TEXT | Fine type |
| amount | DECIMAL | Fine amount |
| issue_date | DATE | When fine was issued |
| due_date | DATE | Payment deadline |
| reference_no | TEXT | Authority reference number |
| status | TEXT | pending, paid, appealed, waived |
| liability | TEXT | company, customer |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `pnl_entries`
Profit & Loss entries.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| vehicle_id | UUID | FK to vehicles |
| customer_id | UUID | FK to customers |
| rental_id | UUID | FK to rentals |
| amount | DECIMAL | Entry amount |
| side | TEXT | income, expense |
| category | TEXT | Category (rent, fuel, maintenance) |
| entry_date | DATE | Entry date |
| source_ref | TEXT | Source reference |
| payment_id | UUID | FK to payments |

---

### CMS Tables

#### `cms_pages`
Website pages content.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| slug | TEXT | URL slug |
| title | TEXT | Page title |
| status | TEXT | draft, published |
| meta_title | TEXT | SEO title |
| meta_description | TEXT | SEO description |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `cms_page_sections`
Page sections/components.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| page_id | UUID | FK to cms_pages |
| section_type | TEXT | hero, content, gallery, etc. |
| content | JSONB | Section content data |
| display_order | INTEGER | Section ordering |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `faqs`
Frequently asked questions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| question | TEXT | FAQ question |
| answer | TEXT | FAQ answer |
| category | TEXT | Category grouping |
| is_active | BOOLEAN | Display status |
| display_order | INTEGER | Display ordering |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `testimonials`
Customer testimonials.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| author | TEXT | Customer name |
| company_name | TEXT | Company (if applicable) |
| review | TEXT | Testimonial content |
| stars | INTEGER | Star rating (1-5) |
| is_active | BOOLEAN | Display status |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `promotions`
Marketing promotions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| title | TEXT | Promotion title |
| description | TEXT | Promotion details |
| discount_type | TEXT | percentage, fixed |
| discount_value | DECIMAL | Discount amount |
| start_date | DATE | Promotion start |
| end_date | DATE | Promotion end |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMPTZ | Record creation timestamp |

---

### Identity & Verification

#### `identity_verifications`
Veriff identity verification records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| customer_id | UUID | FK to customers |
| provider | TEXT | veriff |
| session_id | TEXT | Veriff session ID |
| status | TEXT | pending, approved, declined |
| verification_completed_at | TIMESTAMPTZ | Completion timestamp |
| document_type | TEXT | passport, driving_license |
| first_name | TEXT | Verified first name |
| last_name | TEXT | Verified last name |
| date_of_birth | DATE | Verified DOB |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `blocked_identities`
Blocked identity patterns.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| document_number | TEXT | Blocked document number |
| reason | TEXT | Block reason |
| blocked_by | UUID | FK to app_users |
| created_at | TIMESTAMPTZ | Record creation timestamp |

---

### Reminder System

#### `reminders`
Active reminders.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| object_id | UUID | Related entity ID |
| object_type | TEXT | rental, vehicle, customer |
| rule_code | TEXT | Reminder rule code |
| title | TEXT | Reminder title |
| message | TEXT | Reminder message |
| severity | TEXT | info, warning, critical |
| status | TEXT | pending, sent, dismissed |
| due_on | DATE | Due date |
| remind_on | DATE | When to remind |
| snooze_until | TIMESTAMPTZ | Snooze expiration |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `reminder_rules`
Reminder rule definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| rule_code | TEXT | Unique rule identifier |
| rule_type | TEXT | Rule type |
| category | TEXT | Rule category |
| lead_days | INTEGER | Days before due date |
| is_enabled | BOOLEAN | Rule active status |
| severity | TEXT | info, warning, critical |
| description | TEXT | Rule description |
| created_at | TIMESTAMPTZ | Record creation timestamp |

---

### Audit & Logging

#### `audit_logs`
Audit trail for all actions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| actor_id | UUID | FK to app_users |
| action | TEXT | Action performed |
| entity_type | TEXT | Affected entity type |
| entity_id | UUID | Affected entity ID |
| target_user_id | UUID | Target user (if applicable) |
| details | JSONB | Additional details |
| is_super_admin_action | BOOLEAN | Performed by super admin |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `email_logs`
Email delivery log.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| to_address | TEXT | Recipient email |
| subject | TEXT | Email subject |
| template | TEXT | Template used |
| status | TEXT | sent, failed, bounced |
| sent_at | TIMESTAMPTZ | Send timestamp |
| created_at | TIMESTAMPTZ | Record creation timestamp |

---

### Settings

#### `org_settings`
Tenant organization settings.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| company_name | TEXT | Display company name |
| app_name | TEXT | Application name |
| logo_url | TEXT | Logo URL |
| favicon_url | TEXT | Favicon URL |
| primary_color | TEXT | Brand primary color |
| secondary_color | TEXT | Brand secondary color |
| accent_color | TEXT | Brand accent color |
| currency_code | TEXT | Currency (USD) |
| timezone | TEXT | Timezone |
| date_format | TEXT | Date display format |
| meta_title | TEXT | SEO meta title |
| meta_description | TEXT | SEO meta description |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

---

## Complete Table List with Tenant Isolation Status

All tables below have `tenant_id` column with proper RLS policies:

| # | Table Name | Category | Has tenant_id |
|---|------------|----------|---------------|
| 1 | tenants | Core | N/A (is tenant table) |
| 2 | global_admin_config | Core | N/A (global) |
| 3 | app_users | Users | YES |
| 4 | vehicles | Business | YES |
| 5 | customers | Business | YES |
| 6 | rentals | Business | YES |
| 7 | payments | Financial | YES |
| 8 | ledger_entries | Financial | YES |
| 9 | invoices | Financial | YES |
| 10 | fines | Financial | YES |
| 11 | pnl_entries | Financial | YES |
| 12 | payment_applications | Financial | YES |
| 13 | authority_payments | Financial | YES |
| 14 | fine_files | Financial | YES |
| 15 | vehicle_photos | Vehicles | YES |
| 16 | vehicle_files | Vehicles | YES |
| 17 | vehicle_expenses | Vehicles | YES |
| 18 | vehicle_events | Vehicles | YES |
| 19 | plates | Vehicles | YES |
| 20 | service_records | Vehicles | YES |
| 21 | customer_documents | Customers | YES |
| 22 | identity_verifications | Customers | YES |
| 23 | blocked_identities | Customers | YES |
| 24 | leads | Customers | YES |
| 25 | contact_requests | Customers | YES |
| 26 | rental_key_handovers | Rentals | YES |
| 27 | rental_handover_photos | Rentals | YES |
| 28 | rental_insurance_verifications | Rentals | YES |
| 29 | blocked_dates | Rentals | YES |
| 30 | insurance_policies | Insurance | YES |
| 31 | insurance_documents | Insurance | YES |
| 32 | cms_pages | CMS | YES |
| 33 | cms_page_sections | CMS | YES |
| 34 | cms_page_versions | CMS | YES |
| 35 | cms_media | CMS | YES |
| 36 | faqs | CMS | YES |
| 37 | testimonials | Marketing | YES |
| 38 | promotions | Marketing | YES |
| 39 | email_templates | Communication | YES |
| 40 | email_logs | Communication | YES |
| 41 | notifications | Communication | YES |
| 42 | reminders | Reminders | YES |
| 43 | reminder_actions | Reminders | YES |
| 44 | reminder_events | Reminders | YES |
| 45 | reminder_logs | Reminders | YES |
| 46 | reminder_rules | Reminders | YES |
| 47 | reminder_config | Reminders | YES |
| 48 | reminder_settings | Reminders | YES |
| 49 | reminder_emails | Reminders | YES |
| 50 | audit_logs | Audit | YES |
| 51 | login_attempts | Audit | YES |
| 52 | settings_audit | Audit | YES |
| 53 | maintenance_runs | System | YES |
| 54 | agreement_templates | Documents | YES |
| 55 | org_settings | Settings | YES |

**Total: 55 tables with proper tenant isolation**

---

## RLS Policy Pattern

All tenant-isolated tables use this standard RLS policy:

```sql
CREATE POLICY "tenant_isolation_{table}" ON {table}
FOR ALL TO authenticated
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());
```

**Public read policies** are added for customer-facing data:
- `faqs` (active FAQs)
- `testimonials` (active testimonials)
- `promotions` (active promotions)
- `cms_pages` (published pages)
- `cms_media` (all media for image display)
- `vehicle_photos` (for booking site)

---

## Global Master Admin

**Email:** `admin@cortek.io`
**Password:** `Admin@Cortek2024`

This account can:
1. Access any tenant's data via RLS bypass
2. Access the super admin dashboard
3. Create/manage other super admins
4. Impersonate any tenant by passing `tenantId` to the login function

---

## Database Functions

| Function | Description |
|----------|-------------|
| `get_user_tenant_id()` | Returns current user's tenant_id, supports JWT impersonation |
| `is_super_admin()` | Checks if user is super admin |
| `is_primary_super_admin()` | Checks if user is primary super admin |
| `is_global_master_admin()` | Checks if user is admin@cortek.io |
| `verify_global_master_password(email, password)` | Verifies global master password |
| `set_tenant_id_from_user()` | Trigger function to auto-set tenant_id |

---

## Edge Functions

| Function | Purpose |
|----------|---------|
| `admin-create-user` | Creates new portal users with tenant_id |
| `master-password-login` | Global and per-tenant master password login |
| `create-checkout-session` | Stripe payment sessions |
| `create-veriff-session` | Identity verification |
| `apply-payment` | Payment application to ledger |
| `send-booking-email` | Booking confirmation emails |
| Various notification functions | Email/SMS notifications |

---

## Quick Reference for New Chats

When starting a new chat about this database:

1. **Project ID:** `hviqoaokxvlancmftwuo`
2. **Multi-tenant:** YES - all tables have `tenant_id`
3. **Global Admin:** `admin@cortek.io` / `Admin@Cortek2024`
4. **RLS:** Enabled on all tables with tenant isolation
5. **Auto tenant_id:** Triggers auto-set on INSERT
6. **55 tables** total with complete tenant isolation

---

*Document generated: December 2024*
*Drive247 SAAS Platform Database Schema v1.0*
