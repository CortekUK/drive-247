-- Create blocked_dates table
CREATE TABLE IF NOT EXISTS blocked_dates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create index for faster date lookups
CREATE INDEX idx_blocked_dates_start ON blocked_dates(start_date);
CREATE INDEX idx_blocked_dates_end ON blocked_dates(end_date);
CREATE INDEX idx_blocked_dates_range ON blocked_dates(start_date, end_date);

-- Enable RLS
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to view blocked dates
CREATE POLICY "Allow authenticated users to view blocked dates"
    ON blocked_dates FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for authenticated users to manage blocked dates
CREATE POLICY "Allow authenticated users to manage blocked dates"
    ON blocked_dates FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add comments
COMMENT ON TABLE blocked_dates IS 'Stores date ranges that are blocked globally for all rentals';
COMMENT ON COLUMN blocked_dates.start_date IS 'Start date of the blocked period';
COMMENT ON COLUMN blocked_dates.end_date IS 'End date of the blocked period';
COMMENT ON COLUMN blocked_dates.reason IS 'Optional reason for blocking these dates';
COMMENT ON COLUMN blocked_dates.created_by IS 'Admin user who created this blocked date range';
