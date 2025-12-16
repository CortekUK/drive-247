import { supabase } from "@/integrations/supabase/client";

/**
 * Email service options for sending emails via AWS SES
 */
export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  template?: string;
  templateData?: Record<string, string>;
}

/**
 * Email service for sending transactional emails via AWS SES
 * Uses the aws-ses-email Supabase edge function
 */
export class EmailService {
  /**
   * Send an email via AWS SES
   * @param options Email options including recipient, subject, and content
   * @throws Error if email sending fails
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const { error } = await supabase.functions.invoke("aws-ses-email", {
        body: options,
      });

      if (error) {
        console.error("Email service error:", error);
        throw new Error(`Failed to send email: ${error.message}`);
      }
    } catch (err) {
      console.error("Email service exception:", err);
      throw err;
    }
  }

  /**
   * Send a templated email via AWS SES
   * @param template Template name to use
   * @param to Recipient email address(es)
   * @param data Template data to populate the template
   * @param subject Email subject line
   * @param from Optional sender email (defaults to SES_FROM_EMAIL)
   */
  async sendTemplateEmail(
    template: string,
    to: string | string[],
    data: Record<string, string>,
    subject: string,
    from?: string
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject,
      template,
      templateData: data,
      from,
    });
  }

  /**
   * Send a plain text email
   * @param to Recipient email address(es)
   * @param subject Email subject
   * @param text Plain text content
   * @param from Optional sender email
   */
  async sendTextEmail(
    to: string | string[],
    subject: string,
    text: string,
    from?: string
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject,
      text,
      from,
    });
  }

  /**
   * Send an HTML email
   * @param to Recipient email address(es)
   * @param subject Email subject
   * @param html HTML content
   * @param from Optional sender email
   * @param replyTo Optional reply-to address
   */
  async sendHtmlEmail(
    to: string | string[],
    subject: string,
    html: string,
    from?: string,
    replyTo?: string
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject,
      html,
      from,
      replyTo,
    });
  }
}

// Export singleton instance
export const emailService = new EmailService();
