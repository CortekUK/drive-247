-- ================================================
-- EMAIL TEMPLATES TABLE
-- ================================================
-- Create table for storing email templates with rich text content
-- Supports categorization and variable substitution

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('rejection', 'approval', 'reminder', 'general')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL, -- Rich text HTML content
  variables JSONB DEFAULT '[]'::jsonb, -- Array of variable names
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- ================================================
-- INDEXES
-- ================================================

CREATE INDEX idx_email_templates_category ON email_templates(category);
CREATE INDEX idx_email_templates_is_active ON email_templates(is_active);
CREATE INDEX idx_email_templates_created_at ON email_templates(created_at DESC);

-- ================================================
-- ROW LEVEL SECURITY
-- ================================================

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read active templates
CREATE POLICY "Allow read access to active templates"
  ON email_templates
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Allow admins to manage templates
CREATE POLICY "Allow admins to manage templates"
  ON email_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('head_admin', 'admin')
    )
  );

-- ================================================
-- TRIGGER FOR UPDATED_AT
-- ================================================

CREATE OR REPLACE FUNCTION update_email_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_email_template_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_template_updated_at();

-- ================================================
-- DEFAULT TEMPLATES
-- ================================================

-- Rejection Template (Default)
INSERT INTO email_templates (name, category, subject, body, variables) VALUES
('booking_rejection_default', 'rejection', 'Booking Update - {{bookingRef}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #C5A572; font-size: 28px; font-weight: bold;">DRIVE 247</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">Booking Update</h2>

              <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
                Dear {{customerName}},
              </p>

              <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
                We regret to inform you that your booking request (Reference: <strong>{{bookingRef}}</strong>) could not be approved at this time.
              </p>

              {{#if rejectionReason}}
              <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px;"><strong>Reason:</strong></p>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 14px;">{{rejectionReason}}</p>
              </div>
              {{/if}}

              <!-- Refund Information -->
              <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 20px; margin: 20px 0; border-radius: 4px; text-align: center;">
                <p style="margin: 0; color: #155724; font-size: 18px; font-weight: bold;">✓ No Charge to Your Card</p>
                <p style="margin: 10px 0 0 0; color: #155724; font-size: 14px;">
                  {{#if refundAmount}}
                  A refund of <strong>${{refundAmount}}</strong> will be processed to your original payment method within 5-7 business days.
                  {{else}}
                  The authorization hold on your card has been released. It may take 1-3 business days to reflect in your account.
                  {{/if}}
                </p>
              </div>

              <p style="margin: 20px 0 0 0; color: #555; font-size: 16px; line-height: 1.6;">
                If you have any questions or would like to discuss alternative options, please don''t hesitate to contact us.
              </p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:support@drive-247.com" style="display: inline-block; background-color: #C5A572; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 4px; font-size: 16px; font-weight: bold;">Contact Us</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 0 0 5px 0; color: #6c757d; font-size: 14px;">DRIVE 247 Luxury Vehicle Rentals</p>
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Email: support@drive-247.com | Phone: (555) 123-4567
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
'["customerName", "bookingRef", "rejectionReason", "refundAmount", "vehicleName"]'::jsonb);

-- Approval Template (Default)
INSERT INTO email_templates (name, category, subject, body, variables) VALUES
('booking_approval_default', 'approval', 'Booking Confirmed - {{bookingRef}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #C5A572; font-size: 28px; font-weight: bold;">DRIVE 247</h1>
              <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 16px;">Your Booking is Confirmed!</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 0 0 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #155724; font-size: 18px; font-weight: bold;">✓ Booking Confirmed</p>
              </div>

              <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
                Dear {{customerName}},
              </p>

              <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
                Great news! Your booking has been approved and confirmed. We''re excited to provide you with an exceptional driving experience.
              </p>

              <!-- Booking Details -->
              <table width="100%" cellpadding="10" cellspacing="0" style="border: 1px solid #e9ecef; border-radius: 4px; margin: 20px 0;">
                <tr style="background-color: #f8f9fa;">
                  <td style="padding: 15px; border-bottom: 1px solid #e9ecef;">
                    <strong style="color: #333;">Booking Reference:</strong><br>
                    <span style="color: #C5A572; font-size: 18px; font-weight: bold;">{{bookingRef}}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #e9ecef;">
                    <strong style="color: #333;">Vehicle:</strong><br>
                    <span style="color: #555;">{{vehicleName}}</span>
                  </td>
                </tr>
                <tr style="background-color: #f8f9fa;">
                  <td style="padding: 15px; border-bottom: 1px solid #e9ecef;">
                    <strong style="color: #333;">Pickup Date:</strong><br>
                    <span style="color: #555;">{{pickupDate}}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px;">
                    <strong style="color: #333;">Return Date:</strong><br>
                    <span style="color: #555;">{{returnDate}}</span>
                  </td>
                </tr>
              </table>

              <!-- Payment Info -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; margin: 20px 0; border-radius: 4px; text-align: center;">
                <p style="margin: 0; color: #ffffff; font-size: 14px;">Total Charged</p>
                <p style="margin: 5px 0 0 0; color: #ffffff; font-size: 28px; font-weight: bold;">${{totalAmount}}</p>
              </div>

              <h3 style="margin: 30px 0 15px 0; color: #333; font-size: 20px;">Next Steps:</h3>
              <ol style="margin: 0; padding-left: 20px; color: #555; font-size: 16px; line-height: 1.8;">
                <li>You will receive a rental agreement via DocuSign shortly</li>
                <li>Please sign the agreement before your pickup date</li>
                <li>Bring a valid driver''s license and insurance on pickup day</li>
                <li>Our team will contact you 24 hours before pickup with final details</li>
              </ol>

              <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:support@drive-247.com" style="display: inline-block; background-color: #C5A572; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 4px; font-size: 16px; font-weight: bold;">Contact Support</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 0 0 5px 0; color: #6c757d; font-size: 14px;">DRIVE 247 Luxury Vehicle Rentals</p>
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Email: support@drive-247.com | Phone: (555) 123-4567
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
'["customerName", "bookingRef", "vehicleName", "pickupDate", "returnDate", "totalAmount"]'::jsonb);

-- Reminder Template (Default)
INSERT INTO email_templates (name, category, subject, body, variables) VALUES
('payment_reminder_default', 'reminder', 'Payment Reminder - {{bookingRef}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #C5A572; font-size: 28px; font-weight: bold;">DRIVE 247</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">Payment Reminder</h2>
              <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
                Dear {{customerName}},
              </p>
              <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
                This is a friendly reminder that payment for booking <strong>{{bookingRef}}</strong> is due.
              </p>
              <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; text-align: center;">
                <p style="margin: 0; color: #856404; font-size: 16px;">Amount Due: <strong style="font-size: 24px;">${{amountDue}}</strong></p>
                <p style="margin: 10px 0 0 0; color: #856404; font-size: 14px;">Due Date: {{dueDate}}</p>
              </div>
              <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:support@drive-247.com" style="display: inline-block; background-color: #C5A572; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 4px; font-size: 16px; font-weight: bold;">Make Payment</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 0 0 5px 0; color: #6c757d; font-size: 14px;">DRIVE 247 Luxury Vehicle Rentals</p>
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Email: support@drive-247.com | Phone: (555) 123-4567
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
'["customerName", "bookingRef", "amountDue", "dueDate"]'::jsonb);
