-- Clean up duplicate reminders, keeping only the most relevant one per vehicle/event type
-- Based on current date of 2025-09-15

-- Delete duplicate MOT reminders for GJ21 NVR (keep 7D, remove 14D and 30D)
DELETE FROM reminders 
WHERE object_id = '09701944-50cc-4588-b992-5a9162c5c2a4' 
AND rule_code IN ('VEH_MOT_14D', 'VEH_MOT_30D');

-- Delete duplicate TAX reminders for GJ21 NVR (keep 14D, remove 30D)  
DELETE FROM reminders 
WHERE object_id = '09701944-50cc-4588-b992-5a9162c5c2a4' 
AND rule_code = 'VEH_TAX_30D';

-- Delete duplicate MOT reminders for HV22 GZD (keep 7D, remove 14D and 30D)
DELETE FROM reminders 
WHERE object_id = 'd8b352b5-d2cc-4f36-a7d1-a18891b3071c' 
AND rule_code IN ('VEH_MOT_14D', 'VEH_MOT_30D');