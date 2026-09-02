'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

interface CommunicationSettingsProps {
  onBack?: () => void;
}

export function CommunicationSettings({ onBack }: CommunicationSettingsProps = {}) {
  return (
    <div className="space-y-6">
      {/* Header with optional back button */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div>
          <h3 className="text-lg font-semibold text-foreground">Communication Channels</h3>
          <p className="text-sm text-muted-foreground">
            Configure how you communicate with customers.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Email
            <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
          </CardTitle>
          <CardDescription>
            Send emails to your customers directly from the Messages page via the Email channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-4 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Email is active and ready to use. Select the <strong>Email</strong> channel in the Messages page to send emails to customers.</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Emails are sent via Resend using your tenant's configured sender address. The customer's email must be on file — you can add or edit it directly in the chat header when the Email channel is selected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default CommunicationSettings;
