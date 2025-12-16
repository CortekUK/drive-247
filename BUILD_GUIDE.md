# Build & Development Guide

## Environment Variables

All apps share the same environment variables. Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
# Edit .env.local with your actual values
```

**Required Variables:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon/public key

**Optional Variables:**
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - For booking app payments
- `NEXT_PUBLIC_ENABLE_SUPER_ADMIN=true` - For admin app
- AWS credentials - For edge functions (email/SMS)

## Development

### Run All Apps
```bash
npm run dev
```

This starts:
- booking on port 8080
- portal on port 3001
- web on port 3002
- admin on port 3003

### Run Individual App
```bash
npm run dev:booking
npm run dev:portal
npm run dev:web
npm run dev:admin
```

### Using Turbo Directly
```bash
# Run specific app
turbo run dev --filter=booking

# Run multiple apps
turbo run dev --filter=booking --filter=portal
```

## Building

### Build All Apps
```bash
npm run build
```

### Build Individual App
```bash
turbo run build --filter=booking
```

## Troubleshooting

### "spawn sh ENOENT" Error
This occurs when trying to build from within an app directory. Always build from the monorepo root:
```bash
cd /Users/ghulam/projects/drive247/Drive917-client
npm run build
```

### Missing Dependencies
If you see import errors, reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use
Kill the process using the port:
```bash
lsof -ti:8080 | xargs kill -9  # booking
lsof -ti:3001 | xargs kill -9  # portal
lsof -ti:3002 | xargs kill -9  # web
lsof -ti:3003 | xargs kill -9  # admin
```

## Deployment

### Vercel - Option A: Separate Projects (Recommended)

Create 4 Vercel projects:

1. **Booking App**
   - Root Directory: `apps/booking`
   - Build Command: `cd ../.. && npm run build --filter=booking`
   - Output Directory: `apps/booking/.next`
   - Domain: `drive-247.com` or subdomain

2. **Portal App**
   - Root Directory: `apps/portal`
   - Build Command: `cd ../.. && npm run build --filter=portal`
   - Output Directory: `apps/portal/.next`
   - Domain: tenant subdomains + `/dashboard`

3. **Web App**
   - Root Directory: `apps/web`
   - Build Command: `cd ../.. && npm run build --filter=web`
   - Output Directory: `apps/web/.next`
   - Domain: `drive-247.com`

4. **Admin App**
   - Root Directory: `apps/admin`
   - Build Command: `cd ../.. && npm run build --filter=admin`
   - Output Directory: `apps/admin/.next`
   - Domain: `admin.drive-247.com`

### Environment Variables (Vercel)

Set these in each Vercel project's settings:
```
NEXT_PUBLIC_SUPABASE_URL=https://hviqoaokxvlancmftwuo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-key>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-key>
```

For booking app, add:
```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-key>
```

For admin app, add:
```
NEXT_PUBLIC_ENABLE_SUPER_ADMIN=true
```

## Testing Builds Locally

```bash
# Build all apps
npm run build

# Test production builds
cd apps/booking && npm run start
cd apps/portal && npm run start
cd apps/web && npm run start
cd apps/admin && npm run start
```
