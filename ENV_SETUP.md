# Environment Variables Setup

## Overview

This Turborepo monorepo requires **individual `.env.local` files in each app directory**.

Environment variables placed at the root level **will NOT be loaded** by Next.js apps in a Turborepo setup.

## Required Files

Each app must have its own `.env.local` file:

```
apps/
├── admin/.env.local       ✅ Required
├── booking/.env.local     ✅ Required
├── portal/.env.local      ✅ Required
└── web/.env.local         ✅ Required
```

## Environment Variables

All apps use the same Supabase configuration:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://hviqoaokxvlancmftwuo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjk3MTksImV4cCI6MjA0ODY0NTcxOX0.5hQmQPyaCpMCGJSsO-WmFYgUIiK5kR2dQUPx4Td0Z_0
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjk3MTksImV4cCI6MjA0ODY0NTcxOX0.5hQmQPyaCpMCGJSsO-WmFYgUIiK5kR2dQUPx4Td0Z_0
NEXT_PUBLIC_SUPABASE_PROJECT_ID=hviqoaokxvlancmftwuo
```

## Setup Instructions

### Initial Setup

1. Copy the environment variables above into each app's `.env.local` file:

```bash
# From the monorepo root
cat > apps/admin/.env.local << 'EOF'
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://hviqoaokxvlancmftwuo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjk3MTksImV4cCI6MjA0ODY0NTcxOX0.5hQmQPyaCpMCGJSsO-WmFYgUIiK5kR2dQUPx4Td0Z_0
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjk3MTksImV4cCI6MjA0ODY0NTcxOX0.5hQmQPyaCpMCGJSsO-WmFYgUIiK5kR2dQUPx4Td0Z_0
NEXT_PUBLIC_SUPABASE_PROJECT_ID=hviqoaokxvlancmftwuo
EOF

# Repeat for other apps
cat > apps/booking/.env.local << 'EOF'
[same content]
EOF

cat > apps/portal/.env.local << 'EOF'
[same content]
EOF

cat > apps/web/.env.local << 'EOF'
[same content]
EOF
```

2. Restart the dev server to pick up the new environment variables:

```bash
npm run dev
```

### After Cloning the Repository

1. Create `.env.local` files in each app directory
2. Copy the environment variables from this document
3. Run `npm run dev`

## Troubleshooting

### "Invalid API key" Error

**Problem**: Getting 401 Unauthorized errors from Supabase

**Solution**:
1. Check that `.env.local` exists in the specific app directory (not just at root)
2. Verify the file contains valid Supabase credentials
3. Restart the dev server: kill all processes and run `npm run dev`
4. Clear Next.js cache: `rm -rf apps/*/. next`

### Environment Variables Not Loading

**Problem**: `process.env.NEXT_PUBLIC_SUPABASE_URL` is undefined

**Solution**:
1. Ensure the `.env.local` file is in the **app directory** (`apps/admin/.env.local`), not the root
2. Variable names must start with `NEXT_PUBLIC_` to be accessible in the browser
3. Restart the dev server after adding/modifying `.env.local`

### Checking Environment Variables

When Next.js starts, it will show which environment files are loaded:

```bash
admin:dev:    - Environments: .env.local
```

If you don't see this line, the `.env.local` file is not being found.

## Git Ignore

All `.env.local` files are automatically ignored by Git (see `.gitignore` line 26: `.env*.local`).

**IMPORTANT**: Never commit `.env.local` files to the repository. They contain sensitive credentials.

## Adding New Apps

When adding a new app to the monorepo:

1. Create `apps/new-app/.env.local`
2. Copy the Supabase configuration from above
3. Add any app-specific environment variables
4. Restart the dev server

## Production Deployment

For production deployments (Vercel, etc.):

1. Add environment variables in the deployment platform's dashboard
2. Do NOT use `.env.local` files in production
3. Set the same variables for all apps/deployments:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_PROJECT_ID`

## Verification Script

To verify all apps have their `.env.local` files:

```bash
#!/bin/bash
echo "Checking .env.local files..."
for app in apps/*/; do
  if [ -f "${app}.env.local" ]; then
    echo "✅ ${app}.env.local exists"
  else
    echo "❌ ${app}.env.local MISSING"
  fi
done
```

Save as `check-env.sh` and run with `bash check-env.sh`.
