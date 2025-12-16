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

-- Create RLS policies for new tables
DROP POLICY IF EXISTS "Allow all operations for app users on vehicle_files" ON public.vehicle_files;
CREATE POLICY "Allow all operations for app users on vehicle_files" 
ON public.vehicle_files FOR ALL 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations for app users on vehicle_expenses" ON public.vehicle_expenses;
CREATE POLICY "Allow all operations for app users on vehicle_expenses" 
ON public.vehicle_expenses FOR ALL 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations for app users on vehicle_events" ON public.vehicle_events;
CREATE POLICY "Allow all operations for app users on vehicle_events" 
ON public.vehicle_events FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_files_vehicle_id ON public.vehicle_files(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_vehicle_id ON public.vehicle_expenses(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_date ON public.vehicle_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle_id ON public.vehicle_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_date ON public.vehicle_events(event_date);

-- Create storage bucket for vehicle files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vehicle-files', 'vehicle-files', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for vehicle files
DROP POLICY IF EXISTS "Users can view vehicle files" ON storage.objects;
CREATE POLICY "Users can view vehicle files" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'vehicle-files');

DROP POLICY IF EXISTS "Users can upload vehicle files" ON storage.objects;
CREATE POLICY "Users can upload vehicle files" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'vehicle-files');

DROP POLICY IF EXISTS "Users can update vehicle files" ON storage.objects;
CREATE POLICY "Users can update vehicle files" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'vehicle-files');

DROP POLICY IF EXISTS "Users can delete vehicle files" ON storage.objects;
CREATE POLICY "Users can delete vehicle files" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'vehicle-files');

-- Create trigger functions
CREATE OR REPLACE FUNCTION handle_vehicle_expense_pnl()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Add P&L cost entry for new expense
        INSERT INTO public.pnl_entries (
            vehicle_id, entry_date, side, category, amount, reference
        ) VALUES (
            NEW.vehicle_id, NEW.expense_date, 'Cost', 'Expenses', NEW.amount, NEW.id::text
        );
        
        -- Log event
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            NEW.vehicle_id, 'expense_added', 
            'Added ' || NEW.category || ' expense: £' || NEW.amount::text,
            NEW.id, 'vehicle_expenses'
        );
        
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Update P&L entry
        UPDATE public.pnl_entries 
        SET amount = NEW.amount, entry_date = NEW.expense_date
        WHERE reference = NEW.id::text;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Remove P&L entry
        DELETE FROM public.pnl_entries WHERE reference = OLD.id::text;
        
        -- Log event
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            OLD.vehicle_id, 'expense_removed', 
            'Removed ' || OLD.category || ' expense: £' || OLD.amount::text,
            OLD.id, 'vehicle_expenses'
        );
        
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for vehicle expense P&L integration
DROP TRIGGER IF EXISTS vehicle_expense_pnl_trigger ON public.vehicle_expenses;
CREATE TRIGGER vehicle_expense_pnl_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_expenses
    FOR EACH ROW EXECUTE FUNCTION handle_vehicle_expense_pnl();

-- Create function for vehicle event logging on file operations
CREATE OR REPLACE FUNCTION log_vehicle_file_event()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            NEW.vehicle_id, 'file_uploaded', 
            'Uploaded file: ' || NEW.file_name,
            NEW.id, 'vehicle_files'
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            OLD.vehicle_id, 'file_deleted', 
            'Deleted file: ' || OLD.file_name,
            OLD.id, 'vehicle_files'
        );
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for vehicle file events
DROP TRIGGER IF EXISTS vehicle_file_event_trigger ON public.vehicle_files;
CREATE TRIGGER vehicle_file_event_trigger
    AFTER INSERT OR DELETE ON public.vehicle_files
    FOR EACH ROW EXECUTE FUNCTION log_vehicle_file_event();