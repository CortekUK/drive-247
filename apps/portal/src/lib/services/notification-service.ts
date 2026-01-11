import { supabase } from "@/integrations/supabase/client";
import { emailService } from "./email-service";
import { smsService } from "./sms-service";

/**
 * Notification types for in-app notifications
 */
export type NotificationType =
  | "payment_verification"
  | "payment_rejection"
  | "booking_new"
  | "booking_approved"
  | "booking_rejected"
  | "booking_cancelled"
  | "rental_reminder"
  | "insurance_reminder"
  | "mot_reminder"
  | "tax_reminder"
  | "fine_new"
  | "general";

/**
 * Base notification options
 */
export interface NotificationOptions {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
  metadata?: Record<string, any>;
  tenantId?: string;
}

/**
 * Email notification options
 */
export interface EmailNotificationOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, string>;
}

/**
 * SMS notification options
 */
export interface SmsNotificationOptions {
  phoneNumber: string;
  message: string;
  senderId?: string;
}

/**
 * Notification service for managing in-app, email, and SMS notifications
 * Coordinates between database notifications and external notification services
 */
export class NotificationService {
  /**
   * Create an in-app notification in the database
   * @param options Notification options
   */
  async createInAppNotification(options: NotificationOptions): Promise<void> {
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: options.userId,
        title: options.title,
        message: options.message,
        type: options.type,
        link: options.link,
        metadata: options.metadata,
        tenant_id: options.tenantId,
      });

      if (error) {
        console.error("Error creating in-app notification:", error);
        throw new Error(`Failed to create notification: ${error.message}`);
      }
    } catch (err) {
      console.error("Exception creating in-app notification:", err);
      throw err;
    }
  }

  /**
   * Create in-app notifications for multiple users with deduplication
   * @param userIds Array of user IDs
   * @param title Notification title
   * @param message Notification message
   * @param type Notification type
   * @param link Optional link
   * @param metadata Optional metadata - if contains rental_id, used for deduplication
   */
  async createBulkInAppNotifications(
    userIds: string[],
    title: string,
    message: string,
    type: NotificationType,
    link?: string,
    metadata?: Record<string, any>,
    tenantId?: string
  ): Promise<void> {
    // Deduplication: Check if notifications already exist for this rental_id or payment_id
    const dedupeKey = metadata?.rental_id || metadata?.payment_id;
    if (dedupeKey && tenantId) {
      try {
        // Check for existing notifications with the same type and rental/payment ID
        const { data: existing } = await supabase
          .from("notifications")
          .select("id, user_id")
          .eq("tenant_id", tenantId)
          .eq("type", type)
          .contains("metadata", { rental_id: dedupeKey })
          .limit(1);

        if (existing && existing.length > 0) {
          console.log(`Skipping duplicate notifications for ${type} with key ${dedupeKey} - already exists`);
          return;
        }
      } catch (dedupeErr) {
        // If deduplication check fails, proceed with creation
        console.warn("Deduplication check failed, proceeding:", dedupeErr);
      }
    }

    const notifications = userIds.map((userId) => ({
      user_id: userId,
      title,
      message,
      type,
      link,
      metadata,
      tenant_id: tenantId,
    }));

    try {
      const { error } = await supabase.from("notifications").insert(notifications);

      if (error) {
        console.error("Error creating bulk notifications:", error);
        throw new Error(`Failed to create notifications: ${error.message}`);
      }
    } catch (err) {
      console.error("Exception creating bulk notifications:", err);
      throw err;
    }
  }

  /**
   * Get admin user IDs (admin and head_admin roles)
   * @param tenantId Optional tenant ID to filter admins by tenant
   * @returns Array of admin user IDs
   */
  async getAdminUserIds(tenantId?: string): Promise<string[]> {
    let query = supabase
      .from("app_users")
      .select("id")
      .in("role", ["admin", "head_admin"]);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching admin users:", error);
      return [];
    }

    return (data || []).map((user) => user.id);
  }

  /**
   * Notify all admins with an in-app notification
   * @param title Notification title
   * @param message Notification message
   * @param type Notification type
   * @param link Optional link
   * @param metadata Optional metadata
   * @param tenantId Optional tenant ID
   */
  async notifyAdmins(
    title: string,
    message: string,
    type: NotificationType,
    link?: string,
    metadata?: Record<string, any>,
    tenantId?: string
  ): Promise<void> {
    const adminIds = await this.getAdminUserIds(tenantId);

    if (adminIds.length === 0) {
      console.warn("No admin users found to notify");
      return;
    }

    await this.createBulkInAppNotifications(
      adminIds,
      title,
      message,
      type,
      link,
      metadata,
      tenantId
    );
  }

  /**
   * Send email notification
   * @param options Email notification options
   */
  async sendEmail(options: EmailNotificationOptions): Promise<void> {
    try {
      await emailService.sendEmail(options);
    } catch (err) {
      console.error("Failed to send email notification:", err);
      // Don't throw - allow other notifications to proceed
    }
  }

  /**
   * Send SMS notification
   * @param options SMS notification options
   */
  async sendSms(options: SmsNotificationOptions): Promise<void> {
    try {
      await smsService.sendMessage(
        options.phoneNumber,
        options.message,
        options.senderId
      );
    } catch (err) {
      console.error("Failed to send SMS notification:", err);
      // Don't throw - allow other notifications to proceed
    }
  }

  /**
   * Send a complete notification (in-app + email + SMS)
   * @param inAppOptions In-app notification options (optional)
   * @param emailOptions Email notification options (optional)
   * @param smsOptions SMS notification options (optional)
   */
  async sendCompleteNotification(
    inAppOptions?: NotificationOptions,
    emailOptions?: EmailNotificationOptions,
    smsOptions?: SmsNotificationOptions
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    if (inAppOptions) {
      promises.push(this.createInAppNotification(inAppOptions));
    }

    if (emailOptions) {
      promises.push(this.sendEmail(emailOptions));
    }

    if (smsOptions) {
      promises.push(this.sendSms(smsOptions));
    }

    // Execute all notifications in parallel
    await Promise.allSettled(promises);
  }

  /**
   * Send notification to admins via all channels
   * @param title Notification title
   * @param message Notification message
   * @param type Notification type
   * @param emailSubject Email subject (optional)
   * @param emailContent Email content (optional)
   * @param link Optional link for in-app notification
   * @param metadata Optional metadata for in-app notification
   */
  async notifyAdminsAllChannels(
    title: string,
    message: string,
    type: NotificationType,
    emailSubject?: string,
    emailContent?: string,
    link?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Send in-app notifications
    await this.notifyAdmins(title, message, type, link, metadata);

    // Send email to admin email address if content provided
    if (emailSubject && emailContent) {
      const adminEmail = process.env.ADMIN_EMAIL || "admin@drive-247.com";
      await this.sendEmail({
        to: adminEmail,
        subject: emailSubject,
        html: emailContent,
      });
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
