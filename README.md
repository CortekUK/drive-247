# Drive247 Monorepo

Multi-tenant SAAS rental management platform built with Turborepo, Next.js, and Supabase.

## 📁 Repository Structure

```
drive247-monorepo/
├── apps/
│   ├── booking/         → Customer booking platform (Next.js 15)
│   ├── portal/          → Tenant admin dashboard (Next.js 16)
│   ├── web/             → SAAS landing page (Next.js 16)
│   ├── admin/           → Super admin platform (Next.js 16)
│   └── client/          → Customer portal (placeholder)
├── packages/
│   ├── ui/              → Shared UI components (future)
│   ├── config/          → Shared configurations (future)
│   └── types/           → Shared TypeScript types (future)
└── supabase/
    ├── functions/       → 65 Edge Functions
    ├── migrations/      → Database migrations
    └── config.toml      → Supabase configuration
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or pnpm
- Supabase account

### Installation

```bash
# Install all dependencies
npm install

# Run all apps in development mode
npm run dev

# Run specific app
npm run dev:booking   # Booking platform (port 8080)
npm run dev:portal    # Admin dashboard (port 3001)
npm run dev:web       # Landing page (port 3002)
npm run dev:admin     # Super admin (port 3003)
```

### Build

```bash
# Build all apps
npm run build

# Build specific app
turbo run build --filter=booking
```

## 🌐 Domain Structure

### Main Domains
- `drive-247.com` → apps/web (SAAS landing page)
- `admin.drive-247.com` → apps/admin (super admin portal)

### Tenant Subdomains
- `{tenant}.drive-247.com` → apps/booking (customer booking site)
- `{tenant}.drive-247.com/dashboard` → apps/portal (tenant admin dashboard)

### Example: Real Tenants
```
ghulam-rentals.drive-247.com                → Booking homepage
ghulam-rentals.drive-247.com/fleet          → Vehicle catalog
ghulam-rentals.drive-247.com/booking        → Booking flow
ghulam-rentals.drive-247.com/dashboard      → Admin dashboard

neema-rentals.drive-247.com                 → Booking homepage (different tenant)
neema-rentals.drive-247.com/dashboard       → Admin dashboard (different data)
```

## 📦 Apps Overview

### apps/booking (Customer Booking Platform)
- **Framework**: Next.js 15 + React 18
- **Purpose**: Customer-facing booking website
- **Features**: Vehicle browsing, booking flow, Stripe payments, Veriff verification
- **Port**: 8080
- **Key Routes**:
  - `/` - Homepage with booking form
  - `/fleet` - Vehicle catalog
  - `/booking/vehicles` - Vehicle selection
  - `/booking/checkout` - Checkout & payment

### apps/portal (Tenant Admin Dashboard)
- **Framework**: Next.js 16 + React 19
- **Purpose**: Rental company operations portal
- **Features**: Fleet management, rentals, payments, fines, CMS
- **Port**: 3001
- **Auth**: Role-based (head_admin, admin, ops, viewer)
- **Routes**: 42 dashboard pages including:
  - `/dashboard` - Main dashboard with KPIs
  - `/dashboard/vehicles` - Fleet management
  - `/dashboard/customers` - Customer management
  - `/dashboard/rentals` - Rental operations
  - `/dashboard/payments` - Payment tracking
  - `/dashboard/settings` - Organization settings

### apps/web (SAAS Landing Page)
- **Framework**: Next.js 16 + React 19
- **Purpose**: Platform marketing and tenant signup
- **Features**: Hero, features, pricing, testimonials, contact form
- **Port**: 3002
- **Key Sections**:
  - Hero section
  - Features showcase
  - Pricing tiers (Starter, Professional, Enterprise)
  - Contact form for tenant inquiries

### apps/admin (Super Admin Platform)
- **Framework**: Next.js 16 + React 19
- **Purpose**: Platform administration
- **Features**: Tenant CRUD, platform metrics, super admin management
- **Port**: 3003
- **Key Routes**:
  - `/admin/dashboard` - Platform metrics
  - `/admin/rentals` - Tenant management
  - `/admin/contacts` - Contact request management
  - `/admin/admins` - Super admin management

### apps/client (Customer Portal)
- **Status**: Placeholder - Not yet implemented
- **Purpose**: Customer self-service portal for viewing rentals, invoices, payments

## 🗄️ Supabase Backend

### Edge Functions (65 total)
Located in `supabase/functions/`:

**Admin Operations**:
- `admin-create-user`, `admin-update-role`, `admin-reset-password`, `admin-deactivate-user`

**Payments**:
- `apply-payment`, `apply-fine`, `capture-booking-payment`, `cancel-booking-preauth`

**Notifications**:
- `aws-ses-email`, `aws-sns-sms`
- `notify-booking-approved`, `notify-booking-rejected`, `notify-booking-cancelled`
- `notify-preauth-expiring`

**Integrations**:
- `create-checkout-session` (Stripe)
- `create-docusign-envelope`, `docusign-webhook` (DocuSign)
- `create-veriff-session`, `veriff-webhook` (Veriff)

**Reminders**:
- `insurance-expiry-reminders`, `mot-expiry-reminders`, `plate-expiry-reminders`
- `rental-end-soon-reminders`, `rental-overdue-reminders`

**Utilities**:
- `dashboard-kpis`, `cleanup-test-data`, `auth-rate-limit`

### Database
- **Multi-tenancy**: Row Level Security (RLS) policies enforce tenant isolation
- **Tables**: `tenants`, `app_users`, `vehicles`, `customers`, `rentals`, `payments`, etc.
- **Migrations**: 329 migration files in `supabase/migrations/`

## 🔧 Tech Stack

- **Monorepo**: Turborepo
- **Frontend**: Next.js 15/16, React 18/19, TypeScript
- **UI**: shadcn/ui (Radix primitives) + Tailwind CSS
- **State**: Zustand (auth), TanStack React Query (data fetching)
- **Forms**: React Hook Form + Zod validation
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions)
- **Payments**: Stripe
- **Verification**: Veriff
- **Contracts**: DocuSign
- **Email**: AWS SES (via Resend)
- **SMS**: AWS SNS
- **Deployment**: Vercel

## 🛠️ Development

### Turborepo Commands

```bash
# Run dev servers
turbo run dev

# Build all apps
turbo run build

# Lint all apps
turbo run lint

# Run specific task for specific app
turbo run dev --filter=booking
turbo run build --filter=portal
```

### Environment Variables

Each app requires the following environment variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://hviqoaokxvlancmftwuo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_SUPABASE_PROJECT_ID=hviqoaokxvlancmftwuo

# Super Admin (admin app only)
NEXT_PUBLIC_ENABLE_SUPER_ADMIN=true

# Stripe (booking app)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-stripe-key>

# AWS (edge functions)
AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
AWS_REGION=us-east-1
SES_FROM_EMAIL=noreply@drive-247.com
```

### Adding a New App

1. Create new folder in `apps/`
2. Add `package.json` with name and scripts
3. Install dependencies: `npm install`
4. Add to root `package.json` workspaces (automatic)
5. Add dev script to root `package.json`: `"dev:newapp": "turbo run dev --filter=newapp"`

## 📚 Multi-Tenancy Architecture

### How it Works
1. **Subdomain Extraction**: Middleware extracts subdomain from hostname
2. **Tenant Loading**: TenantContext fetches tenant data from `tenants` table
3. **Data Isolation**: RLS policies filter all queries by `tenant_id`
4. **Branding**: Each tenant has custom colors, logo, and app name

### Tenant Context
Located in `apps/*/src/contexts/TenantContext.tsx`:
```typescript
const { tenant, loading, error } = useTenant();
// Returns: { id, slug, company_name, status, branding, ... }
```

### Middleware
Located in `apps/*/src/middleware.ts`:
- Extracts subdomain from hostname
- Sets `x-tenant-slug` header
- Routes requests based on subdomain

## 🚢 Deployment

### Vercel (Recommended)
**Option A: Separate Vercel Projects**
- Create 4 separate Vercel projects
- Set root directory for each: `apps/booking`, `apps/portal`, etc.
- Configure domains accordingly

**Option B: Single Vercel Project with Monorepo**
- Use Vercel's built-in monorepo support
- Configure via `vercel.json`

### Environment Variables (Vercel)
Set the following in Vercel Dashboard for each project:
- All Supabase variables
- Stripe keys (booking app)
- AWS credentials (edge functions)

## 📄 License

Proprietary - Cortek Systems Ltd

## 🤝 Contributors

- Development: Cortek Systems Ltd
- Platform: Drive247
