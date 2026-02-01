-- Enable realtime for blocked_dates table
-- This allows the booking frontend to receive live updates when blocked dates are changed in the portal

ALTER PUBLICATION supabase_realtime ADD TABLE public.blocked_dates;
