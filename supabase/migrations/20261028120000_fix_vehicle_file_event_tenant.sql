-- Vehicle file upload/delete has failed for every tenant since 2026-08-22 with
--   new row violates row-level security policy for table "vehicle_events"
--
-- 20260822120000_fleet_health_security_and_defect_fixes.sql enabled RLS on
-- vehicle_events with a policy requiring tenant_id = get_user_tenant_id().
-- log_vehicle_file_event() (AFTER INSERT/DELETE on vehicle_files, SECURITY
-- INVOKER) never set tenant_id, so its event row was NULL-tenant and the
-- policy rejected it — aborting the operator's upload/delete with it.
--
-- Fix: carry the file's tenant onto the event, falling back to the vehicle's
-- tenant. Same signature, still SECURITY INVOKER, so the policy keeps
-- applying and a user can only ever log events for their own tenant.

CREATE OR REPLACE FUNCTION public.log_vehicle_file_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table, tenant_id
        ) VALUES (
            NEW.vehicle_id, 'file_uploaded',
            'Uploaded file: ' || NEW.file_name,
            NEW.id, 'vehicle_files',
            COALESCE(NEW.tenant_id, (SELECT v.tenant_id FROM public.vehicles v WHERE v.id = NEW.vehicle_id))
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table, tenant_id
        ) VALUES (
            OLD.vehicle_id, 'file_deleted',
            'Deleted file: ' || OLD.file_name,
            OLD.id, 'vehicle_files',
            COALESCE(OLD.tenant_id, (SELECT v.tenant_id FROM public.vehicles v WHERE v.id = OLD.vehicle_id))
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$function$;
