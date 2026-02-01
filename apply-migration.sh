#!/bin/bash

# Apply migration using curl and Supabase service role key

# Read service key from .env
SERVICE_KEY=$(grep "SUPABASE_SERVICE_ROLE_KEY" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
SUPABASE_URL=$(grep "NEXT_PUBLIC_SUPABASE_URL" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")

echo "🚀 Applying migration via Supabase HTTP API..."
echo "📍 URL: $SUPABASE_URL"
echo ""

# Read the migration SQL
MIGRATION_SQL=$(cat supabase/migrations/20260113140000_add_area_around_location_mode.sql)

# Escape the SQL for JSON
ESCAPED_SQL=$(echo "$MIGRATION_SQL" | jq -Rs .)

echo "⚡ Executing SQL migration..."
echo ""

# Try to execute via Supabase's query endpoint
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/query" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $ESCAPED_SQL}")

echo "Response: $RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q "error\|PGRST"; then
  echo "❌ API execution failed"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📋 PLEASE RUN THIS SQL MANUALLY IN SUPABASE DASHBOARD"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "1. Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/editor"
  echo "2. Click 'SQL Editor'"
  echo "3. Copy and paste this SQL:"
  echo ""
  echo "────────────────────────────────────────────────────────────────────────────────"
  cat supabase/migrations/20260113140000_add_area_around_location_mode.sql
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo ""
  echo "4. Click 'Run'"
  echo ""
  exit 1
else
  echo "✅ Migration applied successfully!"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✨ SUCCESS! The following columns have been added:"
  echo "  ✓ pickup_area_radius_km"
  echo "  ✓ return_area_radius_km"
  echo "  ✓ area_center_lat"
  echo "  ✓ area_center_lon"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "🔄 Please refresh your portal page to see the changes!"
fi
