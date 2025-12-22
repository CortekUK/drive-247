# Bulk Branding Update Script

This script allows you to update branding (logos, colors, SEO) for multiple tenants in one run.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add Service Role Key to .env

Get your Supabase service role key from:
**Supabase Dashboard > Settings > API > service_role key**

Add to your `.env` file:

```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

> **Warning:** Never commit this key to version control!

## Usage

### Step 1: Get your tenant slugs

You can find tenant slugs in your Supabase dashboard:
- Go to Table Editor > tenants
- Note the `slug` column values for each tenant

### Step 2: Prepare logo files

Place your logo files in the `scripts/logos/` folder:

```
scripts/
  logos/
    tenant1-logo.png
    tenant2-logo.png
    tenant3-logo.png
    tenant4-logo.png
```

Supported formats: PNG, JPG, SVG, WebP

### Step 3: Edit branding-config.json

Update `scripts/branding-config.json` with your tenant data:

```json
{
  "tenants": [
    {
      "slug": "your-actual-tenant-slug",
      "app_name": "Your Brand Name",
      "logo_path": "./logos/your-logo.png",
      "favicon_path": null,
      "colors": {
        "primary_color": "#223331",
        "secondary_color": "#223331",
        "accent_color": "#E9B63E"
      },
      "seo": {
        "meta_title": "Your Brand - Car Rental",
        "meta_description": "Best car rental service"
      }
    }
  ]
}
```

### Step 4: Run the script

```bash
npm run update-branding
```

## Configuration Reference

### Required Fields

| Field | Description |
|-------|-------------|
| `slug` | Tenant slug from database (must match exactly) |

### Optional Fields

| Field | Description | Example |
|-------|-------------|---------|
| `app_name` | Application name in sidebar | "Drive 247" |
| `logo_path` | Path to logo file | "./logos/logo.png" |
| `favicon_path` | Path to favicon file | "./logos/favicon.ico" |

### Color Options

All colors should be hex codes (e.g., "#223331")

| Field | Description |
|-------|-------------|
| `primary_color` | Main brand color |
| `secondary_color` | Secondary color |
| `accent_color` | Accent/highlight color |
| `light_primary_color` | Primary color for light theme |
| `light_secondary_color` | Secondary color for light theme |
| `light_accent_color` | Accent color for light theme |
| `light_background_color` | Background for light theme |
| `light_header_footer_color` | Header/footer for light theme |
| `dark_primary_color` | Primary color for dark theme |
| `dark_secondary_color` | Secondary color for dark theme |
| `dark_accent_color` | Accent color for dark theme |
| `dark_background_color` | Background for dark theme |
| `dark_header_footer_color` | Header/footer for dark theme |

### SEO Options

| Field | Description |
|-------|-------------|
| `meta_title` | Browser tab title |
| `meta_description` | SEO meta description |

## Troubleshooting

### "Tenant with slug X not found"
- Check that the slug in config matches exactly with the database
- Slugs are case-sensitive

### "Missing required environment variables"
- Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in `.env`
- Restart your terminal after adding environment variables

### Logo not uploading
- Check file path is correct (relative to scripts folder)
- Ensure file format is PNG, JPG, SVG, or WebP
- File must be under 5MB
