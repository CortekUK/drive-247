-- Add security fields to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS has_ghost boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_tracker boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_remote_immobiliser boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS security_notes text;

-- Create vehicle_files table
CREATE TABLE IF NOT EXISTS public.vehicle_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    content_type text,
    size_bytes bigint,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);

-- Create vehicle_expenses table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_category') THEN
        CREATE TYPE expense_category AS ENUM ('Repair', 'Service', 'Tyres', 'Valet', 'Accessory', 'Other');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vehicle_expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    expense_date date NOT NULL DEFAULT CURRENT_DATE,
    category expense_category NOT NULL DEFAULT 'Other',
    amount numeric NOT NULL CHECK (amount >= 0),
    notes text,
    reference text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create vehicle_events table for history tracking
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_event_type') THEN
        CREATE TYPE vehicle_event_type AS ENUM ('acquisition_created', 'acquisition_updated', 'rental_started', 'rental_ended', 'expense_added', 'expense_removed', 'fine_assigned', 'fine_closed', 'file_uploaded', 'file_deleted', 'disposal', 'service_added', 'service_updated', 'service_removed');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vehicle_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    event_type vehicle_event_type NOT NULL,
    event_date timestamp with time zone NOT NULL DEFAULT now(),
    summary text NOT NULL,
    reference_id uuid,
    reference_table text,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.vehicle_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for new tables (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_files' AND policyname = 'Allow all operations for app users on vehicle_files') THEN
        CREATE POLICY "Allow all operations for app users on vehicle_files" 
        ON public.vehicle_files FOR ALL 
        USING (true) 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_expenses' AND policyname = 'Allow all operations for app users on vehicle_expenses') THEN
        CREATE POLICY "Allow all operations for app users on vehicle_expenses" 
        ON public.vehicle_expenses FOR ALL 
        USING (true) 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_events' AND policyname = 'Allow all operations for app users on vehicle_events') THEN
        CREATE POLICY "Allow all operations for app users on vehicle_events" 
        ON public.vehicle_events FOR ALL 
        USING (true) 
        WITH CHECK (true);
    END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_files_vehicle_id ON public.vehicle_files(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_vehicle_id ON public.vehicle_expenses(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_date ON public.vehicle_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle_id ON public.vehicle_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_date ON public.vehicle_events(event_date);

-- Create storage bucket for vehicle files (only if it doesn't exist)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vehicle-files', 'vehicle-files', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for vehicle files
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.policies WHERE name = 'Users can view vehicle files') THEN
        CREATE POLICY "Users can view vehicle files" 
        ON storage.objects FOR SELECT 
        USING (bucket_id = 'vehicle-files');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM storage.policies WHERE name = 'Users can upload vehicle files') THEN
        CREATE POLICY "Users can upload vehicle files" 
        ON storage.objects FOR INSERT 
        WITH CHECK (bucket_id = 'vehicle-files');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM storage.policies WHERE name = 'Users can update vehicle files') THEN
        CREATE POLICY "Users can update vehicle files" 
        ON storage.objects FOR UPDATE 
        USING (bucket_id = 'vehicle-files');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM storage.policies WHERE name = 'Users can delete vehicle files') THEN
        CREATE POLICY "Users can delete vehicle files" 
        ON storage.objects FOR DELETE 
        USING (bucket_id = 'vehicle-files');
    END IF;
END $$;