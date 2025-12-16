#!/bin/bash

echo "================================================"
echo "Checking .env.local files in all apps..."
echo "================================================"
echo ""

all_exist=true

for app in apps/*/; do
  app_name=$(basename "$app")
  env_file="${app}.env.local"

  # Skip placeholder apps (only README.md, no package.json)
  if [ ! -f "${app}package.json" ]; then
    echo "⏭️  apps/${app_name} (placeholder, skipping)"
    echo ""
    continue
  fi

  if [ -f "$env_file" ]; then
    echo "✅ apps/${app_name}/.env.local exists"

    # Check if it contains required variables
    if grep -q "NEXT_PUBLIC_SUPABASE_URL" "$env_file" && \
       grep -q "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$env_file"; then
      echo "   ✓ Contains required Supabase variables"
    else
      echo "   ⚠️  Missing required Supabase variables"
      all_exist=false
    fi
  else
    echo "❌ apps/${app_name}/.env.local MISSING"
    all_exist=false
  fi
  echo ""
done

echo "================================================"
if [ "$all_exist" = true ]; then
  echo "✅ All apps have valid .env.local files"
  echo "================================================"
  exit 0
else
  echo "❌ Some apps are missing .env.local files or required variables"
  echo "================================================"
  echo ""
  echo "To fix this issue, run:"
  echo "  cat ENV_SETUP.md"
  echo ""
  echo "Or copy from an existing app:"
  echo "  cp apps/admin/.env.local apps/<app-name>/.env.local"
  echo ""
  exit 1
fi
