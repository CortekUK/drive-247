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
  Shield,
  Megaphone,
  RefreshCw,
  Clock,
  XCircle,
  ArrowRight,
  Webhook,
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
  { code: 'US', label: 'United States (+1)', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'GB', label: 'United Kingdom (+44)', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'CA', label: 'Canada (+1)', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'AU', label: 'Australia (+61)', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'DE', label: 'Germany (+49)', flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'FR', label: 'France (+33)', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'ES', label: 'Spain (+34)', flag: '\u{1F1EA}\u{1F1F8}' },
  { code: 'IT', label: 'Italy (+39)', flag: '\u{1F1EE}\u{1F1F9}' },
  { code: 'NL', label: 'Netherlands (+31)', flag: '\u{1F1F3}\u{1F1F1}' },
  { code: 'IE', label: 'Ireland (+353)', flag: '\u{1F1EE}\u{1F1EA}' },
  { code: 'SE', label: 'Sweden (+46)', flag: '\u{1F1F8}\u{1F1EA}' },
  { code: 'NO', label: 'Norway (+47)', flag: '\u{1F1F3}\u{1F1F4}' },
  { code: 'DK', label: 'Denmark (+45)', flag: '\u{1F1E9}\u{1F1F0}' },
  { code: 'PL', label: 'Poland (+48)', flag: '\u{1F1F5}\u{1F1F1}' },
  { code: 'BE', label: 'Belgium (+32)', flag: '\u{1F1E7}\u{1F1EA}' },
  { code: 'AT', label: 'Austria (+43)', flag: '\u{1F1E6}\u{1F1F9}' },
  { code: 'CH', label: 'Switzerland (+41)', flag: '\u{1F1E8}\u{1F1ED}' },
  { code: 'PT', label: 'Portugal (+351)', flag: '\u{1F1F5}\u{1F1F9}' },
  { code: 'NZ', label: 'New Zealand (+64)', flag: '\u{1F1F3}\u{1F1FF}' },
  { code: 'ZA', label: 'South Africa (+27)', flag: '\u{1F1FF}\u{1F1E6}' },
  { code: 'AE', label: 'UAE (+971)', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'IN', label: 'India (+91)', flag: '\u{1F1EE}\u{1F1F3}' },
];

// Countries that require 10DLC registration (US A2P messaging)
const TEN_DLC_COUNTRIES = ['US', 'CA'];

const COUNTRY_CODE_TO_PREFIX: Record<string, string> = {
  US: '+1', CA: '+1', GB: '+44', AU: '+61', DE: '+49', FR: '+33',
  ES: '+34', IT: '+39', NL: '+31', IE: '+353', SE: '+46', NO: '+47',
  DK: '+45', PL: '+48', BE: '+32', AT: '+43', CH: '+41', PT: '+351',
  NZ: '+64', ZA: '+27', AE: '+971', IN: '+91',
};

/** Detect country code from E.164 phone number */
function detectCountryFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\s/g, '');
  // Check longest prefixes first to avoid +1 matching before +44 etc.
  const sorted = Object.entries(COUNTRY_CODE_TO_PREFIX).sort((a, b) => b[1].length - a[1].length);
  for (const [code, prefix] of sorted) {
    if (cleaned.startsWith(prefix)) {
      // +1 is shared between US and CA — default to US
      if (prefix === '+1') return 'US';
      return code;
    }
  }
  return null;
}

/** Check if a country requires 10DLC registration */
function requires10DLC(countryCode: string | null): boolean {
  if (!countryCode) return false;
  return TEN_DLC_COUNTRIES.includes(countryCode);
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">Not Started</Badge>;
  switch (status) {
    case 'approved':
      return <Badge className="bg-green-600 hover:bg-green-700">Approved</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-200">Pending Review</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function StepIndicator({ step, label, status, isActive }: { step: number; label: string; status: 'complete' | 'active' | 'pending' | 'failed'; isActive?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
        status === 'complete' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
        status === 'active' ? 'bg-primary/10 text-primary ring-2 ring-primary/20' :
        status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
        'bg-muted text-muted-foreground'
      }`}>
        {status === 'complete' ? <CheckCircle2 className="h-4 w-4" /> :
         status === 'failed' ? <XCircle className="h-4 w-4" /> :
         step}
      </div>
      <span className={`text-sm font-medium ${
        status === 'complete' ? 'text-green-700 dark:text-green-400' :
        status === 'active' ? 'text-foreground' :
        status === 'failed' ? 'text-red-700 dark:text-red-400' :
        'text-muted-foreground'
      }`}>
        {label}
      </span>
    </div>
  );
}

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
    registerBrand,
    createMessagingService,
    registerCampaign,
    refreshRegistrationStatus,
    configureWebhooks,
  } = useTwilioSms();

  // UI state
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);
  const [numberMode, setNumberMode] = useState<'search' | 'own' | null>(null);
  const [countryCode, setCountryCode] = useState('GB');
  const [searchContains, setSearchContains] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [ownNumber, setOwnNumber] = useState('');
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [testMessage, setTestMessage] = useState('');
  // Brand registration
  const [brandName, setBrandName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [website, setWebsite] = useState('');

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
    await sendTestSms.mutateAsync({ to: testPhoneNumber, message: testMessage || undefined });
  };

  const handleDisconnect = async () => {
    await disconnect.mutateAsync();
    setShowDisconnectWarning(false);
    setNumberMode(null);
    setAvailableNumbers([]);
  };

  const handleRegisterBrand = async () => {
    if (!brandName) return;
    await registerBrand.mutateAsync({ brandName, taxId, website });
  };

  const handleCreateMessagingService = async () => {
    await createMessagingService.mutateAsync();
  };

  const handleRegisterCampaign = async () => {
    await registerCampaign.mutateAsync();
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
  const hasBrand = !!status?.brandSid;
  const brandApproved = status?.brandStatus === 'approved';
  const hasCampaign = !!status?.campaignSid;
  const campaignApproved = status?.campaignStatus === 'approved';
  const hasMessagingService = !!status?.messagingServiceSid;

  // Detect country from the assigned phone number
  // Before a number is assigned, we don't know the country yet — show minimal steps
  const phoneCountry = detectCountryFromPhone(status?.phoneNumber ?? null);
  const needs10DLC = hasPhoneNumber ? requires10DLC(phoneCountry) : false;

  // Build dynamic steps based on country
  const steps = [
    { key: 'subaccount', label: 'Create Messaging Account' },
    { key: 'phone', label: 'Add Phone Number' },
    ...(needs10DLC ? [
      { key: 'brand', label: 'Register Business (10DLC)' },
      { key: 'campaign', label: 'Register Campaign' },
    ] : []),
    { key: 'test', label: 'Test & Go Live' },
  ];

  // Determine step status by key
  const getStepStatusByKey = (key: string): 'complete' | 'active' | 'pending' | 'failed' => {
    switch (key) {
      case 'subaccount':
        return hasSubaccount ? 'complete' : 'active';
      case 'phone':
        if (!hasSubaccount) return 'pending';
        return hasPhoneNumber ? 'complete' : 'active';
      case 'brand':
        if (!hasPhoneNumber) return 'pending';
        if (status?.brandStatus === 'failed') return 'failed';
        return brandApproved ? 'complete' : 'active';
      case 'campaign':
        if (!brandApproved) return 'pending';
        if (status?.campaignStatus === 'failed') return 'failed';
        return campaignApproved ? 'complete' : 'active';
      case 'test':
        if (!hasPhoneNumber) return 'pending';
        if (needs10DLC) return campaignApproved ? 'complete' : 'pending';
        return isConfigured ? 'complete' : 'active';
      default:
        return 'pending';
    }
  };

  // For non-10DLC countries, SMS is fully active once phone number is configured
  const isFullyActive = needs10DLC ? (isConfigured && campaignApproved) : isConfigured;
  const isRegistrationPending = needs10DLC && isConfigured && !campaignApproved;

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            SMS & Messaging Setup
          </CardTitle>
          <CardDescription>
            Configure SMS messaging to communicate with your customers directly. Send booking confirmations, reminders, and support messages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Setup Progress */}
          <div className="space-y-3 mb-6">
            {steps.map((s, i) => (
              <StepIndicator key={s.key} step={i + 1} label={s.label} status={getStepStatusByKey(s.key)} />
            ))}
          </div>

          {/* Status Banner */}
          <div className={`p-4 rounded-lg border ${
            isFullyActive
              ? 'bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800'
              : isRegistrationPending
              ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800'
              : 'bg-muted/50 border-border'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                isFullyActive
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30'
                  : isRegistrationPending
                  ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {isFullyActive ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : isRegistrationPending ? (
                  <Clock className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
              </div>
              <div>
                <h4 className="font-medium">
                  {isFullyActive
                    ? 'SMS Fully Active'
                    : isRegistrationPending
                    ? 'SMS Active (Registration Pending)'
                    : hasSubaccount
                    ? 'Account Created — Continue Setup'
                    : 'Not Connected'}
                </h4>
                <p className="text-sm mt-1 text-muted-foreground">
                  {isFullyActive
                    ? `Sending SMS from ${status?.phoneNumber}.${needs10DLC ? ' Full 10DLC compliance active.' : ''}`
                    : isRegistrationPending
                    ? `SMS is active from ${status?.phoneNumber}. Complete 10DLC registration for best deliverability.`
                    : hasSubaccount
                    ? 'Your messaging account is ready. Complete the remaining steps.'
                    : 'Set up your SMS account to send messages to customers.'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Create Subaccount */}
      {!hasSubaccount && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</div>
              Create Messaging Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => createSubaccount.mutate()}
              disabled={createSubaccount.isPending}
              className="w-full"
            >
              {createSubaccount.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating Account...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" />Set Up SMS</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Add Phone Number */}
      {hasSubaccount && !hasPhoneNumber && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">2</div>
              Add Phone Number
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!numberMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setNumberMode('search')} className="h-auto py-4 flex flex-col items-center gap-2">
                  <Search className="h-5 w-5" />
                  <span className="font-medium">Get a Number</span>
                  <span className="text-xs text-muted-foreground">Purchase a new phone number</span>
                </Button>
                <Button variant="outline" onClick={() => setNumberMode('own')} className="h-auto py-4 flex flex-col items-center gap-2">
                  <Phone className="h-5 w-5" />
                  <span className="font-medium">Use My Own Number</span>
                  <span className="text-xs text-muted-foreground">Add an existing Twilio number</span>
                </Button>
              </div>
            )}

            {numberMode === 'search' && (
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Search Available Numbers</h4>
                  <Button variant="ghost" size="sm" onClick={() => { setNumberMode(null); setAvailableNumbers([]); }}>Cancel</Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Select value={countryCode} onValueChange={setCountryCode}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COUNTRY_OPTIONS.map(c => (
                          <SelectItem key={c.code} value={c.code}>{c.flag} {c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Contains (optional)</Label>
                    <Input placeholder="e.g. 555" value={searchContains} onChange={(e) => setSearchContains(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleSearchNumbers} disabled={searchNumbers.isPending} className="w-full">
                      {searchNumbers.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                      Search
                    </Button>
                  </div>
                </div>
                {availableNumbers.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableNumbers.map((num) => (
                      <div key={num.phoneNumber} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                        <div>
                          <p className="font-mono font-medium">{num.phoneNumber}</p>
                          <p className="text-xs text-muted-foreground">{[num.locality, num.region].filter(Boolean).join(', ')}</p>
                        </div>
                        <Button size="sm" onClick={() => handlePurchaseNumber(num.phoneNumber)} disabled={purchaseNumber.isPending}>
                          {purchaseNumber.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Select'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {numberMode === 'own' && (
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Add Your Own Number</h4>
                  <Button variant="ghost" size="sm" onClick={() => setNumberMode(null)}>Cancel</Button>
                </div>
                <div className="space-y-2">
                  <Label>Phone Number (E.164 format)</Label>
                  <Input placeholder="+44 7911 123456" value={ownNumber} onChange={(e) => setOwnNumber(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Enter your Twilio number with country code (e.g. +44 for UK, +1 for US).</p>
                </div>
                <Button onClick={handleAssignOwn} disabled={!ownNumber || assignOwnNumber.isPending}>
                  {assignOwnNumber.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Assigning...</> : <><Phone className="mr-2 h-4 w-4" />Assign Number</>}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Brand Registration (10DLC) — US/CA only */}
      {hasPhoneNumber && needs10DLC && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                brandApproved ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'
              }`}>
                {brandApproved ? <CheckCircle2 className="h-4 w-4" /> : '3'}
              </div>
              Business Registration (10DLC)
              <StatusBadge status={status?.brandStatus || null} />
            </CardTitle>
            <CardDescription>
              US carriers require business verification to send SMS. This typically takes 1-7 business days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasBrand && (
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="space-y-2">
                  <Label>Business Name *</Label>
                  <Input placeholder="Your company name" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>EIN / Tax ID</Label>
                    <Input placeholder="XX-XXXXXXX" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input placeholder="https://yourcompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
                </div>
                <Button onClick={handleRegisterBrand} disabled={!brandName || registerBrand.isPending}>
                  {registerBrand.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</> : <><Shield className="mr-2 h-4 w-4" />Register Business</>}
                </Button>
              </div>
            )}

            {hasBrand && status?.brandStatus === 'pending' && (
              <div className="flex items-center justify-between p-4 border rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-sm">Brand registration is under review</p>
                    <p className="text-xs text-muted-foreground">This usually takes 1-7 business days.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => refreshRegistrationStatus.mutate()} disabled={refreshRegistrationStatus.isPending}>
                  {refreshRegistrationStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {hasBrand && status?.brandStatus === 'failed' && (
              <div className="p-4 border border-red-200 rounded-lg bg-red-50/50 dark:bg-red-900/10">
                <div className="flex items-center gap-2 text-red-700 mb-2">
                  <XCircle className="h-5 w-5" />
                  <p className="font-medium text-sm">Brand registration failed</p>
                </div>
                <p className="text-xs text-muted-foreground">Please check your business details and try again, or contact support.</p>
              </div>
            )}

            {brandApproved && (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Business verified</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Campaign Registration — US/CA only */}
      {brandApproved && needs10DLC && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                campaignApproved ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'
              }`}>
                {campaignApproved ? <CheckCircle2 className="h-4 w-4" /> : '4'}
              </div>
              Campaign Registration
              <StatusBadge status={status?.campaignStatus || null} />
            </CardTitle>
            <CardDescription>
              Register your messaging use case with carriers. We pre-fill this for car rental customer communications.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasMessagingService && (
              <Button onClick={handleCreateMessagingService} disabled={createMessagingService.isPending}>
                {createMessagingService.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : <><Megaphone className="mr-2 h-4 w-4" />Create Messaging Service</>}
              </Button>
            )}

            {hasMessagingService && !hasCampaign && (
              <Button onClick={handleRegisterCampaign} disabled={registerCampaign.isPending}>
                {registerCampaign.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</> : <><Megaphone className="mr-2 h-4 w-4" />Register Campaign</>}
              </Button>
            )}

            {hasCampaign && status?.campaignStatus === 'pending' && (
              <div className="flex items-center justify-between p-4 border rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-sm">Campaign registration is under review</p>
                    <p className="text-xs text-muted-foreground">Carrier review typically takes 1-5 business days.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => refreshRegistrationStatus.mutate()} disabled={refreshRegistrationStatus.isPending}>
                  {refreshRegistrationStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {campaignApproved && (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Campaign approved — full SMS deliverability active</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 5: Configured — Test & Manage */}
      {isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xs font-bold text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              SMS Active
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Phone number display + capabilities */}
            <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">SMS Number</p>
                  <p className="text-lg font-mono font-bold">{status?.phoneNumber}</p>
                </div>
              </div>

              {/* Number capabilities */}
              {status?.capabilities && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { key: 'sms' as const, label: 'SMS', icon: <MessageSquare className="h-3 w-3" /> },
                    { key: 'voice' as const, label: 'Voice', icon: <Phone className="h-3 w-3" /> },
                    { key: 'mms' as const, label: 'MMS', icon: <MessageSquare className="h-3 w-3" /> },
                    { key: 'fax' as const, label: 'Fax', icon: <MessageSquare className="h-3 w-3" /> },
                  ].map(cap => (
                    <span
                      key={cap.key}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
                        status.capabilities![cap.key]
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-red-50 text-red-400 line-through dark:bg-red-900/10 dark:text-red-400/60'
                      }`}
                    >
                      {cap.icon}
                      {cap.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Test SMS */}
            <div className="p-4 rounded-lg border space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <Send className="h-4 w-4" />
                Send Test SMS
              </h4>
              <div className="space-y-2">
                <Input
                  placeholder="Enter phone number with country code"
                  value={testPhoneNumber}
                  onChange={(e) => setTestPhoneNumber(e.target.value)}
                />
                <textarea
                  placeholder="Enter your message (optional — a default test message will be sent if left empty)"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>
              <Button onClick={handleSendTest} disabled={!testPhoneNumber || sendTestSms.isPending} className="w-full">
                {sendTestSms.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</> : <><Send className="mr-2 h-4 w-4" />Send Test SMS</>}
              </Button>
            </div>

            {/* Configure Webhooks */}
            <Button variant="outline" onClick={() => configureWebhooks.mutate()} disabled={configureWebhooks.isPending} className="w-full">
              {configureWebhooks.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Webhook className="mr-2 h-4 w-4" />}
              Reconfigure Webhooks
            </Button>

            {/* Disconnect */}
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
              onClick={() => setShowDisconnectWarning(true)}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Disconnect SMS
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Disconnect Warning */}
      <AlertDialog open={showDisconnectWarning} onOpenChange={setShowDisconnectWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-red-600" />
              Disconnect SMS?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will release your phone number and disable all SMS messaging.
              Customers will no longer receive SMS notifications, and you won't be able to send or receive SMS in the Messages page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} className="bg-red-600 hover:bg-red-700">
              Yes, Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TwilioSmsSettings;
