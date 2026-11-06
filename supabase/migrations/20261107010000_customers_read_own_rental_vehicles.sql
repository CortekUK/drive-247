-- A customer reads cars through public_can_read_bookable_vehicles, which hides
-- Disposed/Sold cars. So the moment a car was retired, the customer's own past
-- rental lost its car (name, photo) in the customer portal. Found by test sheet
-- 16.6. This lets a signed-in customer also read the cars on their OWN rentals.
-- It adds no column access a customer lacks today: the public policy already
-- exposes every non-retired car the same way.
CREATE OR REPLACE FUNCTION public.is_vehicle_on_my_rental(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    JOIN customer_users cu ON cu.customer_id = r.customer_id
    WHERE r.vehicle_id = p_vehicle_id
      AND cu.auth_user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_vehicle_on_my_rental(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_vehicle_on_my_rental(uuid) TO authenticated;

DROP POLICY IF EXISTS customers_read_vehicles_on_own_rentals ON public.vehicles;
CREATE POLICY customers_read_vehicles_on_own_rentals ON public.vehicles
  FOR SELECT TO authenticated
  USING (public.is_vehicle_on_my_rental(id));
