# Email Integration Setup Guide (Resend)

## Overview
This guide will help you set up email notifications for booking confirmations using Resend.

---

## Step 1: Set Up Resend Account

1. Go to [Resend](https://resend.com/)
2. Sign up for a free account
3. Verify your email address
4. Navigate to **API Keys** in the dashboard
5. Copy your API key (starts with `re_`)

---

## Step 2: Configure Supabase Secrets

Set the Resend API key as a Supabase secret:

```bash
# Set Resend API key
supabase secrets set RESEND_API_KEY=re_KGPngCz4_AaRVeNYmPB1ghVWj5HwqnBNF

# Set sender email (for development, use onboarding@resend.dev)
supabase secrets set FROM_EMAIL=onboarding@resend.dev

# Verify secrets are set
supabase secrets list
```

---

## Step 3: Deploy Email Edge Function

Deploy the email sending function:

```bash
supabase functions deploy send-booking-email
```

---

## Step 4: Create Database Table for Close Protection Enquiries

Run the migration to create the Close Protection enquiries table:

```bash
supabase db push
```

Or manually run the SQL from `supabase/migrations/create_close_protection_enquiries.sql`

---

## Step 5: Verify Domain (For Production)

For production use, you need to verify your domain:

1. Go to Resend Dashboard → **Domains**
2. Click **Add Domain**
3. Enter your domain (e.g., `supremedrivesuite.com`)
4. Add the provided DNS records to your domain:
   - MX records
   - TXT record (for SPF)
   - CNAME record (for DKIM)
5. Wait for verification (can take up to 48 hours)

Once verified, update the FROM_EMAIL:

```bash
supabase secrets set FROM_EMAIL=bookings@yourdomain.com
```

---

## Email Flow

### Booking Confirmation Email

**When**: After successful Stripe payment

**Trigger**: `/booking-success` page loads

**Process**:
1. User completes booking form
2. Booking saved to database
3. User redirected to Stripe Checkout
4. Payment processed
5. User redirected to `/booking-success`
6. Email automatically sent to customer

**Email Contains**:
- Booking confirmation
- Pickup/dropoff locations
- Date and time
- Vehicle details
- Total price
- Special requests (if any)
- Next steps

---

## Close Protection Enquiry Tracking

When a user shows interest in Close Protection services:

1. Data saved to `close_protection_enquiries` table
2. Fields stored:
   - Customer name, email, phone
   - Threat level assessment
   - Specific requirements
   - Booking context
   - Status (pending/contacted/completed)

3. Admin can view enquiries in the database

---

## Email Template

The email includes:
- Professional header with branding
- Booking summary card with golden accent
- What's Next section with checkmarks
- Special requests highlighted (if provided)
- Contact support button
- Professional footer

---

## Testing

### Test in Development

1. Use `onboarding@resend.dev` as FROM_EMAIL
2. This allows sending to any email during development
3. Complete a test booking
4. Check the recipient's inbox

### Monitor Emails

View sent emails in Resend Dashboard:
1. Go to **Emails** tab
2. See delivery status
3. View email content
4. Check for bounces/complaints

---

## Production Checklist

- ✅ Verify your custom domain in Resend
- ✅ Update FROM_EMAIL to your domain
- ✅ Set up SPF, DKIM, and DMARC records
- ✅ Test email delivery to various providers (Gmail, Outlook, etc.)
- ✅ Monitor bounce rates
- ✅ Set up email templates for consistency
- ✅ Add unsubscribe functionality (if sending marketing emails)

---

## Resend Limits

**Free Tier**:
- 100 emails/day
- 3,000 emails/month
- Basic analytics

**Paid Plans** (starting at $20/month):
- 50,000 emails/month
- Custom domains
- Advanced analytics
- Priority support

Check [Resend Pricing](https://resend.com/pricing) for current rates

---

## Troubleshooting

### Email not sent

1. Check Supabase function logs:
   ```bash
   supabase functions logs send-booking-email
   ```

2. Verify secrets are set:
   ```bash
   supabase secrets list
   ```

3. Check Resend dashboard for failed deliveries

### Email goes to spam

- Verify domain properly
- Set up DKIM, SPF, and DMARC
- Use professional email content
- Avoid spam trigger words
- Warm up your sending domain

### Wrong sender email

- Check FROM_EMAIL secret value
- For development: use `onboarding@resend.dev`
- For production: use your verified domain

---

## Files Modified/Created

### Created:
- `supabase/functions/send-booking-email/index.ts` - Email sending function
- `supabase/migrations/create_close_protection_enquiries.sql` - CP enquiries table
- `EMAIL_SETUP_GUIDE.md` - This guide

### Modified:
- `src/components/CloseProtectionModal.tsx` - Save enquiries to database
- `src/pages/BookingSuccess.tsx` - Send email after payment
- `src/components/MultiStepBookingWidget.tsx` - Store booking data

---

## Environment Variables

Add to Supabase secrets (not .env file):

```bash
RESEND_API_KEY=re_your_api_key_here
FROM_EMAIL=onboarding@resend.dev  # or your domain email
```

---

## Support

For issues:
- **Resend**: [Resend Docs](https://resend.com/docs)
- **Supabase Edge Functions**: [Supabase Docs](https://supabase.com/docs/guides/functions)
- **Email Deliverability**: Check SPF/DKIM/DMARC setup

---

## Example Email Preview

```
Subject: Booking Confirmed - 2025-10-25

[Professional header with logo]

Thank You, John Doe!

Your luxury chauffeur service booking has been confirmed.

┌─────────────────────────────────┐
│ Booking Details                 │
├─────────────────────────────────┤
│ Pickup: London Heathrow Airport │
│ Drop-off: Central London        │
│ Date: 2025-10-25 at 14:30       │
│ Vehicle: Mercedes S-Class       │
│ Passengers: 2                   │
│                                 │
│ Total: $250.00                  │
└─────────────────────────────────┘

What's Next?
✓ Our team will contact you within 24 hours
✓ Chauffeur details sent 24 hours before journey
✓ Payment instructions sent separately

[Contact Support Button]
```

---

## Next Steps

1. Deploy the Edge Function
2. Create the database table
3. Set Supabase secrets
4. Test with a booking
5. Verify your domain for production
