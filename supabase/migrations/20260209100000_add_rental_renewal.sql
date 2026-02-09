ALTER TABLE public.rentals
  ADD COLUMN renewed_from_rental_id UUID REFERENCES public.rentals(id);

CREATE INDEX idx_rentals_renewed_from ON public.rentals(renewed_from_rental_id)
  WHERE renewed_from_rental_id IS NOT NULL;

COMMENT ON COLUMN public.rentals.renewed_from_rental_id IS
  'Links to the previous rental this was renewed from';
