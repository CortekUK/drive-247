# Fleet Maintenance Table Schema

This document describes the `fleet_maintenance` table structure for tracking vehicle maintenance, MOT, inspections, and service records.

## Table: `public.fleet_maintenance`

### Purpose
Track all maintenance activities for fleet vehicles including:
- Regular services
- MOT tests
- Repairs
- Inspections
- Insurance renewals

---

## Schema

### Core Fields
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | Yes | gen_random_uuid() | Primary key |
| `vehicle_id` | UUID | Yes | - | Foreign key to vehicles table |

### Maintenance Details
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `maintenance_type` | TEXT | Yes | - | Type of maintenance |
| `scheduled_date` | DATE | Yes | - | When maintenance is scheduled |
| `completed_date` | DATE | No | - | When actually completed |
| `status` | TEXT | Yes | 'upcoming' | Current status |

### Cost & Documentation
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `cost` | DECIMAL(10,2) | No | - | Cost of maintenance work |
| `notes` | TEXT | No | - | Description, findings, recommendations |
| `document_url` | TEXT | No | - | URL to invoice/report document |

### Tracking
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `is_overdue` | BOOLEAN | Yes | false | Flag for overdue maintenance |

### Timestamps
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `created_at` | TIMESTAMPTZ | Yes | now() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Yes | now() | Last update timestamp |

---

## Constraints

### Check Constraints

**maintenance_type** must be one of:
- `Service`
- `MOT`
- `Repair`
- `Inspection`
- `Insurance Renewal`

**status** must be one of:
- `upcoming` - Scheduled for future
- `in_progress` - Currently being worked on
- `completed` - Finished
- `overdue` - Past scheduled date and not completed

### Foreign Keys
- `vehicle_id` → `public.vehicles(id)` with CASCADE delete

---

## Indexes

| Index Name | Column(s) | Purpose |
|------------|-----------|---------|
| `idx_fleet_maintenance_vehicle_id` | vehicle_id | Filter by vehicle |
| `idx_fleet_maintenance_status` | status | Filter by status |
| `idx_fleet_maintenance_scheduled_date` | scheduled_date | Date-based queries |
| `idx_fleet_maintenance_maintenance_type` | maintenance_type | Filter by type |

---

## RLS Policies

| Policy | Operation | Condition |
|--------|-----------|-----------|
| Admins can manage all fleet maintenance | ALL | User has admin role |

---

## Interface (TypeScript)

```typescript
interface MaintenanceRecord {
  id: string;
  vehicle_id: string;
  maintenance_type: string;  // 'Service' | 'MOT' | 'Repair' | 'Inspection' | 'Insurance Renewal'
  scheduled_date: string;    // ISO date string
  completed_date: string | null;
  status: string;            // 'upcoming' | 'in_progress' | 'completed' | 'overdue'
  cost: number | null;
  notes: string | null;
  document_url: string | null;
  is_overdue: boolean;
  created_at: string;
}
```

---

## Storage Bucket

**Bucket Name:** `maintenance-documents`

**Purpose:** Store invoices, service reports, MOT certificates, and other maintenance documentation

**File Types:** PDF, JPG, PNG, WEBP (max 10MB)

**Access:** Admin-only (RLS policies)

---

## Auto-Calculations

The application automatically:
1. Sets `is_overdue = true` when `scheduled_date < today` AND `status != 'completed'`
2. Updates `status = 'overdue'` for overdue items
3. Sets `status = 'completed'` when `completed_date` is filled

---

## Migration File

📄 `20251106000005_create_fleet_maintenance_table.sql`

To apply: `npx supabase db push`
