'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  FileText,
  Building2,
  ScrollText,
  User,
  Banknote,
  Shield,
  ClipboardCheck,
  ShieldAlert,
  PenLine,
  Loader2,
  Download,
  FileDown,
  ImageDown,
  Sparkles,
  AlertTriangle,
  KeyRound,
  History,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  GraduationCap,
} from 'lucide-react';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { Label } from '@/components/ui/label';

interface FileRef {
  url: string;
  path: string;
  name: string;
  size: number;
}

export interface Submission {
  id: string;
  tenant_id: string;
  submitted_by: string | null;
  business_trade_name: string;
  business_legal_name: string;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string;
  primary_contact_phone: string | null;
  ein: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  data: Record<string, any>;
  file_urls: Record<string, FileRef[]>;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  // Streamline additions
  quiz_score: number | null;
  quiz_total: number | null;
  quiz_passed: boolean | null;
  training_completed_at: string | null;
  ai_summary: string | null;
  ai_recommendation: 'approve' | 'disapprove' | 'uncertain' | null;
  ai_confidence: number | null;
  ai_reasons: string[] | null;
  ai_red_flags: string[] | null;
  ai_generated_at: string | null;
  partner_message: string | null;
  reject_reason: string | null;
  activated_at: string | null;
  tenant_name?: string;
  tenant_slug?: string;
}

export interface SubmissionEvent {
  id: string;
  submission_id: string;
  actor_type: 'customer' | 'partner' | 'system';
  event_type: string;
  note: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const statusBadgeClass: Record<Submission['status'], string> = {
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-destructive',
};

const statusLabel: Record<Submission['status'], string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const statusIcon: Record<Submission['status'], React.ElementType> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

// Static class maps (Tailwind JIT can't see dynamically-built class strings).
const STAT_CARDS = [
  {
    key: 'pending' as const,
    icon: Clock,
    label: 'Pending review',
    iconWrap: 'bg-warning/12 text-warning',
    active: 'border-warning/50 ring-1 ring-warning/30 bg-warning/[0.04]',
  },
  {
    key: 'approved' as const,
    icon: CheckCircle2,
    label: 'Approved & live',
    iconWrap: 'bg-success/12 text-success',
    active: 'border-success/50 ring-1 ring-success/30 bg-success/[0.04]',
  },
  {
    key: 'rejected' as const,
    icon: XCircle,
    label: 'Sent back',
    iconWrap: 'bg-destructive/12 text-destructive',
    active: 'border-destructive/50 ring-1 ring-destructive/30 bg-destructive/[0.04]',
  },
];

const statusPill: Record<Submission['status'], string> = {
  pending: 'text-warning bg-warning/10 border-warning/25',
  approved: 'text-success bg-success/10 border-success/25',
  rejected: 'text-destructive bg-destructive/10 border-destructive/25',
};

// Compact AI recommendation chip for the table column.
const aiCompact: Record<
  NonNullable<Submission['ai_recommendation']>,
  { label: string; cls: string; icon: React.ElementType }
> = {
  approve: { label: 'Approve', cls: 'text-success bg-success/10 border-success/25', icon: ThumbsUp },
  disapprove: { label: 'Disapprove', cls: 'text-destructive bg-destructive/10 border-destructive/25', icon: ThumbsDown },
  uncertain: { label: 'Review', cls: 'text-warning bg-warning/10 border-warning/25', icon: HelpCircle },
};

export default function BonzahQueue() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Submission | null>(null);
  const [rowAction, setRowAction] = useState<{ id: string; kind: 'pdf' | 'zip' } | null>(null);

  const handleDownloadPdf = async (e: React.MouseEvent, s: Submission) => {
    e.stopPropagation();
    setRowAction({ id: s.id, kind: 'pdf' });
    try {
      await generateSubmissionPdf(s);
      toast.success('PDF downloaded');
    } catch (err: any) {
      toast.error(`PDF failed: ${err.message || err}`);
    } finally {
      setRowAction(null);
    }
  };

  const handleDownloadZip = async (e: React.MouseEvent, s: Submission) => {
    e.stopPropagation();
    setRowAction({ id: s.id, kind: 'zip' });
    try {
      const n = await generateImagesZip(s);
      toast.success(`Downloaded ${n} image${n === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error(`ZIP failed: ${err.message || err}`);
    } finally {
      setRowAction(null);
    }
  };

  const loadSubmissions = async () => {
    try {
      // Bonzah partners are scoped to Bonzah data only — we deliberately do NOT
      // join the tenants table here. The operator's business name from the
      // submission is shown instead.
      const { data, error } = await supabase
        .from('bonzah_onboarding_submissions')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      const mapped = (data || []).map((r: any) => ({
        ...r,
        tenant_name: r.business_legal_name || r.business_trade_name || 'Operator',
        tenant_slug: undefined,
      }));
      setSubmissions(mapped);
    } catch (err: any) {
      toast.error('Failed to load submissions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSubmissions();

    // Realtime subscription for new submissions
    const channel = supabase
      .channel('bonzah-onboarding-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bonzah_onboarding_submissions' },
        () => {
          void loadSubmissions();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.business_trade_name?.toLowerCase().includes(q) ||
        s.business_legal_name?.toLowerCase().includes(q) ||
        s.primary_contact_email?.toLowerCase().includes(q) ||
        s.tenant_name?.toLowerCase().includes(q) ||
        s.ein?.toLowerCase().includes(q)
      );
    });
  }, [submissions, filter, searchQuery]);

  const counts = useMemo(
    () => ({
      pending: submissions.filter((s) => s.status === 'pending').length,
      approved: submissions.filter((s) => s.status === 'approved').length,
      rejected: submissions.filter((s) => s.status === 'rejected').length,
    }),
    [submissions],
  );

  return (
    <div className="space-y-6">
      {/* Stat cards (clickable filters) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STAT_CARDS.map(({ key, icon: Icon, label, iconWrap, active }) => {
          const count = counts[key];
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(isActive ? 'all' : key)}
              className={cn(
                'text-left rounded-xl border border-border bg-card p-5 transition-all card-elev hover:border-primary/30',
                isActive && active,
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-foreground">
                    {count}
                  </p>
                </div>
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconWrap)}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Submissions table */}
      <div className="rounded-xl border border-border bg-card card-elev overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by business, contact, or EIN…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition-all',
                  filter === status
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-primary/30',
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-3">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-semibold text-foreground">No submissions found</p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === 'all'
                ? 'Operators appear here once they submit their Bonzah application.'
                : `No ${filter} submissions match your filters.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm border-collapse">
              <thead>
                <tr className="bg-secondary/70 text-left">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">Operator</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">Contact</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">Submitted</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">
                    <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> Drive247 AI</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">Status</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((s) => {
                  const StatusIcon = statusIcon[s.status];
                  const ai = s.ai_recommendation ? aiCompact[s.ai_recommendation] : null;
                  const AiIcon = ai?.icon;
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-border cursor-pointer hover:bg-secondary/40 transition-colors"
                      onClick={() => setSelected(s)}
                    >
                      <td className="px-5 py-3.5 align-top">
                        <div
                          className="font-semibold text-foreground leading-tight truncate max-w-[240px]"
                          title={s.business_trade_name}
                        >
                          {s.business_trade_name}
                        </div>
                        <div
                          className="text-xs text-muted-foreground mt-0.5 truncate max-w-[240px]"
                          title={`${s.business_legal_name}${s.ein ? ` · EIN ${s.ein}` : ''}`}
                        >
                          {s.business_legal_name}
                          {s.ein && <span className="ml-1.5">· EIN {s.ein}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <div
                          className="text-[13px] text-foreground truncate max-w-[190px]"
                          title={`${s.primary_contact_first_name ?? ''} ${s.primary_contact_last_name ?? ''}`.trim()}
                        >
                          {s.primary_contact_first_name} {s.primary_contact_last_name}
                        </div>
                        <div
                          className="text-xs text-muted-foreground truncate max-w-[190px] lowercase"
                          title={s.primary_contact_email}
                        >
                          {s.primary_contact_email}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(s.submitted_at)}
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        {ai && AiIcon ? (
                          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap', ai.cls)}>
                            <AiIcon className="h-3 w-3" />
                            {ai.label}
                            {s.ai_confidence != null && (
                              <span className="opacity-70"> · {Math.round(s.ai_confidence * 100)}%</span>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Sparkles className="h-3 w-3" /> on open
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap', statusPill[s.status])}>
                          <StatusIcon className="h-3 w-3 shrink-0" />
                          {statusLabel[s.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 align-top text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Download structured PDF" onClick={(e) => handleDownloadPdf(e, s)} disabled={rowAction?.id === s.id}>
                            {rowAction?.id === s.id && rowAction.kind === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Download images as ZIP" onClick={(e) => handleDownloadZip(e, s)} disabled={rowAction?.id === s.id}>
                            {rowAction?.id === s.id && rowAction.kind === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" className="ml-1" onClick={(e) => { e.stopPropagation(); setSelected(s); }}>
                            Review
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SubmissionDetailDialog
        submission={selected}
        onClose={() => setSelected(null)}
        onUpdated={loadSubmissions}
      />
    </div>
  );
}

// ── Export helpers ───────────────────────────────────────────────────────────

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

const isImageFile = (f: FileRef) =>
  IMAGE_EXT_RE.test(f.name || '') || IMAGE_EXT_RE.test(f.path || '');

const safeFilename = (s: string) =>
  s.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'file';

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function imageFormatFromDataUrl(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  const m = dataUrl.match(/^data:image\/([a-z0-9+.-]+);/i);
  const t = (m?.[1] || '').toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return 'JPEG';
  if (t.includes('webp')) return 'WEBP';
  return 'PNG';
}

async function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

type Section = {
  key: string;
  title: string;
  entries: [string, any][];
  longText?: { title: string; value?: string }[];
  fileBlocks?: { title: string; files?: FileRef[] }[];
};

function buildSections(submission: Submission): Section[] {
  const data = submission.data || {};
  const files = submission.file_urls || {};
  return [
    {
      key: 'business',
      title: 'Business',
      entries: [
        ['Trade Name', data.business_trade_name],
        ['Legal Name', data.business_legal_name],
        ['Business Address', data.business_address],
        ['City / State', `${data.city || ''} ${data.state || ''}`.trim()],
        ['Country / Postal', `${data.country || ''} ${data.postal_code || ''}`.trim()],
        ['Business Phone', data.business_phone],
        ['Alt. Phone', data.alternative_business_phone],
        ['EIN / Tax ID', data.ein],
        ['Company Type', data.company_type],
        ['Start Date', data.business_start_date],
        ['Website', data.company_website],
      ],
      fileBlocks: [{ title: 'Business Logo', files: files.business_logo }],
    },
    {
      key: 'operations',
      title: 'Operations',
      entries: [
        ['States Served', data.states_where_you_do_business],
        ['Licensed Everywhere', data.licensed_in_all_locations],
        ['Adheres to Auto Licensing', data.adhering_to_license_requirements],
        ['Years in Auto Rental', data.years_in_private_auto_rental],
        ['Years on Turo', data.years_on_turo],
      ],
      longText: [{ title: 'Business Owners', value: data.business_owners }],
    },
    {
      key: 'contacts',
      title: 'Contacts',
      entries: [
        ['Primary Name', `${data.primary_first_name || ''} ${data.primary_last_name || ''}`.trim()],
        ['Primary Email', data.primary_email],
        ['Primary Phone', data.primary_phone],
        ['Primary DOB', data.primary_date_of_birth],
        ['Primary Years Driving', data.primary_years_driving],
        ['Primary Marital Status', data.primary_marital_status],
        ...((Array.isArray(data.additional_users) ? data.additional_users : []).flatMap(
          (u: any, i: number): [string, any][] => [
            [`Additional #${i + 1} — Name`, u.full_name],
            [`Additional #${i + 1} — Email`, u.email],
            [`Additional #${i + 1} — Phone`, u.phone],
            [`Additional #${i + 1} — DOB`, u.date_of_birth],
            [`Additional #${i + 1} — Years Driving`, u.years_driving],
            [`Additional #${i + 1} — Marital Status`, u.marital_status],
          ],
        ) as [string, any][]),
      ],
      fileBlocks: [
        { title: "Driver's Licenses", files: files.driver_licenses },
        { title: 'Additional Users Spreadsheet', files: files.additional_users_spreadsheet },
      ],
    },
    {
      key: 'banking',
      title: 'Banking',
      entries: [
        ['Account Holder', data.bank_account_name],
        ['Account Type', data.bank_account_type],
        ['Bank', data.bank_name],
        ['Routing #', data.routing_number],
        ['Account #', data.account_number],
        ['Bank Address', data.bank_account_address],
        ['Card Number', data.credit_card_number],
        ['Card Expiry', data.card_expiration_date],
        ['Card CVC', data.card_security_code],
        ['Name on Card', data.card_name],
        ['Card Billing Address', data.card_billing_address],
        ['Starting Balance', data.desired_starting_balance],
        ['RMS', data.rental_management_system],
        ['Embed Bonzah on Site', data.explore_embedding_bonzah],
      ],
    },
    {
      key: 'insurance',
      title: 'Insurance',
      entries: [
        ['Current Carrier', data.current_insurance_carrier],
        ['Rental Agreement Timestamp', data.rental_agreement_has_timestamp],
        ['Vehicles Have GPS', data.vehicles_have_gps],
        ['GPS Brand', data.gps_brand],
        ['Vehicles in Company Name', data.vehicles_registered_in_company_name],
        ['Salvage Vehicles', data.any_vehicles_salvage],
        ['For Hire / TNC', data.rent_for_hire],
        ['Used Outside Rentals', data.vehicles_used_outside_rentals],
        ['Had Commercial Auto Losses', data.had_commercial_auto_losses],
        ['Has Loss Summary', data.has_loss_summary],
      ],
      longText: [{ title: 'What can we help you with?', value: data.what_can_we_help_with }],
      fileBlocks: [
        { title: 'Fleet Insurance Policy', files: files.fleet_insurance_policy },
        { title: 'Rental Agreement', files: files.rental_agreement_file },
        { title: 'Loss Runs', files: files.loss_runs_file },
        { title: 'Vehicle Schedule', files: files.vehicle_schedule_file },
        { title: 'Loss History', files: files.loss_history_file },
      ],
    },
    {
      key: 'policies',
      title: 'Policies',
      entries: [
        ['Drivers Need Valid License', data.require_drivers_valid_license],
        ['Check Employee Driving Records', data.check_employee_driving_records],
        ['Storage Security', data.vehicle_storage_security],
        ['Delivers / Picks Up', data.deliver_or_pickup],
        ['Min Age Renters', data.minimum_age_renters],
        ['Rents > 30 Days', data.rent_more_than_30_days],
        ['Avg Rental Duration', data.average_rental_duration],
        ['Photocopy Driver IDs', data.photocopy_driver_ids],
        ['Require Renter Insurance', data.require_renters_primary_insurance],
        ['Verify Renter Insurance', data.verify_renter_insurance],
        ['% Renters w/ Insurance', data.pct_renters_with_insurance],
        ['Retain Insurance Proof', data.retain_renter_insurance_proof],
      ],
      longText: [
        { title: 'Renter Screening Process', value: data.renter_screening_process },
        { title: 'Stolen / Converted Vehicle', value: data.renter_stolen_vehicle },
        { title: 'Payment Methods', value: data.payment_methods },
        { title: 'Cash / App + Card on File', value: data.cash_app_card_on_file },
        { title: 'OTC Insurance Products', value: data.offers_otc_insurance },
        { title: 'Maintenance Program', value: data.vehicle_maintenance_program },
        { title: 'Inspection Process', value: data.inspect_vehicles },
        { title: 'Other Businesses', value: data.own_other_businesses },
        { title: 'What Else?', value: data.what_else_should_we_know },
      ],
      fileBlocks: [{ title: 'Additional Information', files: files.additional_information_file }],
    },
    {
      key: 'underwriting',
      title: 'Underwriting',
      entries: [
        ['Accidents/Claims (3 yrs)', data.uw_accidents_past_3_years],
        ['Canceled Policy', data.uw_canceled_policy],
        ['Insurance Fraud Conviction', data.uw_insurance_fraud],
        ['DUI / Reckless / Multiple Violations', data.uw_dui_violations],
        ['Invalid License Drivers', data.uw_invalid_license_drivers],
        ['Salvage Title', data.uw_salvage_title],
        ['Performance Modified', data.uw_modified_for_performance],
        ['Used for Other Purposes', data.uw_other_use],
      ],
    },
    {
      key: 'signature',
      title: 'Signature',
      entries: [
        ['Confirms Accuracy', data.declare_complete_accurate ? 'Yes' : '—'],
        ['Confirms Authorization', data.declare_authorized ? 'Yes' : '—'],
        ['Authorizes Bonzah', data.declare_authorize_bonzah ? 'Yes' : '—'],
        ['Agrees to User Agreement', data.agree_user_agreement ? 'Yes' : '—'],
      ],
    },
  ];
}

export async function generateSubmissionPdf(submission: Submission) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 50;
  const marginBottom = 40;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  };

  const drawText = (
    text: string,
    opts: { size?: number; style?: 'normal' | 'bold'; color?: [number, number, number]; indent?: number } = {},
  ) => {
    const { size = 10, style = 'normal', color = [40, 40, 50], indent = 0 } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, marginX + indent, y);
      y += size + 4;
    }
  };

  const drawDivider = () => {
    ensureSpace(10);
    doc.setDrawColor(220, 220, 230);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 10;
  };

  const drawSectionHeader = (title: string) => {
    ensureSpace(36);
    doc.setFillColor(238, 242, 255);
    doc.rect(marginX, y - 4, contentWidth, 26, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(63, 63, 130);
    doc.text(title.toUpperCase(), marginX + 10, y + 13);
    y += 32;
  };

  const drawKeyValue = (label: string, value: string) => {
    const labelWidth = 200;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 115);
    const labelLines = doc.splitTextToSize(label, labelWidth - 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 40);
    const valueLines = doc.splitTextToSize(value || '—', contentWidth - labelWidth - 8);

    const rowHeight = Math.max(labelLines.length, valueLines.length) * 13 + 4;
    ensureSpace(rowHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 115);
    doc.text(labelLines, marginX, y + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 40);
    doc.text(valueLines, marginX + labelWidth, y + 9);

    y += rowHeight;
    doc.setDrawColor(240, 240, 245);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 4;
  };

  const drawLongText = (title: string, value: string) => {
    ensureSpace(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 115);
    doc.text(title.toUpperCase(), marginX, y + 4);
    y += 14;
    drawText(value, { size: 10, color: [40, 40, 50] });
    y += 6;
  };

  const drawImageFromDataUrl = async (dataUrl: string, captionAbove?: string, maxHeight = 280) => {
    try {
      const { w, h } = await loadImageSize(dataUrl);
      const ratio = w / h;
      let drawW = contentWidth;
      let drawH = drawW / ratio;
      if (drawH > maxHeight) {
        drawH = maxHeight;
        drawW = drawH * ratio;
      }
      const headerH = captionAbove ? 16 : 0;
      ensureSpace(drawH + headerH + 10);
      if (captionAbove) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 115);
        doc.text(captionAbove.toUpperCase(), marginX, y + 4);
        y += headerH;
      }
      const format = imageFormatFromDataUrl(dataUrl);
      doc.addImage(dataUrl, format, marginX, y, drawW, drawH, undefined, 'FAST');
      y += drawH + 10;
    } catch {
      drawText(`[Could not render image: ${captionAbove || ''}]`, { size: 9, color: [180, 60, 60] });
    }
  };

  // Header / cover
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 70, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('Bonzah Onboarding Submission', marginX, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 220);
  doc.text(submission.business_trade_name || '—', marginX, 52);
  y = 90;

  drawKeyValue('Legal Name', submission.business_legal_name || '—');
  drawKeyValue('Status', statusLabel[submission.status]);
  drawKeyValue('Submitted', formatDate(submission.submitted_at));
  if (submission.reviewed_at) drawKeyValue('Reviewed', formatDate(submission.reviewed_at));
  if (submission.tenant_name) drawKeyValue('Tenant', submission.tenant_name);
  if (submission.admin_note) drawKeyValue('Admin Note', submission.admin_note);
  y += 6;
  drawDivider();

  const sections = buildSections(submission);
  for (const section of sections) {
    drawSectionHeader(section.title);
    for (const [label, value] of section.entries) {
      const display =
        value === undefined || value === null || value === '' ? '—' : String(value);
      drawKeyValue(label, display);
    }
    if (section.longText) {
      for (const lt of section.longText) {
        if (lt.value) {
          y += 6;
          drawLongText(lt.title, lt.value);
        }
      }
    }
    if (section.fileBlocks) {
      for (const fb of section.fileBlocks) {
        if (!fb.files || fb.files.length === 0) continue;
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 115);
        ensureSpace(18);
        doc.text(fb.title.toUpperCase(), marginX, y + 4);
        y += 14;
        for (const f of fb.files) {
          if (isImageFile(f) && f.url) {
            try {
              const blob = await fetchAsBlob(f.url);
              const dataUrl = await blobToDataUrl(blob);
              await drawImageFromDataUrl(dataUrl, f.name);
            } catch {
              drawText(`• ${f.name} (image fetch failed — ${f.url})`, { size: 9, color: [180, 60, 60] });
            }
          } else {
            drawText(`• ${f.name} — ${formatBytes(f.size)}${f.url ? `  (${f.url})` : ''}`, { size: 9 });
          }
        }
      }
    }
    if (submission.data?.signature_data_url && section.key === 'signature') {
      y += 6;
      await drawImageFromDataUrl(submission.data.signature_data_url, 'Preparer Signature', 160);
    }
    y += 6;
  }

  const filename = `bonzah-onboarding-${safeFilename(submission.business_trade_name || submission.id)}.pdf`;
  doc.save(filename);
}

export async function generateImagesZip(submission: Submission) {
  const zip = new JSZip();
  const files = submission.file_urls || {};
  const data = submission.data || {};
  let imageCount = 0;

  for (const [sectionKey, fileList] of Object.entries(files)) {
    if (!Array.isArray(fileList)) continue;
    for (const f of fileList as FileRef[]) {
      if (!isImageFile(f) || !f.url) continue;
      try {
        const blob = await fetchAsBlob(f.url);
        zip.file(`${safeFilename(sectionKey)}/${safeFilename(f.name)}`, blob);
        imageCount++;
      } catch {
        // skip failed fetches
      }
    }
  }

  if (typeof data.signature_data_url === 'string' && data.signature_data_url.startsWith('data:image')) {
    const base64 = data.signature_data_url.split(',')[1] || '';
    if (base64) {
      const ext = imageFormatFromDataUrl(data.signature_data_url).toLowerCase();
      zip.file(`signature/signature.${ext === 'jpeg' ? 'jpg' : ext}`, base64, { base64: true });
      imageCount++;
    }
  }

  if (imageCount === 0) {
    throw new Error('No images were found in this submission.');
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bonzah-onboarding-images-${safeFilename(submission.business_trade_name || submission.id)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return imageCount;
}

// ── Detail Dialog ────────────────────────────────────────────────────────────

const sectionTabs = [
  { key: 'business', label: 'Business', icon: Building2 },
  { key: 'operations', label: 'Operations', icon: ScrollText },
  { key: 'contacts', label: 'Contacts', icon: User },
  { key: 'banking', label: 'Banking', icon: Banknote },
  { key: 'insurance', label: 'Insurance', icon: Shield },
  { key: 'policies', label: 'Policies', icon: ClipboardCheck },
  { key: 'underwriting', label: 'Underwriting', icon: ShieldAlert },
  { key: 'sign', label: 'Signature', icon: PenLine },
] as const;

function SubmissionDetailDialog({
  submission,
  onClose,
  onUpdated,
}: {
  submission: Submission | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [partnerMessage, setPartnerMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [events, setEvents] = useState<SubmissionEvent[]>([]);
  const [updating, setUpdating] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    setUsername('');
    setPassword('');
    setPartnerMessage(submission?.partner_message || '');
    setRejectReason(submission?.reject_reason || '');
    if (!submission?.id) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('bonzah_submission_events')
        .select('id, submission_id, actor_type, event_type, note, metadata, created_at')
        .eq('submission_id', submission.id)
        .order('created_at', { ascending: true });
      if (!cancelled) setEvents((data as unknown as SubmissionEvent[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [submission?.id, submission?.partner_message, submission?.reject_reason]);

  if (!submission) return null;

  // Approve/reject are wired to the bonzah-partner-review edge function.
  const ACTIVATION_ENABLED = true;

  const handleApprove = async () => {
    if (!ACTIVATION_ENABLED) return;
    if (!username.trim() || !password.trim()) {
      toast.error('Enter the Bonzah username and password to activate.');
      return;
    }
    setUpdating('approve');
    try {
      const { data, error } = await supabase.functions.invoke('bonzah-partner-review', {
        body: {
          submissionId: submission.id,
          action: 'approve',
          username: username.trim(),
          password: password.trim(),
          message: partnerMessage.trim() || null,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Approved & activated');
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleReject = async () => {
    if (!ACTIVATION_ENABLED) return;
    if (!rejectReason.trim()) {
      toast.error('Add a short reason so the operator knows what to update.');
      return;
    }
    setUpdating('reject');
    try {
      const { data, error } = await supabase.functions.invoke('bonzah-partner-review', {
        body: { submissionId: submission.id, action: 'reject', reason: rejectReason.trim() },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Sent back to operator');
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const StatusIcon = statusIcon[submission.status];

  return (
    <Dialog open={!!submission} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold truncate">
                {submission.business_trade_name}
              </div>
              <div className="text-xs text-muted-foreground font-normal">
                {submission.business_legal_name}
              </div>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border shrink-0',
                submission.status === 'pending' &&
                  'bg-warning/10 text-warning border-warning/30',
                submission.status === 'approved' &&
                  'bg-success/10 text-success border-success/30',
                submission.status === 'rejected' &&
                  'bg-destructive/10 text-destructive border-destructive/30',
              )}
            >
              <StatusIcon className="h-3 w-3" />
              {statusLabel[submission.status]}
            </span>
          </DialogTitle>
          <DialogDescription>
            Submitted {formatDate(submission.submitted_at)}
            {submission.reviewed_at && ` · Reviewed ${formatDate(submission.reviewed_at)}`}
          </DialogDescription>
        </DialogHeader>

        <AiVerdictCard submission={submission} onGenerated={onUpdated} />

        <QuizBadge submission={submission} />

        <SubmissionDetailTabs submission={submission} />

        {events.length > 0 && <EventTimeline events={events} />}

        {/* Review actions */}
        <div className="border-t pt-4 mt-4 space-y-4">
          {submission.status === 'approved' ? (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Activated{submission.activated_at ? ` · ${formatDate(submission.activated_at)}` : ''}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 flex items-center gap-1.5 text-xs">
                    <KeyRound className="h-3.5 w-3.5" /> Bonzah Username
                  </Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="operator username"
                    disabled={!ACTIVATION_ENABLED || !!updating}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 flex items-center gap-1.5 text-xs">
                    <KeyRound className="h-3.5 w-3.5" /> Bonzah Password
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="operator password"
                    disabled={!ACTIVATION_ENABLED || !!updating}
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Message to the operator (shown on approve)</Label>
                <Textarea
                  value={partnerMessage}
                  onChange={(e) => setPartnerMessage(e.target.value)}
                  rows={2}
                  placeholder="e.g. Welcome aboard — your Bonzah account is live. Reach out any time."
                  disabled={!ACTIVATION_ENABLED || !!updating}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Reason (shown to operator on send-back)</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. Please re-upload a clearer copy of the fleet insurance policy."
                  disabled={!ACTIVATION_ENABLED || !!updating}
                />
              </div>
            </>
          )}

          {!ACTIVATION_ENABLED && submission.status !== 'approved' && (
            <p className="text-xs text-muted-foreground">
              Review-only for now. Approve &amp; activate is enabled in the next release.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={!!updating}>
              Close
            </Button>
            {submission.status !== 'rejected' && submission.status !== 'approved' && (
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 border-destructive/40"
                onClick={handleReject}
                disabled={!ACTIVATION_ENABLED || !!updating}
              >
                {updating === 'reject' ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-1.5" />
                )}
                Send back
              </Button>
            )}
            {submission.status !== 'approved' && (
              <Button onClick={handleApprove} disabled={!ACTIVATION_ENABLED || !!updating}>
                {updating === 'approve' ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                )}
                Approve &amp; activate
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export function SubmissionDetailTabs({ submission }: { submission: Submission }) {
  const data = submission.data || {};
  const files = submission.file_urls || {};

  return (
        <Tabs defaultValue="business" className="mt-2">
          <TabsList className="grid grid-cols-4 lg:grid-cols-8 gap-1 h-auto p-1 mb-4">
            {sectionTabs.map(({ key, label, icon: Icon }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="flex flex-col gap-1 h-auto py-2.5 text-[11px] rounded-lg border-transparent data-[state=active]:bg-secondary data-[state=active]:border-transparent"
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="business" className="space-y-3">
            <FieldGrid
              entries={[
                ['Trade Name', data.business_trade_name],
                ['Legal Name', data.business_legal_name],
                ['Business Address', data.business_address],
                ['City / State', `${data.city || ''} ${data.state || ''}`.trim()],
                ['Country / Postal', `${data.country || ''} ${data.postal_code || ''}`.trim()],
                ['Business Phone', data.business_phone],
                ['Alt. Phone', data.alternative_business_phone],
                ['EIN / Tax ID', data.ein],
                ['Company Type', data.company_type],
                ['Start Date', data.business_start_date],
                ['Website', data.company_website],
              ]}
            />
            <FilesBlock title="Business Logo" files={files.business_logo} />
          </TabsContent>

          <TabsContent value="operations" className="space-y-3">
            <FieldGrid
              entries={[
                ['States Served', data.states_where_you_do_business],
                ['Licensed Everywhere', data.licensed_in_all_locations],
                ['Adheres to Auto Licensing', data.adhering_to_license_requirements],
                ['Years in Auto Rental', data.years_in_private_auto_rental],
                ['Years on Turo', data.years_on_turo],
              ]}
            />
            <LongText title="Business Owners" value={data.business_owners} />
          </TabsContent>

          <TabsContent value="contacts" className="space-y-3">
            <FieldGrid
              entries={[
                ['Primary Name', `${data.primary_first_name || ''} ${data.primary_last_name || ''}`.trim()],
                ['Primary Email', data.primary_email],
                ['Primary Phone', data.primary_phone],
                ['Primary DOB', data.primary_date_of_birth],
                ['Primary Years Driving', data.primary_years_driving],
                ['Primary Marital Status', data.primary_marital_status],
              ]}
            />
            {Array.isArray(data.additional_users) && data.additional_users.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Additional Drivers ({data.additional_users.length})
                </h4>
                {data.additional_users.map((u: any, i: number) => (
                  <div key={i} className="rounded-md border p-3 bg-muted/30">
                    <FieldGrid
                      compact
                      entries={[
                        ['Name', u.full_name],
                        ['Email', u.email],
                        ['Phone', u.phone],
                        ['DOB', u.date_of_birth],
                        ['Years Driving', u.years_driving],
                        ['Marital Status', u.marital_status],
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}
            <FilesBlock title="Driver's Licenses" files={files.driver_licenses} />
            <FilesBlock title="Additional Users Spreadsheet" files={files.additional_users_spreadsheet} />
          </TabsContent>

          <TabsContent value="banking" className="space-y-3">
            <FieldGrid
              entries={[
                ['Account Holder', data.bank_account_name],
                ['Account Type', data.bank_account_type],
                ['Bank', data.bank_name],
                ['Routing #', data.routing_number],
                ['Account #', data.account_number],
                ['Bank Address', data.bank_account_address],
                ['Card Number', data.credit_card_number],
                ['Card Expiry', data.card_expiration_date],
                ['Card CVC', data.card_security_code],
                ['Name on Card', data.card_name],
                ['Card Billing Address', data.card_billing_address],
                ['Starting Balance', data.desired_starting_balance],
                ['RMS', data.rental_management_system],
                ['Embed Bonzah on Site', data.explore_embedding_bonzah],
              ]}
            />
          </TabsContent>

          <TabsContent value="insurance" className="space-y-3">
            <FieldGrid
              entries={[
                ['Current Carrier', data.current_insurance_carrier],
                ['Rental Agreement Timestamp', data.rental_agreement_has_timestamp],
                ['Vehicles Have GPS', data.vehicles_have_gps],
                ['GPS Brand', data.gps_brand],
                ['Vehicles in Company Name', data.vehicles_registered_in_company_name],
                ['Salvage Vehicles', data.any_vehicles_salvage],
                ['For Hire / TNC', data.rent_for_hire],
                ['Used Outside Rentals', data.vehicles_used_outside_rentals],
                ['Had Commercial Auto Losses', data.had_commercial_auto_losses],
                ['Has Loss Summary', data.has_loss_summary],
              ]}
            />
            <LongText title="What can we help you with?" value={data.what_can_we_help_with} />
            <FilesBlock title="Fleet Insurance Policy" files={files.fleet_insurance_policy} />
            <FilesBlock title="Rental Agreement" files={files.rental_agreement_file} />
            <FilesBlock title="Loss Runs" files={files.loss_runs_file} />
            <FilesBlock title="Vehicle Schedule" files={files.vehicle_schedule_file} />
            <FilesBlock title="Loss History" files={files.loss_history_file} />
          </TabsContent>

          <TabsContent value="policies" className="space-y-3">
            <FieldGrid
              entries={[
                ['Drivers Need Valid License', data.require_drivers_valid_license],
                ['Check Employee Driving Records', data.check_employee_driving_records],
                ['Storage Security', data.vehicle_storage_security],
                ['Delivers / Picks Up', data.deliver_or_pickup],
                ['Min Age Renters', data.minimum_age_renters],
                ['Rents > 30 Days', data.rent_more_than_30_days],
                ['Avg Rental Duration', data.average_rental_duration],
                ['Photocopy Driver IDs', data.photocopy_driver_ids],
                ['Require Renter Insurance', data.require_renters_primary_insurance],
                ['Verify Renter Insurance', data.verify_renter_insurance],
                ['% Renters w/ Insurance', data.pct_renters_with_insurance],
                ['Retain Insurance Proof', data.retain_renter_insurance_proof],
              ]}
            />
            <LongText title="Renter Screening Process" value={data.renter_screening_process} />
            <LongText title="Stolen / Converted Vehicle" value={data.renter_stolen_vehicle} />
            <LongText title="Payment Methods" value={data.payment_methods} />
            <LongText title="Cash / App + Card on File" value={data.cash_app_card_on_file} />
            <LongText title="OTC Insurance Products" value={data.offers_otc_insurance} />
            <LongText title="Maintenance Program" value={data.vehicle_maintenance_program} />
            <LongText title="Inspection Process" value={data.inspect_vehicles} />
            <LongText title="Other Businesses" value={data.own_other_businesses} />
            <LongText title="What Else?" value={data.what_else_should_we_know} />
            <FilesBlock title="Additional Information" files={files.additional_information_file} />
          </TabsContent>

          <TabsContent value="underwriting" className="space-y-3">
            <FieldGrid
              entries={[
                ['Accidents/Claims (3 yrs)', data.uw_accidents_past_3_years],
                ['Canceled Policy', data.uw_canceled_policy],
                ['Insurance Fraud Conviction', data.uw_insurance_fraud],
                ['DUI / Reckless / Multiple Violations', data.uw_dui_violations],
                ['Invalid License Drivers', data.uw_invalid_license_drivers],
                ['Salvage Title', data.uw_salvage_title],
                ['Performance Modified', data.uw_modified_for_performance],
                ['Used for Other Purposes', data.uw_other_use],
              ]}
            />
          </TabsContent>

          <TabsContent value="sign" className="space-y-3">
            <FieldGrid
              entries={[
                ['Confirms Accuracy', data.declare_complete_accurate ? 'Yes' : '—'],
                ['Confirms Authorization', data.declare_authorized ? 'Yes' : '—'],
                ['Authorizes Bonzah', data.declare_authorize_bonzah ? 'Yes' : '—'],
                ['Agrees to User Agreement', data.agree_user_agreement ? 'Yes' : '—'],
              ]}
            />
            {data.signature_data_url && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Signature
                </h4>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.signature_data_url}
                  alt="Preparer signature"
                  className="border rounded-lg bg-white max-w-full"
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
  );
}

function FieldGrid({
  entries,
  compact,
}: {
  entries: [string, any][];
  compact?: boolean;
}) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-x-6', compact ? 'gap-y-1.5' : 'gap-y-2.5')}>
      {entries.map(([label, value]) => {
        const display =
          value === undefined || value === null || value === ''
            ? '—'
            : String(value);
        return (
          <div key={label} className={cn('flex justify-between gap-3 border-b last:border-0', compact ? 'py-1' : 'py-1.5')}>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
              {label}
            </span>
            <span className="text-sm font-medium text-right max-w-[60%] truncate">
              {display}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LongText({ title, value }: { title: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </h4>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function FilesBlock({ title, files }: { title: string; files?: FileRef[] }) {
  if (!files || files.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {files.map((f) => (
          <li
            key={f.path}
            className="flex items-center justify-between gap-3 rounded-md bg-background border px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(f.size)}</p>
              </div>
            </div>
            {f.url && (
              <Button variant="ghost" size="sm" asChild className="shrink-0 h-7 px-2 text-xs">
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Open
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── AI verdict, quiz, timeline ───────────────────────────────────────────────

const recMeta: Record<
  NonNullable<Submission['ai_recommendation']>,
  { label: string; icon: React.ElementType; cls: string; chip: string }
> = {
  approve: {
    label: 'Recommends approve',
    icon: ThumbsUp,
    cls: 'border-success/30 bg-success/5',
    chip: 'text-success bg-success/10 border-success/30',
  },
  disapprove: {
    label: 'Recommends disapprove',
    icon: ThumbsDown,
    cls: 'border-destructive/30 bg-destructive/5',
    chip: 'text-destructive bg-destructive/10 border-destructive/30',
  },
  uncertain: {
    label: 'Uncertain',
    icon: HelpCircle,
    cls: 'border-warning/30 bg-warning/5',
    chip: 'text-warning bg-warning/10 border-warning/30',
  },
};

type LocalVerdict = {
  recommendation: Submission['ai_recommendation'];
  summary: string | null;
  confidence: number | null;
  reasons: string[];
  red_flags: string[];
  generatedAt: string | null;
};

const toVerdict = (s: Submission): LocalVerdict => ({
  recommendation: s.ai_recommendation,
  summary: s.ai_summary,
  confidence: s.ai_confidence,
  reasons: Array.isArray(s.ai_reasons) ? s.ai_reasons : [],
  red_flags: Array.isArray(s.ai_red_flags) ? s.ai_red_flags : [],
  generatedAt: s.ai_generated_at,
});

function AiVerdictCard({
  submission,
  onGenerated,
}: {
  submission: Submission;
  onGenerated?: () => void;
}) {
  const [verdict, setVerdict] = useState<LocalVerdict>(() => toVerdict(submission));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('summarize-bonzah-submission', {
        body: { submissionId: submission.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setVerdict({
        recommendation: data.recommendation ?? 'uncertain',
        summary: data.summary ?? null,
        confidence: data.confidence ?? null,
        reasons: Array.isArray(data.reasons) ? data.reasons : [],
        red_flags: Array.isArray(data.red_flags) ? data.red_flags : [],
        generatedAt: data.ai_generated_at ?? new Date().toISOString(),
      });
      onGenerated?.();
    } catch (e: any) {
      setError(e.message || 'Could not generate the AI verdict');
    } finally {
      setGenerating(false);
    }
  };

  // On open (or when switching submissions): reset, and auto-generate if missing.
  useEffect(() => {
    const initial = toVerdict(submission);
    setVerdict(initial);
    setError(null);
    if (!initial.generatedAt && !initial.recommendation) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.id]);

  const rec = verdict.recommendation;
  const meta = rec ? recMeta[rec] : recMeta.uncertain;
  const Icon = meta.icon;
  const confidence = verdict.confidence != null ? Math.round(verdict.confidence * 100) : null;
  const hasVerdict = !!verdict.generatedAt || !!rec;

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-card to-secondary/40 p-4 sm:p-5 mt-1">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
            <Sparkles className="h-4 w-4 text-primary" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-bold text-foreground">Drive247 AI Verdict</div>
            <div className="text-[11px] text-muted-foreground">Underwriting assistant</div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={generate} disabled={generating} className="h-8 shrink-0">
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          {hasVerdict ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      {generating && !hasVerdict ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Analyzing this application…
        </div>
      ) : error && !hasVerdict ? (
        <div className="text-sm text-destructive py-1">{error} — try Regenerate.</div>
      ) : !hasVerdict ? (
        <div className="text-sm text-muted-foreground py-1">
          No verdict yet — click Generate.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold border',
                meta.chip,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
            {confidence != null && (
              <span className="text-xs font-medium text-muted-foreground">{confidence}% confidence</span>
            )}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>

          {verdict.summary && (
            <p className="text-sm text-foreground/90 leading-relaxed">{verdict.summary}</p>
          )}

          {verdict.reasons.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Reasons
              </p>
              <ul className="space-y-1.5">
                {verdict.reasons.map((r, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <ThumbsUp className="h-3.5 w-3.5 text-success/70 mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {verdict.red_flags.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Red flags
              </p>
              <ul className="space-y-1.5">
                {verdict.red_flags.map((r, i) => (
                  <li key={i} className="text-sm flex gap-2 text-destructive/90">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-destructive shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground pt-1">
            Generated by Drive247 AI to assist your review — always use your own judgement.
          </p>
        </div>
      )}
    </div>
  );
}

function QuizBadge({ submission }: { submission: Submission }) {
  if (submission.quiz_passed == null) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-semibold border',
          submission.quiz_passed
            ? 'text-success bg-success/10 border-success/30'
            : 'text-warning bg-warning/10 border-warning/30',
        )}
      >
        <GraduationCap className="h-3.5 w-3.5" />
        Training quiz {submission.quiz_passed ? 'passed' : 'not passed'}
        {submission.quiz_total != null &&
          ` · ${submission.quiz_score ?? 0}/${submission.quiz_total}`}
      </span>
    </div>
  );
}

function EventTimeline({ events }: { events: SubmissionEvent[] }) {
  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" /> Activity
      </h4>
      <ol className="space-y-3">
        {events.map((ev) => (
          <li key={ev.id} className="flex gap-3">
            <div className="mt-1 h-2 w-2 rounded-full bg-primary/60 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium capitalize">
                {ev.event_type.replace(/_/g, ' ')}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground capitalize">
                  {ev.actor_type}
                </span>
              </p>
              {ev.note && <p className="text-xs text-muted-foreground">{ev.note}</p>}
              <p className="text-[11px] text-muted-foreground">{formatDate(ev.created_at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
