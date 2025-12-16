-- Create testimonials table
CREATE TABLE IF NOT EXISTS testimonials (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    author TEXT NOT NULL,
    company_name TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
    review TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_testimonials_stars ON testimonials(stars);
CREATE INDEX idx_testimonials_created_at ON testimonials(created_at);

-- Enable RLS
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;

-- Create policy for public to view testimonials (for public-facing pages)
CREATE POLICY "Allow public to view testimonials"
    ON testimonials FOR SELECT
    TO public
    USING (true);

-- Create policy for authenticated users to manage testimonials
CREATE POLICY "Allow authenticated users to manage testimonials"
    ON testimonials FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add comments
COMMENT ON TABLE testimonials IS 'Stores customer testimonials for display on public-facing pages';
COMMENT ON COLUMN testimonials.author IS 'Name of the person providing the testimonial';
COMMENT ON COLUMN testimonials.company_name IS 'Company name of the testimonial author';
COMMENT ON COLUMN testimonials.stars IS 'Rating from 1 to 5 stars';
COMMENT ON COLUMN testimonials.review IS 'The testimonial review text';
COMMENT ON COLUMN testimonials.created_by IS 'Admin user who created this testimonial';
