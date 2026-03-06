'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Phone,
  Search,
  Unplug,
  Send,
  Plus,
  Globe,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTwilioSms } from '@/hooks/use-twilio-sms';

const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (+1)', flag: '🇺🇸' },
  { code: 'GB', label: 'United Kingdom (+44)', flag: '🇬🇧' },
  { code: 'CA', label: 'Canada (+1)', flag: '🇨🇦' },
  { code: 'AU', label: 'Australia (+61)', flag: '🇦🇺' },
  { code: 'DE', label: 'Germany (+49)', flag: '🇩🇪' },
  { code: 'FR', label: 'France (+33)', flag: '🇫🇷' },
  { code: 'ES', label: 'Spain (+34)', flag: '🇪🇸' },
  { code: 'IT', label: 'Italy (+39)', flag: '🇮🇹' },
  { code: 'NL', label: 'Netherlands (+31)', flag: '🇳🇱' },
  { code: 'IE', label: 'Ireland (+353)', flag: '🇮🇪' },
  { code: 'SE', label: 'Sweden (+46)', flag: '🇸🇪' },
  { code: 'NO', label: 'Norway (+47)', flag: '🇳🇴' },
  { code: 'DK', label: 'Denmark (+45)', flag: '🇩🇰' },
  { code: 'PL', label: 'Poland (+48)', flag: '🇵🇱' },
  { code: 'BE', label: 'Belgium (+32)', flag: '🇧🇪' },
  { code: 'AT', label: 'Austria (+43)', flag: '🇦🇹' },
  { code: 'CH', label: 'Switzerland (+41)', flag: '🇨🇭' },
  { code: 'PT', label: 'Portugal (+351)', flag: '🇵🇹' },
  { code: 'NZ', label: 'New Zealand (+64)', flag: '🇳🇿' },
  { code: 'ZA', label: 'South Africa (+27)', flag: '🇿🇦' },
  { code: 'AE', label: 'UAE (+971)', flag: '🇦🇪' },
  { code: 'IN', label: 'India (+91)', flag: '🇮🇳' },
];

export function TwilioSmsSettings() {
  const {
    status,
    isLoading,
    createSubaccount,
    searchNumbers,
    purchaseNumber,
    assignOwnNumber,
    sendTestSms,
    disconnect,
  } = useTwilioSms();

  // UI state
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);
  const [numberMode, setNumberMode] = useState<'search' | 'own' | null>(null);
  const [countryCode, setCountryCode] = useState('GB');
  const [searchContains, setSearchContains] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [ownNumber, setOwnNumber] = useState('');
  const [testPhoneNumber, setTestPhoneNumber] = useState('');

  const handleSearchNumbers = async () => {
    const result = await searchNumbers.mutateAsync({
      countryCode,
      contains: searchContains || undefined,
    });
    setAvailableNumbers(result.numbers || []);
  };

  const handlePurchaseNumber = async (phoneNumber: string) => {
    await purchaseNumber.mutateAsync(phoneNumber);
    setAvailableNumbers([]);
    setNumberMode(null);
  };

  const handleAssignOwn = async () => {
    if (!ownNumber) return;
    await assignOwnNumber.mutateAsync(ownNumber);
    setOwnNumber('');
    setNumberMode(null);
  };

  const handleSendTest = async () => {
    if (!testPhoneNumber) return;
    await sendTestSms.mutateAsync(testPhoneNumber);
  };

  const handleDisconnect = async () => {
    await disconnect.mutateAsync();
    setShowDisconnectWarning(false);
    setNumberMode(null);
    setAvailableNumbers([]);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading SMS status...</span>
        </CardContent>
      </Card>
    );
  }

  const isConfigured = status?.isConfigured ?? false;
  const hasSubaccount = status?.hasSubaccount ?? false;
  const hasPhoneNumber = status?.hasPhoneNumber ?? false;

  return (
    <div className="space-y-6">
      {/* How SMS Works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            SMS Notifications
          </CardTitle>
          <CardDescription>
            Send SMS notifications to your customers for bookings, reminders, and updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 p-4 rounded-lg">
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5 font-medium">1.</span>
                <span>Click "Set Up SMS" to create your messaging account</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5 font-medium">2.</span>
                <span>Get a phone number from Twilio or add your own existing number</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5 font-medium">3.</span>
                <span>Once configured, SMS notifications are automatically sent for booking confirmations, pickup reminders, and more</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Status & Setup Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            SMS Configuration
            {isConfigured ? (
              <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>
            ) : hasSubaccount ? (
              <Badge variant="secondary">Pending Setup</Badge>
            ) : (
              <Badge variant="secondary">Not Connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {isConfigured
              ? 'SMS notifications are active and sending from your number'
              : hasSubaccount
              ? 'Add a phone number to start sending SMS'
              : 'Set up SMS to send notifications to your customers'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Banner */}
          <div className={`p-4 rounded-lg border ${
            isConfigured
              ? 'bg-green-50 border-green-200'
              : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isConfigured
                  ? 'bg-green-100 text-green-600'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {isConfigured ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
              </div>
              <div>
                <h4 className={`font-medium ${isConfigured ? 'text-green-800' : 'text-gray-800'}`}>
                  {isConfigured
                    ? 'SMS Active'
                    : hasSubaccount
                    ? 'Account Created — Add a Phone Number'
                    : 'Not Connected'}
                </h4>
                <p className={`text-sm mt-1 ${isConfigured ? 'text-green-700' : 'text-gray-600'}`}>
                  {isConfigured
                    ? `Sending SMS from ${status?.phoneNumber}`
                    : hasSubaccount
                    ? 'Your messaging account is ready. Add a phone number to start sending SMS.'
                    : 'Set up your SMS account to send booking notifications, reminders, and alerts to customers.'}
                </p>
              </div>
            </div>
          </div>

          {/* Step 1: Create Subaccount */}
          {!hasSubaccount && (
            <Button
              onClick={() => createSubaccount.mutate()}
              disabled={createSubaccount.isPending}
              className="w-full"
            >
              {createSubaccount.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Set Up SMS
                </>
              )}
            </Button>
          )}

          {/* Step 2: Add Phone Number */}
          {hasSubaccount && !hasPhoneNumber && (
            <div className="space-y-4">
              {!numberMode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setNumberMode('search')}
                    className="h-auto py-4 flex flex-col items-center gap-2"
                  >
                    <Search className="h-5 w-5" />
                    <span className="font-medium">Get a Number</span>
                    <span className="text-xs text-muted-foreground">Purchase a new phone number</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setNumberMode('own')}
                    className="h-auto py-4 flex flex-col items-center gap-2"
                  >
                    <Phone className="h-5 w-5" />
                    <span className="font-medium">Use My Own Number</span>
                    <span className="text-xs text-muted-foreground">Add an existing number</span>
                  </Button>
                </div>
              )}

              {/* Search & Purchase Flow */}
              {numberMode === 'search' && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Search Available Numbers</h4>
                    <Button variant="ghost" size="sm" onClick={() => { setNumberMode(null); setAvailableNumbers([]); }}>
                      Cancel
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Country</Label>
                      <Select value={countryCode} onValueChange={setCountryCode}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRY_OPTIONS.map(c => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.flag} {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Contains (optional)</Label>
                      <Input
                        placeholder="e.g. 555"
                        value={searchContains}
                        onChange={(e) => setSearchContains(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={handleSearchNumbers}
                        disabled={searchNumbers.isPending}
                        className="w-full"
                      >
                        {searchNumbers.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="mr-2 h-4 w-4" />
                        )}
                        Search
                      </Button>
                    </div>
                  </div>

                  {/* Results */}
                  {availableNumbers.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {availableNumbers.map((num) => (
                        <div
                          key={num.phoneNumber}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                        >
                          <div>
                            <p className="font-mono font-medium">{num.phoneNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {[num.locality, num.region].filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handlePurchaseNumber(num.phoneNumber)}
                            disabled={purchaseNumber.isPending}
                          >
                            {purchaseNumber.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Select'
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchNumbers.isSuccess && availableNumbers.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No numbers found. Try a different country or search term.
                    </p>
                  )}
                </div>
              )}

              {/* Own Number Flow */}
              {numberMode === 'own' && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Add Your Own Number</h4>
                    <Button variant="ghost" size="sm" onClick={() => setNumberMode(null)}>
                      Cancel
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number (E.164 format)</Label>
                    <Input
                      placeholder="+44 7700 900123"
                      value={ownNumber}
                      onChange={(e) => setOwnNumber(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter your number with country code (e.g., +44 for UK, +1 for US). This number must be verified in your Twilio account.
                    </p>
                  </div>
                  <Button
                    onClick={handleAssignOwn}
                    disabled={!ownNumber || assignOwnNumber.isPending}
                  >
                    {assignOwnNumber.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      <>
                        <Phone className="mr-2 h-4 w-4" />
                        Assign Number
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Configured: Show details & test */}
          {isConfigured && (
            <div className="space-y-4">
              {/* Phone number display */}
              <div className="p-4 rounded-lg border bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Phone className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">SMS Number</p>
                    <p className="text-lg font-mono font-bold">{status?.phoneNumber}</p>
                  </div>
                </div>
              </div>

              {/* Test SMS */}
              <div className="p-4 rounded-lg border space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Send Test SMS
                </h4>
                <div className="flex gap-2">
                  <Input
                    placeholder="+44 7700 900123"
                    value={testPhoneNumber}
                    onChange={(e) => setTestPhoneNumber(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendTest}
                    disabled={!testPhoneNumber || sendTestSms.isPending}
                  >
                    {sendTestSms.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Send'
                    )}
                  </Button>
                </div>
              </div>

              {/* Disconnect */}
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => setShowDisconnectWarning(true)}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect SMS
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Warning */}
      <AlertDialog open={showDisconnectWarning} onOpenChange={setShowDisconnectWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-red-600" />
              Disconnect SMS?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will release your phone number and disable all SMS notifications.
              Customers will no longer receive SMS for bookings, reminders, and alerts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-red-600 hover:bg-red-700"
            >
              Yes, Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TwilioSmsSettings;
