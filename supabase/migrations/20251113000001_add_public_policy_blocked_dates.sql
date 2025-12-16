-- Add public policy for blocked dates
-- This allows anonymous users (on client-side booking) to view blocked dates

CREATE POLICY "Allow public to view blocked dates"
    ON blocked_dates FOR SELECT
    TO anon, public
    USING (true);

-- Update comment
COMMENT ON TABLE blocked_dates IS 'Stores date ranges that are blocked globally for all rentals. Public can view to prevent booking on blocked dates.';
