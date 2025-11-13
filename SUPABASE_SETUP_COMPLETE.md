# Drive917 Supabase Setup Guide

## ✅ Supabase Integration Status

Your project is **fully integrated** with Supabase (Lovable Cloud)! Below are the complete setup instructions and demo credentials.

---

## 🔐 Demo Admin Account

A demo admin account has been configured for testing:

**Email:** `admin@demo.com`  
**Password:** `demo123`

### To Create the Demo User

The demo user can be created by calling the edge function. You can do this through the Supabase dashboard or by making a POST request to:

```
POST https://iauakbhzokwelcznnbfq.supabase.co/functions/v1/create-demo-user
```

This will:
- Create the admin user account (if it doesn't exist)
- Assign admin role in the `user_roles` table
- Confirm the email automatically (no verification needed)

---

## 📊 Mock Data Setup

A comprehensive SQL script has been created at `scripts/setup-demo-data.sql` that includes:

### ✅ Data Included:
- **10 Vehicles** - Mix of Standard, SUV, Luxury, Electric vehicles
- **10 Pricing Extras** - GPS, child seats, insurance, etc.
- **6 Service Inclusions** - 24/7 support, unlimited mileage, etc.
- **10 FAQs** - Common customer questions and answers
- **8 Testimonials** - Featured customer reviews
- **4 Promotions** - Active promotional offers
- **5 Portfolio Items** - Corporate events, weddings, etc.
- **5 Drivers** - Professional driver profiles
- **10 Site Settings** - Contact info, policies, etc.

### To Run the Mock Data Script:

1. Go to your Lovable Cloud dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `scripts/setup-demo-data.sql`
4. Execute the script

---

## 🗄️ Database Tables

Your project uses the following tables:

### Core Tables:
- `vehicles` - Rental vehicle inventory
- `bookings` - Customer rental bookings
- `pricing_extras` - Additional services and equipment
- `service_inclusions` - Included services
- `testimonials` - Customer reviews
- `feedback_submissions` - Customer feedback

### Management Tables:
- `drivers` - Driver profiles
- `clients` - Customer management
- `blocked_dates` - Unavailable dates
- `notifications` - Admin notifications
- `audit_logs_with_admin` - Activity tracking

### Content Tables:
- `portfolio` - Project showcase
- `portfolio_images` - Portfolio gallery
- `promotions` - Marketing campaigns
- `faqs` - Frequently asked questions
- `site_settings` - Site configuration

### Security Tables:
- `user_roles` - User role assignments (admin, user, etc.)

---

## 🔒 Row Level Security (RLS)

RLS is enabled on sensitive tables to protect data:

- **Public Read Access**: FAQs, testimonials, vehicles, promotions, portfolio
- **Authenticated Access**: Bookings (users can only see their own)
- **Admin Only**: Drivers, clients, audit logs, site settings
- **Role-Based**: Uses `user_roles` table with `has_role()` function

---

## 🚀 Available Edge Functions

Your project has the following serverless functions:

1. **`create-demo-user`** - Creates/updates demo admin account
2. **`send-booking-email`** - Sends booking confirmation emails
3. **`send-contact-email`** - Processes contact form submissions
4. **`send-cp-enquiry`** - Handles close protection enquiries
5. **`send-sms`** - SMS notification service
6. **`hyper-api`** - Custom API endpoints

---

## 🎨 Features Included

### Customer Features:
- ✅ Vehicle browsing and filtering
- ✅ Multi-step booking widget
- ✅ Pricing calculator with extras
- ✅ Testimonials and reviews
- ✅ Portfolio showcase
- ✅ FAQ section
- ✅ Contact forms
- ✅ Promotions page
- ✅ Dark/Light mode
- ✅ PWA support (installable)
- ✅ Mobile-responsive design

### Admin Features:
- ✅ Admin dashboard with analytics
- ✅ Booking management
- ✅ Vehicle fleet management
- ✅ Driver management
- ✅ Client management
- ✅ Testimonials management
- ✅ Portfolio editor
- ✅ Promotions management
- ✅ Site settings
- ✅ Audit logs
- ✅ Reports and analytics
- ✅ Blocked dates calendar

---

## 🔧 Next Steps

1. **Create Demo User**: Call the `create-demo-user` edge function
2. **Load Mock Data**: Run the SQL script from `scripts/setup-demo-data.sql`
3. **Login**: Use `admin@supremedrive.com` / `Demo123!`
4. **Test Admin Panel**: Navigate to `/admin` after logging in
5. **Explore Features**: Browse vehicles, make test bookings, etc.

---

## 📱 Access URLs

- **Main Site**: Your Lovable preview URL
- **Admin Panel**: `/admin` (requires login)
- **Auth Page**: `/auth` (login/signup)

---

## 🆘 Troubleshooting

### If you can't see data after running the script:
- Check RLS policies in Supabase dashboard
- Ensure you're logged in as admin
- Verify tables exist in the database schema

### If demo user creation fails:
- Check edge function logs in Supabase dashboard
- Ensure `user_roles` table exists
- Verify SUPABASE_SERVICE_ROLE_KEY is set

### If login doesn't work:
- Disable "Confirm email" in Supabase Auth settings
- Check Site URL and Redirect URLs in Auth configuration
- Verify credentials: `admin@demo.com` / `demo123`

---

## 📚 Additional Resources

- [Lovable Cloud Documentation](https://docs.lovable.dev/features/cloud)
- [Supabase Documentation](https://supabase.com/docs)
- Edge Functions: Check `supabase/functions/` directory
- SQL Migrations: Check `supabase/migrations/` directory

---

**Your Drive917 application is production-ready with complete Supabase integration! 🎉**
