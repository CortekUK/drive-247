-- Enable real-time updates for plates table
ALTER TABLE public.plates REPLICA IDENTITY FULL;

-- Add plates table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.plates;