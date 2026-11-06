-- A car's Activity tab (vehicle_events) recorded services, rentals and costs but
-- never its photos, so uploading or removing a photo left no trace there.
-- Found by test sheet 14.5. Reuses the existing file_uploaded / file_deleted
-- event types, marked as photos by reference_table = 'vehicle_photos'.
CREATE OR REPLACE FUNCTION public.log_vehicle_photo_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row vehicle_photos%ROWTYPE;
  v_tenant uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  -- Deleting a whole car cascades to its photos; the car is already gone then,
  -- and there is no Activity left to write to.
  SELECT tenant_id INTO v_tenant FROM vehicles WHERE id = v_row.vehicle_id;
  IF NOT FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO vehicle_events (vehicle_id, tenant_id, event_type, event_date, summary, reference_id, reference_table)
  VALUES (
    v_row.vehicle_id,
    COALESCE(v_row.tenant_id, v_tenant),
    CASE WHEN TG_OP = 'DELETE' THEN 'file_deleted'::vehicle_event_type ELSE 'file_uploaded'::vehicle_event_type END,
    now(),
    CASE WHEN TG_OP = 'DELETE' THEN 'Photo removed' ELSE 'Photo added' END,
    v_row.id,
    'vehicle_photos'
  );
  RETURN v_row;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vehicle_photo_event ON public.vehicle_photos;
CREATE TRIGGER trg_vehicle_photo_event
  AFTER INSERT OR DELETE ON public.vehicle_photos
  FOR EACH ROW EXECUTE FUNCTION public.log_vehicle_photo_event();
