import { supabase } from "@/integrations/supabase/client";
import { notificationService } from "./services/notification-service";
import { formatCurrency } from "@/lib/format-utils";

interface PaymentVerificationNotificationData {
  paymentId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  currencyCode?: string;
  rentalId?: string;
  vehicleReg?: string;
}

interface PaymentRejectionNotificationData {
  paymentId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  reason: string;
  rentalId?: string;
  vehicleReg?: string;
}

// Send notification to admins when a new payment needs manual verification
export async function sendPaymentVerificationNotification(data: PaymentVerificationNotificationData): Promise<void> {
  console.log('Sending payment verification notification for payment:', data.paymentId);

  try {
    // Format amount with tenant currency (default to GBP if not provided)
    const formattedAmount = formatCurrency(data.amount, data.currencyCode || 'GBP');

    // Create in-app notification for all admins
    await notificationService.notifyAdmins(
      'Payment Requires Verification',
      `New payment of ${formattedAmount} from ${data.customerName} needs your approval`,
      'payment_verification',
      `/payments?status=pending`,
      {
        payment_id: data.paymentId,
        customer_id: data.customerId,
        customer_name: data.customerName,
        amount: data.amount,
        rental_id: data.rentalId,
        vehicle_reg: data.vehicleReg
      }
    );

    console.log('Payment verification in-app notifications created');

    // Send email notification via edge function
    try {
      const { error: emailError } = await supabase.functions.invoke('send-payment-verification-email', {
        body: {
          paymentId: data.paymentId,
          customerId: data.customerId,
          customerName: data.customerName,
          amount: data.amount,
          vehicleReg: data.vehicleReg
        }
      });

      if (emailError) {
        console.log('Email notification via edge function failed:', emailError.message);
      }
    } catch (error) {
      console.log('Edge function call failed (expected in local dev):', error);
    }
  } catch (error) {
    console.error('Error creating payment verification notifications:', error);
  }
}

// Send notification to customer when their payment is rejected
export async function sendPaymentRejectionNotification(data: PaymentRejectionNotificationData): Promise<void> {
  console.log('Sending payment rejection notification for payment:', data.paymentId);

  try {
    // Send email to customer via edge function
    const { error: emailError } = await supabase.functions.invoke('send-payment-rejection-email', {
      body: {
        paymentId: data.paymentId,
        customerId: data.customerId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        amount: data.amount,
        reason: data.reason,
        vehicleReg: data.vehicleReg
      }
    });

    if (emailError) {
      console.log('Payment rejection email failed:', emailError.message);
    } else {
      console.log('Payment rejection email sent to:', data.customerEmail);
    }
  } catch (error) {
    console.error('Error sending payment rejection notification:', error);
  }
}

interface BookingNotificationData {
  rentalId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  vehicleReg: string;
  vehicleMake: string;
  vehicleModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: number;
  totalAmount: number;
}

export async function sendBookingNotification(data: BookingNotificationData): Promise<void> {
  console.log('Sending booking notifications for rental:', data.rentalId);

  // 1. Create in-app notification for admin users
  try {
    await notificationService.notifyAdmins(
      'New Booking Created',
      `${data.customerName} booked ${data.vehicleMake} ${data.vehicleModel} (${data.vehicleReg})`,
      'booking_new',
      `/rentals/${data.rentalId}`,
      {
        rental_id: data.rentalId,
        customer_id: data.customerId,
        vehicle_reg: data.vehicleReg
      }
    );
    console.log('In-app notifications created for admins');
  } catch (error) {
    console.error('Error creating in-app notifications:', error);
  }

  // 2. Send emails via edge function
  try {
    const { data: emailResult, error: emailError } = await supabase.functions.invoke('send-booking-notification', {
      body: {
        rentalId: data.rentalId,
        customerId: data.customerId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        vehicleReg: data.vehicleReg,
        vehicleMake: data.vehicleMake,
        vehicleModel: data.vehicleModel,
        startDate: data.startDate,
        endDate: data.endDate,
        monthlyAmount: data.monthlyAmount,
        totalAmount: data.totalAmount,
      }
    });

    if (emailError) {
      console.log('Email notification via edge function failed (expected in local dev):', emailError.message);
    } else {
      console.log('Email notifications sent via edge function:', emailResult);
    }
  } catch (error) {
    console.log('Edge function call failed (expected in local dev):', error);
  }

  console.log('Booking notifications completed');
}
