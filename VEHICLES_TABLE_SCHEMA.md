# Vehicles Table Schema

This document describes the complete vehicles table structure required for the Fleet Management system.

## Table: `public.vehicles`

### Core Information
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | Yes | gen_random_uuid() | Primary key |
| `name` | TEXT | Yes | - | Vehicle make and model (e.g., "Toyota Camry") |
| `category` | TEXT | Yes | - | Vehicle category (e.g., "Sedan", "SUV", "Luxury") |
| `description` | TEXT | No | - | Brief description of vehicle features |
| `image_url` | TEXT | No | - | URL to vehicle image in storage bucket |

### Specifications
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `capacity` | INTEGER | Yes | 4 | Passenger capacity |
| `luggage_capacity` | INTEGER | Yes | 2 | Number of bags/suitcases |
| `transmission_type` | TEXT | Yes | 'Automatic' | Transmission: 'Automatic' or 'Manual' |
| `fuel_type` | TEXT | Yes | 'Petrol' | Fuel: 'Petrol', 'Diesel', 'Hybrid', or 'Electric' |

### Maintenance Details
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `registration_number` | TEXT | No | - | License plate/registration number |
| `current_mileage` | INTEGER | No | - | Current odometer reading |
| `insurance_expiry_date` | DATE | No | - | Insurance policy expiry date |
| `service_due_date` | DATE | No | - | Next scheduled service date |
| `mot_expiry_date` | DATE | No | - | MOT certificate expiry date |
| `service_status` | TEXT | Yes | 'operational' | Status: 'operational', 'maintenance', or 'retired' |

### Pricing
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `daily_rate` | DECIMAL(10,2) | Yes | 0.00 | Daily rental rate |
| `weekly_rate` | DECIMAL(10,2) | No | - | Weekly rental rate |
| `monthly_rate` | DECIMAL(10,2) | No | - | Monthly rental rate |
| `deposit_required` | DECIMAL(10,2) | Yes | 500.00 | Security deposit amount |
| `base_price_per_mile` | DECIMAL(10,2) | Yes | 0.00 | Base price per mile for mileage charges |

### Availability & Status
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `is_active` | BOOLEAN | Yes | true | Whether vehicle is active and visible on website |
| `display_order` | INTEGER | No | 0 | Display order for sorting |

### Metadata
| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `created_at` | TIMESTAMPTZ | Yes | now() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Yes | now() | Last update timestamp |

## Constraints

### Check Constraints
- `vehicles_service_status_check`: service_status IN ('operational', 'maintenance', 'retired')
- `vehicles_transmission_check`: transmission_type IN ('Automatic', 'Manual')
- `vehicles_fuel_type_check`: fuel_type IN ('Petrol', 'Diesel', 'Hybrid', 'Electric')

### Indexes
- `idx_vehicles_category`: Index on category for filtering
- `idx_vehicles_is_active`: Index on is_active for active vehicles queries
- `idx_vehicles_service_status`: Index on service_status for status filtering
- `idx_vehicles_registration_number`: Index on registration_number for searching

## RLS Policies

1. **"Anyone can view available vehicles"**: `SELECT` for vehicles where `is_active = true`
2. **"Admins can manage vehicles"**: `ALL` operations for users with admin role

## Migration Notes

### Column Migrations
The migration handles the following column name changes:
- `passengers` → `capacity`
- `luggage` → `luggage_capacity`
- `is_available` → `is_active`

### Auto-calculated Fields
- If `weekly_rate` is NULL, it's set to `daily_rate * 6`
- If `monthly_rate` is NULL, it's set to `daily_rate * 25`

## Storage Bucket

Vehicle images are stored in the `vehicle-images` storage bucket with public access.
