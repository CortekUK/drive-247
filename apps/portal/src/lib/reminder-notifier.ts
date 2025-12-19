import { supabase } from "@/integrations/supabase/client";
import { notificationService, NotificationType } from "./services/notification-service";

interface ReminderForNotification {
  id: string;
  title: string;
  message: string;
  severity: string;
  object_type: string;
  object_id: string;
  rule_code: string;
  due_on: string;
}

/**
 * Creates in-app notifications for a reminder to all admin users
 */
export async function createReminderNotification(reminder: ReminderForNotification, tenantId?: string): Promise<void> {
  try {
    // Get admin users for this tenant
    const adminIds = await notificationService.getAdminUserIds(tenantId);

    if (adminIds.length === 0) return;

    // Determine notification type based on severity
    const notificationType: NotificationType = 'rental_reminder';

    // Determine link based on object type
    let link = '/reminders';
    switch (reminder.object_type) {
      case 'Vehicle': link = `/vehicles/${reminder.object_id}`; break;
      case 'Rental': link = `/rentals/${reminder.object_id}`; break;
      case 'Customer': link = `/customers/${reminder.object_id}`; break;
      case 'Fine': link = `/fines/${reminder.object_id}`; break;
    }

    // Create notification for each admin (only if not already notified for this reminder)
    for (const adminId of adminIds) {
      // Check if notification already exists
      let existingQuery = supabase
        .from('notifications')
        .select('id')
        .eq('user_id', adminId)
        .contains('metadata', { reminder_id: reminder.id });

      if (tenantId) {
        existingQuery = existingQuery.eq('tenant_id', tenantId);
      }

      const { data: existing } = await existingQuery.single();

      if (!existing) {
        await notificationService.createInAppNotification({
          userId: adminId,
          title: reminder.title,
          message: reminder.message,
          type: notificationType,
          link,
          metadata: {
            reminder_id: reminder.id,
            rule_code: reminder.rule_code,
            object_type: reminder.object_type,
            object_id: reminder.object_id,
            severity: reminder.severity,
            due_on: reminder.due_on
          },
          tenantId,
        });
      }
    }
  } catch (error) {
    console.error('Error creating reminder notification:', error);
  }
}

/**
 * Sends reminder notifications via the edge function (for email delivery)
 * This should be called after reminders are generated
 */
export async function sendReminderNotificationsViaEdgeFunction(): Promise<{
  success: boolean;
  notificationsCreated?: number;
  emailsSent?: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('send-reminder-notifications');

    if (error) {
      console.error('Error calling send-reminder-notifications:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      notificationsCreated: data?.notificationsCreated || 0,
      emailsSent: data?.emailsSent || 0
    };
  } catch (error: any) {
    console.error('Error sending reminder notifications:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Creates in-app notifications for all pending reminders
 * This can be called locally without the edge function
 */
export async function createNotificationsForPendingReminders(tenantId?: string): Promise<number> {
  let created = 0;

  try {
    const today = new Date().toISOString().split('T')[0];

    // Get pending reminders that should be notified
    let query = supabase
      .from('reminders')
      .select('*')
      .eq('status', 'pending')
      .lte('remind_on', today);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: pendingReminders, error } = await query;

    if (error) {
      console.error('Error fetching pending reminders:', error);
      return 0;
    }

    // Create notifications for each reminder
    for (const reminder of pendingReminders || []) {
      await createReminderNotification({
        id: reminder.id,
        title: reminder.title,
        message: reminder.message,
        severity: reminder.severity,
        object_type: reminder.object_type,
        object_id: reminder.object_id,
        rule_code: reminder.rule_code,
        due_on: reminder.due_on
      }, tenantId);
      created++;
    }

    return created;
  } catch (error) {
    console.error('Error creating notifications for pending reminders:', error);
    return created;
  }
}
