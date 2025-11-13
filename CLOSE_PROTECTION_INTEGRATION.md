# Close Protection Integration

## Overview
Close Protection interest is now stored directly in the `bookings` table using the existing `protection_details` column.

---

## How It Works

### 1. User Flow
1. User fills booking form (Steps 1-3)
2. On Step 3, user sees "Interested in Close Protection?" toggle
3. If yes, CloseProtectionModal opens
4. User fills CP details:
   - Name, Email, Phone (pre-filled from booking)
   - Threat Level (Low/Medium/High/Not Sure)
   - Specific Requirements (text area)
5. Details saved and included in booking submission

### 2. Data Storage

**Database Column**: `bookings.protection_details` (JSONB)

**Data Structure**:
```json
{
  "interested": true,
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "+44 7XXX XXXXXX",
  "threat_level": "Medium",
  "requirements": "Specific security concerns...",
  "submitted_at": "2025-10-19T15:30:00.000Z"
}
```

### 3. Implementation Files

**Modified**:
- [src/components/CloseProtectionModal.tsx](src/components/CloseProtectionModal.tsx)
  - Changed from database insert to callback pattern
  - Passes CP details to parent component

- [src/components/MultiStepBookingWidget.tsx](src/components/MultiStepBookingWidget.tsx)
  - Added `cpDetails` state
  - Includes CP details in booking insert
  - Stores as JSON in `protection_details` column

---

## Querying Close Protection Bookings

**Get all bookings with CP interest**:
```sql
SELECT * FROM bookings
WHERE protection_details IS NOT NULL;
```

**Filter by threat level**:
```sql
SELECT
  id,
  customer_name,
  protection_details->>'threat_level' as threat_level,
  protection_details->>'requirements' as requirements
FROM bookings
WHERE protection_details->>'interested' = 'true'
AND protection_details->>'threat_level' = 'High';
```

**Get CP details from booking**:
```sql
SELECT
  id,
  customer_name,
  customer_email,
  pickup_date,
  protection_details
FROM bookings
WHERE protection_details IS NOT NULL
ORDER BY created_at DESC;
```

---

## Admin Dashboard Query

To display CP enquiries in admin dashboard:

```javascript
const { data: cpBookings } = await supabase
  .from('bookings')
  .select('*')
  .not('protection_details', 'is', null)
  .order('created_at', { ascending: false });

// Parse protection_details
const bookings = cpBookings.map(booking => ({
  ...booking,
  cpDetails: JSON.parse(booking.protection_details)
}));
```

---

## Benefits of This Approach

✅ **No separate table** - All booking data in one place
✅ **Relationship maintained** - CP details tied to specific booking
✅ **Flexible schema** - JSONB allows adding fields without migration
✅ **Single source of truth** - One booking record with optional CP data
✅ **Easy filtering** - Use JSONB operators to query CP details

---

## Example Admin View

```javascript
// Get booking with CP details
const booking = {
  id: "123",
  customer_name: "John Doe",
  pickup_location: "Heathrow Airport",
  dropoff_location: "Central London",
  total_price: 250,
  protection_details: {
    interested: true,
    threat_level: "Medium",
    requirements: "Corporate executive protection needed"
  }
}

// Display
if (booking.protection_details?.interested) {
  console.log("⚠️ Close Protection Required");
  console.log("Threat Level:", booking.protection_details.threat_level);
  console.log("Requirements:", booking.protection_details.requirements);
}
```

---

## Migration Not Required

No database migration needed - the `protection_details` column already exists in the `bookings` table as JSONB.

Just ensure your booking form includes the CloseProtectionModal and the widget handles the callback properly.
