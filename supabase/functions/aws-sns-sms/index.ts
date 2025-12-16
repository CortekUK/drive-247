import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured,
} from "../_shared/aws-config.ts";

interface SMSRequest {
  phoneNumber: string;
  message: string;
  senderId?: string;
}

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
}

/**
 * Send SMS via AWS SNS
 */
async function sendSMS(request: SMSRequest): Promise<SMSResponse> {
  // Check if AWS is configured
  if (!isAWSConfigured()) {
    console.log('AWS not configured, simulating SMS send');
    console.log('To:', request.phoneNumber);
    console.log('Message:', request.message);
    return {
      success: true,
      simulated: true,
      messageId: 'simulated-sms-' + Date.now()
    };
  }

  // Normalize phone number (ensure E.164 format)
  let phoneNumber = request.phoneNumber.replace(/[^+\d]/g, '');
  if (!phoneNumber.startsWith('+')) {
    // Assume US number if no country code
    phoneNumber = '+1' + phoneNumber;
  }

  // Build SNS Publish request body
  const params: Record<string, string> = {
    'Action': 'Publish',
    'Version': '2010-03-31',
    'PhoneNumber': phoneNumber,
    'Message': request.message,
  };

  // Add sender ID if provided (note: not all regions/carriers support this)
  if (request.senderId) {
    params['MessageAttributes.entry.1.Name'] = 'AWS.SNS.SMS.SenderID';
    params['MessageAttributes.entry.1.Value.DataType'] = 'String';
    params['MessageAttributes.entry.1.Value.StringValue'] = request.senderId;
  }

  // Set SMS type to Transactional for higher delivery priority
  params['MessageAttributes.entry.2.Name'] = 'AWS.SNS.SMS.SMSType';
  params['MessageAttributes.entry.2.Value.DataType'] = 'String';
  params['MessageAttributes.entry.2.Value.StringValue'] = 'Transactional';

  // URL encode parameters
  const body = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  try {
    const response = await signedAWSRequest({
      service: 'sns',
      method: 'POST',
      body,
    });

    const responseText = await response.text();
    console.log('SNS Response Status:', response.status);

    if (!response.ok) {
      console.error('SNS Error Response:', responseText);
      const errorMessage = parseXMLValue(responseText, 'Message') || 'Unknown error';
      return {
        success: false,
        error: errorMessage,
      };
    }

    const messageId = parseXMLValue(responseText, 'MessageId');
    console.log('SMS sent successfully, MessageId:', messageId);

    return {
      success: true,
      messageId: messageId || undefined,
    };
  } catch (error) {
    console.error('SNS request error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const request: SMSRequest = await req.json();
    console.log('SMS request received:', {
      to: request.phoneNumber,
      messageLength: request.message.length,
    });

    // Validate required fields
    if (!request.phoneNumber || !request.message) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: phoneNumber, message',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate message length (SMS max is 160 chars for single segment)
    if (request.message.length > 1600) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message too long. Maximum 1600 characters.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await sendSMS(request);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in aws-sns-sms:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
