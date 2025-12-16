import { supabase } from "@/integrations/supabase/client";

/**
 * SMS service options for sending SMS via AWS SNS
 */
export interface SmsOptions {
  phoneNumber: string;
  message: string;
  senderId?: string;
}

/**
 * SMS service for sending text messages via AWS SNS
 * Uses the aws-sns-sms Supabase edge function
 */
export class SmsService {
  /**
   * Send an SMS via AWS SNS
   * @param options SMS options including phone number and message
   * @throws Error if SMS sending fails
   */
  async sendSms(options: SmsOptions): Promise<void> {
    try {
      const { error } = await supabase.functions.invoke("aws-sns-sms", {
        body: options,
      });

      if (error) {
        console.error("SMS service error:", error);
        throw new Error(`Failed to send SMS: ${error.message}`);
      }
    } catch (err) {
      console.error("SMS service exception:", err);
      throw err;
    }
  }

  /**
   * Send a simple SMS message
   * @param phoneNumber Recipient phone number (E.164 format recommended: +1234567890)
   * @param message SMS message content (max 160 characters recommended)
   * @param senderId Optional sender ID to display to recipient
   */
  async sendMessage(
    phoneNumber: string,
    message: string,
    senderId?: string
  ): Promise<void> {
    // Validate phone number format
    if (!phoneNumber || phoneNumber.trim().length === 0) {
      throw new Error("Phone number is required");
    }

    // Validate message content
    if (!message || message.trim().length === 0) {
      throw new Error("Message content is required");
    }

    // Format phone number to E.164 if needed
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    await this.sendSms({
      phoneNumber: formattedPhone,
      message: message.trim(),
      senderId,
    });
  }

  /**
   * Format phone number to E.164 format
   * @param phoneNumber Phone number to format
   * @returns Formatted phone number
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, "");

    // If number doesn't start with country code, assume US (+1)
    if (!phoneNumber.startsWith("+")) {
      if (cleaned.length === 10) {
        // US number without country code
        cleaned = "1" + cleaned;
      }
      return "+" + cleaned;
    }

    return phoneNumber;
  }

  /**
   * Send bulk SMS messages to multiple recipients
   * @param recipients Array of phone numbers
   * @param message SMS message content
   * @param senderId Optional sender ID
   * @returns Array of results with success/failure status for each recipient
   */
  async sendBulkSms(
    recipients: string[],
    message: string,
    senderId?: string
  ): Promise<Array<{ phoneNumber: string; success: boolean; error?: string }>> {
    const results = await Promise.allSettled(
      recipients.map((phoneNumber) =>
        this.sendMessage(phoneNumber, message, senderId)
      )
    );

    return results.map((result, index) => ({
      phoneNumber: recipients[index],
      success: result.status === "fulfilled",
      error: result.status === "rejected" ? result.reason?.message : undefined,
    }));
  }
}

// Export singleton instance
export const smsService = new SmsService();
