-- Update P&L category mapping for vehicle expenses
CREATE OR REPLACE FUNCTION public.handle_vehicle_expense_pnl()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    pnl_category TEXT;
BEGIN
    -- Map expense categories to P&L categories
    CASE NEW.category
        WHEN 'Service' THEN
            pnl_category := 'Service';
        WHEN 'Repair', 'Tyres', 'Valet', 'Accessory', 'Other' THEN
            pnl_category := 'Expenses';
        ELSE
            pnl_category := 'Expenses';
    END CASE;

    IF TG_OP = 'INSERT' THEN
        -- Add P&L cost entry for new expense with proper reference format
        INSERT INTO public.pnl_entries (
            vehicle_id, entry_date, side, category, amount, reference
        ) VALUES (
            NEW.vehicle_id, NEW.expense_date, 'Cost', pnl_category, NEW.amount, 'vexp:' || NEW.id::text
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
        -- Update P&L entry with new category mapping
        CASE NEW.category
            WHEN 'Service' THEN
                pnl_category := 'Service';
            WHEN 'Repair', 'Tyres', 'Valet', 'Accessory', 'Other' THEN
                pnl_category := 'Expenses';
            ELSE
                pnl_category := 'Expenses';
        END CASE;
        
        UPDATE public.pnl_entries 
        SET amount = NEW.amount, 
            entry_date = NEW.expense_date,
            category = pnl_category
        WHERE reference = 'vexp:' || NEW.id::text;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Remove P&L entry
        DELETE FROM public.pnl_entries WHERE reference = 'vexp:' || OLD.id::text;
        
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
$function$;