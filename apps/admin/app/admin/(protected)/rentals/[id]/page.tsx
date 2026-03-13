'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { KPICard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { DatePicker } from '@/components/ui/date-picker';
import { BarChart3 } from 'lucide-react';
import { TenantCreditsTab } from '@/components/admin/tenant-credits-tab';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  Download,
  Building2,
  Globe,
  Link2,
  Settings2,
  Shield,
  AlertTriangle,
  Zap,
  CreditCard,
  FileText,
  X,
  Plus,
  LogOut,
  Car,
  Users,
  UserCheck,
  Activity,
  Clock,
  CircleDot,
  ShieldCheck,
  ArrowRightLeft,
  Coins,
} from 'lucide-react';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
  integration_bonzah: boolean;
  subscription_plan: string | null;
  stripe_subscription_customer_id: string | null;
  subscription_stripe_mode: 'test' | 'live';
  stripe_mode: 'test' | 'live';
  bonzah_mode: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  bonzah_username: string | null;
  boldsign_mode: string;
}

interface TenantSubscription {
  id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: string;
  plan_name: string;
  amount: number;
  currency: string;
  interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  created_at: string;
}

interface TenantInvoice {
  id: string;
  stripe_invoice_id: string;
  stripe_invoice_pdf: string | null;
  stripe_hosted_invoice_url: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  paid_at: string | null;
  invoice_number: string | null;
  created_at: string;
}

interface SubscriptionPlan {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  features: string[];
  amount: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
  trial_days: number;
  created_at: string;
  active_subscriptions: number;
}

interface PlanFormData {
  name: string;
  description: string;
  amount: string;
  currency: string;
  interval: string;
  trialDays: string;
  features: string[];
}

interface TenantStats {
  totalVehicles: number;
  activeRentals: number;
  totalCustomers: number;
  staffUsers: number;
  completedRentals: number;
}

interface MonthlyData {
  month: string;
  bookings: number;
  revenue: number;
}

interface StaffUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name?: string;
  details: any;
  created_at: string;
}

interface PolicyAcceptance {
  id: string;
  app_user_id: string;
  policy_type: string;
  version: string;
  ip_address: string | null;
  user_agent: string | null;
  accepted_at: string;
  user_name?: string;
  user_email?: string;
}

function formatActionLabel(action: string): string {
  const map: Record<string, string> = {
    rental_created: 'Rental Add',
    rental_updated: 'Rental Edit',
    rental_status_changed: 'Status Change',
    rental_deleted: 'Rental Delete',
    customer_created: 'Customer Add',
    customer_updated: 'Customer Edit',
    customer_blocked: 'Customer Block',
    customer_unblocked: 'Customer Unblock',
    vehicle_created: 'Vehicle Add',
    vehicle_updated: 'Vehicle Edit',
    vehicle_deleted: 'Vehicle Delete',
    payment_created: 'Payment Add',
    payment_updated: 'Payment Edit',
    payment_refunded: 'Refund',
    user_created: 'User Add',
    user_updated: 'User Edit',
    user_deactivated: 'User Deactivate',
    settings_updated: 'Settings Edit',
    agreement_created: 'Agreement Add',
    agreement_signed: 'Agreement Sign',
    login: 'Login',
    logout: 'Logout',
  };
  if (map[action]) return map[action];
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Dialog Shown$/i, 'View')
    .replace(/Warning Shown$/i, 'Warn');
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function TenantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: '',
    admin_name: '',
    slug: '',
    contact_email: '',
  });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Force logout state
  const [showForceLogoutConfirm, setShowForceLogoutConfirm] = useState(false);
  const [forceLogoutLoading, setForceLogoutLoading] = useState(false);

  // Subscription state
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [invoices, setInvoices] = useState<TenantInvoice[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  // Plans state
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planForm, setPlanForm] = useState<PlanFormData>({
    name: '',
    description: '',
    amount: '',
    currency: 'usd',
    interval: 'month',
    trialDays: '',
    features: [],
  });
  const [newFeature, setNewFeature] = useState('');

  // Maintenance banner state
  const [tenantBannerEnabled, setTenantBannerEnabled] = useState(false);
  const [tenantBannerMessage, setTenantBannerMessage] = useState('We are currently performing scheduled maintenance. Some features may be temporarily unavailable.');
  const [bannerSaving, setBannerSaving] = useState(false);

  // Stats, charts, staff, activity state
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [bookingsData, setBookingsData] = useState<MonthlyData[]>([]);
  const [revenueData, setRevenueData] = useState<MonthlyData[]>([]);
  const [bookingsChartLoading, setBookingsChartLoading] = useState(true);
  const [revenueChartLoading, setRevenueChartLoading] = useState(true);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('12m');
  const [analyticsFromDate, setAnalyticsFromDate] = useState<Date | undefined>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11); d.setDate(1); return d;
  });
  const [analyticsToDate, setAnalyticsToDate] = useState<Date | undefined>(new Date());
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [policyAcceptances, setPolicyAcceptances] = useState<PolicyAcceptance[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);

  // Integration mode state
  const [modeUpdating, setModeUpdating] = useState(false);
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [pendingModeChange, setPendingModeChange] = useState<{ type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe'; newMode: 'test' | 'live' } | null>(null);
  const [showSubscriptionDetail, setShowSubscriptionDetail] = useState(false);
  const [showCreditsDetail, setShowCreditsDetail] = useState(false);
  const [showBannerDialog, setShowBannerDialog] = useState(false);

  useEffect(() => {
    if (params.id) {
      loadTenant(params.id as string);
    }
  }, [params.id]);

  const loadTenant = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setTenant(data);
      setEditForm({
        company_name: data.company_name,
        admin_name: data.admin_name || '',
        slug: data.slug,
        contact_email: data.contact_email,
      });
      setTenantBannerEnabled(data.maintenance_banner_enabled ?? false);
      setTenantBannerMessage(data.maintenance_banner_message || 'We are currently performing scheduled maintenance. Some features may be temporarily unavailable.');

      loadSubscription(id);
      loadPlans(id);
      loadStats(id);
      loadStaffUsers(id);
      loadRecentActivity(id);
      loadPolicyAcceptances(id);
    } catch (error) {
      console.error('Error loading tenant:', error);
      toast.error('Failed to load tenant details');
    } finally {
      setLoading(false);
    }
  };

  const loadSubscription = async (tenantId: string) => {
    setSubscriptionLoading(true);
    try {
      const { data: subData } = await supabase
        .from('tenant_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'trialing', 'past_due'])
        .maybeSingle();

      setSubscription(subData);

      const { data: invoiceData } = await supabase
        .from('tenant_subscription_invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20);

      setInvoices(invoiceData || []);
    } catch (error) {
      console.error('Error loading subscription:', error);
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const loadPlans = async (tenantId: string) => {
    setPlansLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action: 'list', tenantId },
      });
      if (error) throw error;
      const rawPlans = data?.plans || [];

      const { data: subCounts } = await supabase
        .from('tenant_subscriptions')
        .select('plan_id')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'trialing', 'past_due']);

      const countMap: Record<string, number> = {};
      (subCounts || []).forEach((s: any) => {
        if (s.plan_id) countMap[s.plan_id] = (countMap[s.plan_id] || 0) + 1;
      });

      setPlans(rawPlans.map((p: any) => ({ ...p, active_subscriptions: countMap[p.id] || 0 })));
    } catch (error) {
      console.error('Error loading plans:', error);
    } finally {
      setPlansLoading(false);
    }
  };

  const loadStats = async (tenantId: string) => {
    setStatsLoading(true);
    try {
      const [vehiclesRes, activeRentalsRes, completedRentalsRes, customersRes, staffRes] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['active', 'in_progress', 'confirmed']),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'completed'),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);

      setStats({
        totalVehicles: vehiclesRes.count || 0,
        activeRentals: activeRentalsRes.count || 0,
        completedRentals: completedRentalsRes.count || 0,
        totalCustomers: customersRes.count || 0,
        staffUsers: staffRes.count || 0,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadChartData = async (
    tenantId: string,
    from: Date | undefined,
    to: Date | undefined,
    type: 'bookings' | 'revenue',
  ) => {
    const setLoading = type === 'bookings' ? setBookingsChartLoading : setRevenueChartLoading;
    const setData = type === 'bookings' ? setBookingsData : setRevenueData;
    setLoading(true);
    try {
      const startDate = from || new Date(new Date().setMonth(new Date().getMonth() - 11));
      const endDate = to || new Date();
      // Set end date to end of day
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);

      let query = supabase
        .from('rentals')
        .select('created_at, monthly_amount, collection_fee, delivery_fee, insurance_premium, discount_applied')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: true });

      const { data, error } = await query;
      if (error) throw error;

      // Build month keys between start and end
      const monthMap: Record<string, { bookings: number; revenue: number }> = {};
      const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (cursor <= endMonth) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = { bookings: 0, revenue: 0 };
        cursor.setMonth(cursor.getMonth() + 1);
      }

      (data || []).forEach((r: any) => {
        if (!r.created_at) return;
        const d = new Date(r.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) return;
        monthMap[key].bookings += 1;
        const total = (r.monthly_amount || 0) + (r.collection_fee || 0) + (r.delivery_fee || 0) + (r.insurance_premium || 0) - (r.discount_applied || 0);
        monthMap[key].revenue += Math.max(0, total);
      });

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      setData(
        Object.entries(monthMap).map(([key, val]) => {
          const [y, m] = key.split('-');
          return {
            month: `${months[parseInt(m) - 1]} ${y.slice(2)}`,
            bookings: val.bookings,
            revenue: Math.round(val.revenue * 100) / 100,
          };
        })
      );
    } catch (error) {
      console.error(`Error loading ${type} data:`, error);
    } finally {
      setLoading(false);
    }
  };

  // Load charts when tenant or date filters change
  useEffect(() => {
    if (tenant?.id) {
      loadChartData(tenant.id, analyticsFromDate, analyticsToDate, 'bookings');
      loadChartData(tenant.id, analyticsFromDate, analyticsToDate, 'revenue');
    }
  }, [tenant?.id, analyticsFromDate, analyticsToDate]);

  const handlePeriodChange = (period: string) => {
    setAnalyticsPeriod(period);
    const now = new Date();
    const from = new Date();
    switch (period) {
      case '7d': from.setDate(now.getDate() - 7); break;
      case '30d': from.setDate(now.getDate() - 30); break;
      case '3m': from.setMonth(now.getMonth() - 3); break;
      case '6m': from.setMonth(now.getMonth() - 6); break;
      case '12m': from.setMonth(now.getMonth() - 11); from.setDate(1); break;
      case 'ytd': from.setMonth(0); from.setDate(1); break;
      case 'all': from.setFullYear(2020, 0, 1); break;
      case 'custom': return; // don't change dates
    }
    setAnalyticsFromDate(from);
    setAnalyticsToDate(now);
  };

  const loadStaffUsers = async (tenantId: string) => {
    setStaffLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, name, email, role, is_active, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setStaffUsers(data || []);
    } catch (error) {
      console.error('Error loading staff:', error);
    } finally {
      setStaffLoading(false);
    }
  };

  const loadRecentActivity = async (tenantId: string) => {
    setActivityLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, entity_type, entity_id, actor_id, details, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(15);

      if (error) throw error;

      // Batch-resolve actor names
      const actorIds = [...new Set((data || []).map((d) => d.actor_id).filter(Boolean))];
      let actorMap: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: actors } = await supabase
          .from('app_users')
          .select('id, name, email')
          .in('id', actorIds);

        (actors || []).forEach((a: any) => {
          actorMap[a.id] = a.name || a.email;
        });
      }

      setRecentActivity(
        (data || []).map((entry) => ({
          ...entry,
          actor_name: entry.actor_id ? actorMap[entry.actor_id] || 'Unknown' : 'System',
        }))
      );
    } catch (error) {
      console.error('Error loading activity:', error);
    } finally {
      setActivityLoading(false);
    }
  };

  const loadPolicyAcceptances = async (tenantId: string) => {
    setPolicyLoading(true);
    try {
      const { data, error } = await supabase
        .from('policy_acceptances')
        .select('id, app_user_id, policy_type, version, ip_address, user_agent, accepted_at')
        .eq('tenant_id', tenantId)
        .order('accepted_at', { ascending: false });

      if (error) throw error;

      // Batch-resolve user names
      const userIds = [...new Set((data || []).map((d) => d.app_user_id).filter(Boolean))];
      let userMap: Record<string, { name: string | null; email: string }> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('app_users')
          .select('id, name, email')
          .in('id', userIds);

        (users || []).forEach((u: any) => {
          userMap[u.id] = { name: u.name, email: u.email };
        });
      }

      setPolicyAcceptances(
        (data || []).map((entry) => ({
          ...entry,
          ip_address: entry.ip_address as string | null,
          user_name: userMap[entry.app_user_id]?.name || undefined,
          user_email: userMap[entry.app_user_id]?.email || undefined,
        }))
      );
    } catch (error) {
      console.error('Error loading policy acceptances:', error);
    } finally {
      setPolicyLoading(false);
    }
  };

  const handleSaveBanner = async () => {
    if (!tenant) return;
    setBannerSaving(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          maintenance_banner_enabled: tenantBannerEnabled,
          maintenance_banner_message: tenantBannerMessage,
        })
        .eq('id', tenant.id);
      if (error) throw error;
      toast.success(tenantBannerEnabled ? 'Maintenance banner enabled for this tenant' : 'Maintenance banner disabled for this tenant');
    } catch (error: any) {
      toast.error(`Failed to update banner: ${error.message}`);
    } finally {
      setBannerSaving(false);
    }
  };

  const openAddPlan = () => {
    setEditingPlan(null);
    setPlanForm({ name: '', description: '', amount: '', currency: 'usd', interval: 'month', trialDays: '0', features: [] });
    setNewFeature('');
    setShowPlanModal(true);
  };

  const openEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      amount: (plan.amount / 100).toString(),
      currency: plan.currency,
      interval: plan.interval,
      trialDays: (plan.trial_days || 0).toString(),
      features: [...plan.features],
    });
    setNewFeature('');
    setShowPlanModal(true);
  };

  const handleSavePlan = async () => {
    if (!tenant) return;
    if (!planForm.name.trim()) { toast.error('Plan name is required'); return; }
    const amountDollars = parseFloat(planForm.amount);
    if (isNaN(amountDollars) || amountDollars <= 0) { toast.error('Amount must be a positive number'); return; }

    setPlanSaving(true);
    try {
      const amountCents = Math.round(amountDollars * 100);

      if (editingPlan) {
        const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
          body: {
            action: 'update',
            planId: editingPlan.id,
            name: planForm.name,
            description: planForm.description || null,
            features: planForm.features,
            amount: amountCents,
            currency: planForm.currency,
            interval: planForm.interval,
            trialDays: parseInt(planForm.trialDays) || 0,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.pricingChanged && editingPlan.active_subscriptions > 0) {
          toast.success('Plan updated! Note: existing subscribers will continue at their current rate until they renew.');
        } else {
          toast.success(`"${planForm.name}" plan updated successfully`);
        }
      } else {
        const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
          body: {
            action: 'create',
            tenantId: tenant.id,
            name: planForm.name,
            description: planForm.description || null,
            features: planForm.features,
            amount: amountCents,
            currency: planForm.currency,
            interval: planForm.interval,
            trialDays: parseInt(planForm.trialDays) || 0,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success(`"${planForm.name}" plan created \u2014 tenant can now subscribe from their portal`);
      }

      setShowPlanModal(false);
      loadPlans(tenant.id);
    } catch (error: any) {
      toast.error(`Something went wrong while saving the plan. Please try again.`);
    } finally {
      setPlanSaving(false);
    }
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlan) => {
    if (!tenant) return;

    if (plan.is_active && plan.active_subscriptions > 0) {
      const confirmed = confirm(
        `"${plan.name}" has ${plan.active_subscriptions} active subscriber${plan.active_subscriptions > 1 ? 's' : ''}.\n\nDeactivating will hide this plan from new signups, but existing subscribers will continue to be billed.\n\nContinue?`
      );
      if (!confirmed) return;
    }

    try {
      const action = plan.is_active ? 'deactivate' : 'activate';
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action, planId: plan.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (plan.is_active) {
        toast.success(`"${plan.name}" deactivated \u2014 no longer visible to new subscribers`);
      } else {
        toast.success(`"${plan.name}" activated \u2014 now visible to the tenant in their portal`);
      }
      loadPlans(tenant.id);
    } catch (error: any) {
      toast.error(`Something went wrong while updating the plan. Please try again.`);
    }
  };

  const handleDeletePlan = async (plan: SubscriptionPlan) => {
    if (!tenant) return;

    if (plan.active_subscriptions > 0) {
      toast.error(
        `Can't delete "${plan.name}" because it has ${plan.active_subscriptions} active subscriber${plan.active_subscriptions > 1 ? 's' : ''}. Deactivate it instead to hide it from new signups.`
      );
      return;
    }

    if (!confirm(`Permanently delete "${plan.name}"? This cannot be undone.`)) return;

    try {
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action: 'delete', planId: plan.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`"${plan.name}" has been deleted`);
      loadPlans(tenant.id);
    } catch (error: any) {
      toast.error(`Something went wrong while deleting the plan. Please try again.`);
    }
  };

  const handleToggleStripeMode = async (newMode: 'test' | 'live') => {
    if (!tenant) return;
    if (newMode === tenant.subscription_stripe_mode) return;

    if (newMode === 'live') {
      const confirmed = confirm(
        'Switch to LIVE Stripe mode for this tenant?\n\nReal charges will be made. Make sure live Stripe keys are configured.'
      );
      if (!confirmed) return;
    }

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ subscription_stripe_mode: newMode })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, subscription_stripe_mode: newMode });
      toast.success(`Stripe mode switched to ${newMode} for ${tenant.company_name}`);
    } catch (error: any) {
      toast.error(`Failed to update Stripe mode: ${error.message}`);
    }
  };

  const handleModeToggle = (type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe', newMode: 'test' | 'live') => {
    if (newMode === 'live') {
      setPendingModeChange({ type, newMode });
      setShowModeConfirm(true);
    } else {
      executeModeChange(type, newMode);
    }
  };

  const executeModeChange = async (type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe', newMode: 'test' | 'live') => {
    if (!tenant) return;
    setModeUpdating(true);
    try {
      const fieldMap: Record<string, string> = {
        stripe: 'stripe_mode',
        bonzah: 'bonzah_mode',
        boldsign: 'boldsign_mode',
        subscription_stripe: 'subscription_stripe_mode',
      };
      const field = fieldMap[type];
      const { error } = await supabase
        .from('tenants')
        .update({ [field]: newMode })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, [field]: newMode } as any);
      const labels: Record<string, string> = {
        stripe: 'Stripe Connect',
        bonzah: 'Bonzah API',
        boldsign: 'BoldSign',
        subscription_stripe: 'Subscription Stripe',
      };
      toast.success(`${labels[type]} switched to ${newMode} mode`);
    } catch (error: any) {
      toast.error(`Error updating mode: ${error.message}`);
    } finally {
      setModeUpdating(false);
    }
  };

  const confirmModeChange = () => {
    if (pendingModeChange) {
      executeModeChange(pendingModeChange.type, pendingModeChange.newMode);
    }
    setShowModeConfirm(false);
    setPendingModeChange(null);
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setPlanForm({ ...planForm, features: [...planForm.features, newFeature.trim()] });
      setNewFeature('');
    }
  };

  const removeFeature = (index: number) => {
    setPlanForm({ ...planForm, features: planForm.features.filter((_, i) => i !== index) });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!tenant) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, status: newStatus });
      toast.success(`Tenant ${newStatus === 'active' ? 'activated' : 'suspended'} successfully!`);
    } catch (error: any) {
      toast.error(`Error updating status: ${error.message}`);
    }
  };

  const handleUpdateType = async (newType: 'production' | 'test') => {
    if (!tenant) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ tenant_type: newType })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, tenant_type: newType });
      toast.success(`Tenant marked as ${newType}!`);
    } catch (error: any) {
      toast.error(`Error updating tenant type: ${error.message}`);
    }
  };

  const handleToggleIntegration = async (integration: 'bonzah', enabled: boolean) => {
    if (!tenant) return;

    const fieldName = `integration_${integration}` as keyof Tenant;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ [fieldName]: enabled })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, [fieldName]: enabled });
      toast.success(`${integration.charAt(0).toUpperCase() + integration.slice(1)} ${enabled ? 'enabled' : 'disabled'}!`);
    } catch (error: any) {
      toast.error(`Error updating integration: ${error.message}`);
    }
  };

  const handleSaveEdit = async () => {
    if (!tenant) return;
    setSaving(true);

    const sanitizedSlug = editForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          company_name: editForm.company_name,
          admin_name: editForm.admin_name || null,
          slug: sanitizedSlug,
          contact_email: editForm.contact_email,
        })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({
        ...tenant,
        company_name: editForm.company_name,
        admin_name: editForm.admin_name || null,
        slug: sanitizedSlug,
        contact_email: editForm.contact_email,
      });
      setEditForm({ ...editForm, slug: sanitizedSlug });
      setIsEditing(false);
      toast.success('Tenant updated successfully!');
    } catch (error: any) {
      toast.error(`Error updating tenant: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleForceLogout = async () => {
    if (!tenant) return;
    setForceLogoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-logout', {
        body: { tenantId: tenant.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Successfully logged out ${data.successCount} user${data.successCount !== 1 ? 's' : ''} from ${tenant.company_name}`
      );
      if (data.failCount > 0) {
        toast.error(`${data.failCount} user${data.failCount !== 1 ? 's' : ''} could not be logged out`);
      }
      setShowForceLogoutConfirm(false);
    } catch (error: any) {
      toast.error(`Failed to force logout: ${error.message}`);
    } finally {
      setForceLogoutLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!tenant || deleteConfirmName !== tenant.company_name) {
      toast.error('Company name does not match');
      return;
    }

    setDeleting(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-tenant', {
        body: { tenant_id: tenant.id }
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success('Tenant and all associated data deleted successfully!');
      router.push('/admin/rentals');
    } catch (error: any) {
      toast.error(`Error deleting tenant: ${error.message}`);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-6 lg:p-8">
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">Tenant not found</p>
          <Button variant="link" onClick={() => router.push('/admin/rentals')} className="mt-4">
            Back to Rental Companies
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 h-full overflow-auto">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/admin/rentals')}
        className="text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rental Companies
      </Button>

      {/* Page header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{tenant.company_name}</h1>
            <Badge variant={
              tenant.tenant_type === 'production' ? 'success'
              : tenant.tenant_type === 'test' ? 'warning'
              : 'secondary'
            }>
              {tenant.tenant_type || 'Not Set'}
            </Badge>
            <Badge variant={tenant.status === 'active' ? 'success' : 'destructive'}>
              {tenant.status}
            </Badge>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-card p-1">
            <Button
              variant={tenant.tenant_type === 'production' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleUpdateType('production')}
              className="h-7 text-xs"
            >
              Production
            </Button>
            <Button
              variant={tenant.tenant_type === 'test' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleUpdateType('test')}
              className="h-7 text-xs"
            >
              Test
            </Button>
          </div>

          <Button
            variant={tenant.status === 'active' ? 'outline' : 'default'}
            size="sm"
            onClick={() => handleUpdateStatus(tenant.status === 'active' ? 'suspended' : 'active')}
          >
            {tenant.status === 'active' ? 'Suspend' : 'Activate'}
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="space-y-6">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="management">Management</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <CardTitle className="text-lg">Quick Actions</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <a
                      href={`https://${tenant.slug}.portal.drive-247.com`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Open Portal
                    </a>
                  </Button>
                  <Button variant="outline" asChild size="sm">
                    <a
                      href={`https://${tenant.slug}.drive-247.com`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Open Booking Site
                    </a>
                  </Button>
                  <Button variant="outline" asChild size="sm">
                    <a href={`mailto:${tenant.contact_email}`}>
                      Email Contact
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowBannerDialog(true)}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                    Maintenance Banner
                    {tenantBannerEnabled && (
                      <Badge variant="warning" className="ml-1 text-[9px] px-1.5 py-0">Active</Badge>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowForceLogoutConfirm(true)}
                    className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1" />
                    Force Logout All Users
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Company Information */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">Company Information</CardTitle>
                  </div>
                  {!isEditing && (
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Company Name</Label>
                      <Input
                        value={editForm.company_name}
                        onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Admin Name</Label>
                      <Input
                        value={editForm.admin_name}
                        onChange={(e) => setEditForm({ ...editForm, admin_name: e.target.value })}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Slug (subdomain)</Label>
                      <Input
                        value={editForm.slug}
                        onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                      />
                      <p className="text-xs text-amber-400">
                        Warning: Changing the slug will change the portal and booking URLs
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Contact Email</Label>
                      <Input
                        type="email"
                        value={editForm.contact_email}
                        onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditing(false);
                          setEditForm({
                            company_name: tenant.company_name,
                            admin_name: tenant.admin_name || '',
                            slug: tenant.slug,
                            contact_email: tenant.contact_email,
                          });
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleSaveEdit} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[
                      { label: 'Company Name', value: tenant.company_name },
                      { label: 'Admin Name', value: tenant.admin_name || 'Not set' },
                      { label: 'Slug', value: tenant.slug },
                      { label: 'Contact Email', value: tenant.contact_email },
                      {
                        label: 'Created',
                        value: new Date(tenant.created_at).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }),
                      },
                    ].map((item) => (
                      <div key={item.label} className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{item.label}</span>
                        <span className={cn("text-sm", !item.value || item.value === 'Not set' ? 'text-muted-foreground' : 'text-foreground')}>
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Access URLs */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <CardTitle className="text-lg">Access URLs</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  {
                    label: 'Portal URL (Admin Dashboard)',
                    url: `https://${tenant.slug}.portal.drive-247.com`,
                  },
                  {
                    label: 'Booking URL (Customer Facing)',
                    url: `https://${tenant.slug}.drive-247.com`,
                  },
                ].map((item) => (
                  <div key={item.label} className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted/50 px-3 py-2 rounded-md border border-border/40 text-sm text-primary break-all">
                        {item.url}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(item.url, item.label.split(' (')[0])}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Policy Acceptances */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">Policy Acceptances</CardTitle>
                    {!policyLoading && (
                      <Badge variant="secondary" className="text-[10px]">{policyAcceptances.length}</Badge>
                    )}
                  </div>
                </div>
                <CardDescription>Privacy policy and terms acceptance log</CardDescription>
              </CardHeader>
              <CardContent>
                {policyLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : policyAcceptances.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6 text-sm">No policy acceptances recorded</p>
                ) : (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary/5 hover:bg-primary/5">
                          <TableHead>User</TableHead>
                          <TableHead>Policy</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>IP Address</TableHead>
                          <TableHead>Accepted At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policyAcceptances.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <div>
                                <span className="text-sm font-medium">
                                  {entry.user_name || <span className="text-muted-foreground">No name</span>}
                                </span>
                                {entry.user_email && (
                                  <p className="text-xs text-muted-foreground">{entry.user_email}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={entry.policy_type === 'privacy_policy' ? 'info' : 'default'} className="text-[11px] whitespace-nowrap">
                                {entry.policy_type === 'privacy_policy' ? 'Privacy Policy' : 'Terms & Conditions'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground tabular-nums">
                              v{entry.version}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground tabular-nums">
                              {entry.ip_address || '—'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(entry.accepted_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Staff Users */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">Staff Users</CardTitle>
                    {!staffLoading && (
                      <Badge variant="secondary" className="text-[10px]">{staffUsers.length}</Badge>
                    )}
                  </div>
                </div>
                <CardDescription>Portal staff accounts for this tenant</CardDescription>
              </CardHeader>
              <CardContent>
                {staffLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : staffUsers.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6 text-sm">No staff users found</p>
                ) : (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary/5 hover:bg-primary/5">
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Joined</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {staffUsers.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="text-sm font-medium">
                              {user.name || <span className="text-muted-foreground">No name</span>}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                            <TableCell>
                              <Badge variant={
                                user.role === 'head_admin' ? 'default'
                                : user.role === 'admin' ? 'info'
                                : user.role === 'manager' ? 'warning'
                                : 'secondary'
                              } className="whitespace-nowrap capitalize">
                                {user.role.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={user.is_active ? 'success' : 'destructive'}>
                                {user.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(user.created_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">Recent Activity</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/admin/audit-logs')}
                    className="text-xs text-muted-foreground"
                  >
                    View All Logs
                  </Button>
                </div>
                <CardDescription>Latest actions performed within this tenant</CardDescription>
              </CardHeader>
              <CardContent>
                {activityLoading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-48" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6 text-sm">No activity recorded yet</p>
                ) : (
                  <div className="space-y-1">
                    {recentActivity.map((entry, i) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "flex items-start gap-3 py-2.5 px-2 rounded-md hover:bg-muted/30 transition-colors",
                          i < recentActivity.length - 1 && "border-b border-border/20"
                        )}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{entry.actor_name}</span>
                            <Badge variant="default" className="text-[10px] whitespace-nowrap">
                              {formatActionLabel(entry.action)}
                            </Badge>
                            {entry.entity_type && (
                              <span className="text-xs text-muted-foreground capitalize">{entry.entity_type}</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(entry.created_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Management Tab */}
        <TabsContent value="management" className="space-y-6">
          {/* Subscription */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <img src="/stripe-logo.svg" alt="Stripe" className="h-5 w-auto" />
                  <div>
                    <h3 className="text-base font-semibold">Subscription</h3>
                    <p className="text-xs text-muted-foreground">Platform billing and plan management</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => setShowSubscriptionDetail(true)}>
                  Manage Plans
                </Button>
              </div>
              <Separator className="mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</span>
                  <div>
                    {subscription ? (
                      <Badge variant={subscription.status === 'active' ? 'success' : subscription.status === 'trialing' ? 'warning' : 'secondary'} className="capitalize">
                        {subscription.status}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Plan</span>
                  <p className="text-sm font-medium capitalize">{subscription?.plan_name || <span className="text-muted-foreground">No plan</span>}</p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Billing</span>
                  <p className="text-sm font-medium">
                    {subscription
                      ? <>{(subscription.amount / 100).toFixed(2)} <span className="text-muted-foreground text-xs">{subscription.currency.toUpperCase()}/{subscription.interval}</span></>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mode</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={(tenant.subscription_stripe_mode || 'test') === 'live' ? 'success' : 'warning'} className="capitalize">
                      {tenant.subscription_stripe_mode || 'test'}
                    </Badge>
                    <Button
                      variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                      disabled={modeUpdating}
                      onClick={() => handleModeToggle('subscription_stripe', (tenant.subscription_stripe_mode || 'test') === 'test' ? 'live' : 'test')}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Switch
                    </Button>
                  </div>
                </div>
              </div>
              {subscription && (
                <div className="mt-5 pt-4 border-t border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  {subscription.current_period_end && (
                    <span>Period ends <span className="text-foreground font-medium">{formatDate(subscription.current_period_end)}</span></span>
                  )}
                  {subscription.card_brand && subscription.card_last4 && (
                    <span>Payment <span className="text-foreground font-medium capitalize">{subscription.card_brand} ····{subscription.card_last4}</span></span>
                  )}
                  {subscription.card_exp_month && subscription.card_exp_year && (
                    <span>Expires <span className="text-foreground font-medium">{String(subscription.card_exp_month).padStart(2, '0')}/{subscription.card_exp_year}</span></span>
                  )}
                  {subscription.stripe_customer_id && (
                    <span>Customer <span className="text-foreground font-mono text-[11px]">{subscription.stripe_customer_id}</span></span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credits */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Coins className="h-6 w-6 text-amber-400" />
                  <div>
                    <h3 className="text-base font-semibold">Credits</h3>
                    <p className="text-xs text-muted-foreground">Verification credit wallet — adjust balance and view transaction history</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => setShowCreditsDetail(true)}>
                  Manage Credits
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stripe Connect */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <img src="/stripe-logo.svg" alt="Stripe" className="h-5 w-auto" />
                  <div>
                    <h3 className="text-base font-semibold">Stripe Connect</h3>
                    <p className="text-xs text-muted-foreground">Payment processing for customer bookings via Stripe Connect</p>
                  </div>
                </div>
                <Badge variant={tenant.stripe_account_id && tenant.stripe_onboarding_complete ? 'success' : tenant.stripe_account_id ? 'warning' : 'secondary'}>
                  {tenant.stripe_account_id ? (tenant.stripe_onboarding_complete ? 'Connected' : 'Onboarding') : 'Not connected'}
                </Badge>
              </div>
              <Separator className="mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Account ID</span>
                  {tenant.stripe_account_id ? (
                    <p className="text-sm font-mono text-foreground">{tenant.stripe_account_id}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not set up</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Onboarding</span>
                  {tenant.stripe_account_id ? (
                    <p className={cn("text-sm font-medium", tenant.stripe_onboarding_complete ? "text-success" : "text-warning")}>
                      {tenant.stripe_onboarding_complete ? 'Complete' : 'Incomplete'}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Account Status</span>
                  <p className="text-sm font-medium capitalize">{tenant.stripe_account_status || <span className="text-muted-foreground">—</span>}</p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mode</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={tenant.stripe_mode === 'live' ? 'success' : 'warning'} className="capitalize">
                      {tenant.stripe_mode}
                    </Badge>
                    <Button
                      variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                      disabled={modeUpdating}
                      onClick={() => handleModeToggle('stripe', tenant.stripe_mode === 'test' ? 'live' : 'test')}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Switch
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bonzah Insurance */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <img src="/bonzah-logo.svg" alt="Bonzah" className="h-6 w-auto" />
                  <div>
                    <h3 className="text-base font-semibold">Bonzah Insurance</h3>
                    <p className="text-xs text-muted-foreground">Customer insurance coverage and premium calculation</p>
                  </div>
                </div>
                <Badge variant={tenant.integration_bonzah ? 'success' : 'secondary'}>
                  {tenant.integration_bonzah ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <Separator className="mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Integration</span>
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-block h-2 w-2 rounded-full", tenant.integration_bonzah ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                    <span className="text-sm font-medium">{tenant.integration_bonzah ? 'Active' : 'Inactive'}</span>
                    <Button
                      variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleIntegration('bonzah', !tenant.integration_bonzah)}
                    >
                      {tenant.integration_bonzah ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Credentials</span>
                  <p className="text-sm font-medium">{tenant.bonzah_username || <span className="text-muted-foreground">Not configured</span>}</p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mode</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={(tenant.bonzah_mode || 'test') === 'live' ? 'success' : 'warning'} className="capitalize">
                      {tenant.bonzah_mode || 'test'}
                    </Badge>
                    <Button
                      variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                      disabled={modeUpdating}
                      onClick={() => handleModeToggle('bonzah', (tenant.bonzah_mode || 'test') === 'test' ? 'live' : 'test')}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Switch
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* BoldSign */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <img src="/boldsign-logo.svg" alt="BoldSign" className="h-6 w-auto" />
                  <div>
                    <h3 className="text-base font-semibold">BoldSign</h3>
                    <p className="text-xs text-muted-foreground">Electronic signatures for rental agreements and contracts</p>
                  </div>
                </div>
                <Badge variant={tenant.boldsign_mode === 'live' ? 'success' : 'info'}>
                  {tenant.boldsign_mode === 'live' ? 'Production' : 'Sandbox'}
                </Badge>
              </div>
              <Separator className="mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Environment</span>
                  <p className={cn("text-sm font-medium", tenant.boldsign_mode === 'live' ? "text-success" : "text-sky-400")}>
                    {tenant.boldsign_mode === 'live' ? 'Production' : 'Sandbox'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mode</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={tenant.boldsign_mode === 'live' ? 'success' : 'warning'} className="capitalize">
                      {tenant.boldsign_mode || 'test'}
                    </Badge>
                    <Button
                      variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                      disabled={modeUpdating}
                      onClick={() => handleModeToggle('boldsign', tenant.boldsign_mode === 'live' ? 'test' : 'live')}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Switch
                    </Button>
                  </div>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Note</span>
                  <p className="text-xs text-muted-foreground">
                    {tenant.boldsign_mode === 'live'
                      ? 'Production documents are legally binding and stored permanently'
                      : 'Sandbox documents are watermarked and auto-deleted after 14 days'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Vehicles"
              value={stats?.totalVehicles ?? 0}
              isLoading={statsLoading}
            />
            <KPICard
              title="Active Rentals"
              value={stats?.activeRentals ?? 0}
              isLoading={statsLoading}
              subtitle={stats ? `${stats.completedRentals} completed` : undefined}
            />
            <KPICard
              title="Customers"
              value={stats?.totalCustomers ?? 0}
              isLoading={statsLoading}
            />
            <KPICard
              title="Staff Users"
              value={stats?.staffUsers ?? 0}
              isLoading={statsLoading}
            />
          </div>

          {/* Shared date filter bar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Performance</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={analyticsPeriod} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="3m">Last 3 months</SelectItem>
                  <SelectItem value="6m">Last 6 months</SelectItem>
                  <SelectItem value="12m">Last 12 months</SelectItem>
                  <SelectItem value="ytd">Year to date</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {analyticsPeriod === 'custom' && (
                <>
                  <DatePicker
                    value={analyticsFromDate}
                    onChange={setAnalyticsFromDate}
                    placeholder="From"
                    className="w-[150px] h-9 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <DatePicker
                    value={analyticsToDate}
                    onChange={setAnalyticsToDate}
                    placeholder="To"
                    className="w-[150px] h-9 text-xs"
                  />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Bookings Chart */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                  <CardTitle className="text-base">Bookings</CardTitle>
                </div>
                <CardDescription>Monthly booking volume</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {bookingsChartLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : bookingsData.every((d) => d.bookings === 0) ? (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    No bookings in this period
                  </div>
                ) : (
                  <ChartContainer
                    config={{
                      bookings: { label: 'Bookings', color: 'hsl(185, 80%, 55%)' },
                    } satisfies ChartConfig}
                    className="aspect-auto h-[280px] w-full"
                  >
                    <AreaChart data={bookingsData} margin={{ top: 10, right: 10, bottom: 0, left: -15 }}>
                      <defs>
                        <linearGradient id="bookingsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(185, 80%, 55%)" stopOpacity={0.35} />
                          <stop offset="60%" stopColor="hsl(185, 80%, 55%)" stopOpacity={0.08} />
                          <stop offset="100%" stopColor="hsl(185, 80%, 55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="bookings"
                        stroke="hsl(185, 80%, 55%)"
                        strokeWidth={2.5}
                        fill="url(#bookingsGradient)"
                        dot={{ fill: 'hsl(185, 80%, 55%)', strokeWidth: 0, r: 3 }}
                        activeDot={{ fill: 'hsl(185, 80%, 55%)', stroke: 'hsl(185, 80%, 55%)', strokeWidth: 2, strokeOpacity: 0.3, r: 6 }}
                        style={{ filter: 'drop-shadow(0 0 6px hsl(185 80% 55% / 0.5))' }}
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Revenue Chart */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <CardTitle className="text-base">Revenue</CardTitle>
                </div>
                <CardDescription>Monthly revenue breakdown</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {revenueChartLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : revenueData.every((d) => d.revenue === 0) ? (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    No revenue in this period
                  </div>
                ) : (
                  <ChartContainer
                    config={{
                      revenue: { label: 'Revenue', color: 'hsl(155, 70%, 50%)' },
                    } satisfies ChartConfig}
                    className="aspect-auto h-[280px] w-full"
                  >
                    <AreaChart data={revenueData} margin={{ top: 10, right: 10, bottom: 0, left: -15 }}>
                      <defs>
                        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(155, 70%, 50%)" stopOpacity={0.35} />
                          <stop offset="60%" stopColor="hsl(155, 70%, 50%)" stopOpacity={0.08} />
                          <stop offset="100%" stopColor="hsl(155, 70%, 50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value: number) => [`\u00A3${value.toLocaleString()}`, 'Revenue']}
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(155, 70%, 50%)"
                        strokeWidth={2.5}
                        fill="url(#revenueGradient)"
                        dot={{ fill: 'hsl(155, 70%, 50%)', strokeWidth: 0, r: 3 }}
                        activeDot={{ fill: 'hsl(155, 70%, 50%)', stroke: 'hsl(155, 70%, 50%)', strokeWidth: 2, strokeOpacity: 0.3, r: 6 }}
                        style={{ filter: 'drop-shadow(0 0 6px hsl(155 70% 50% / 0.5))' }}
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>

      {/* Subscription Detail Dialog */}
      <Dialog open={showSubscriptionDetail} onOpenChange={setShowSubscriptionDetail}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Subscription Management</DialogTitle>
            <DialogDescription>Manage plans, view status, and invoices for {tenant.company_name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 pt-2">
            {/* Plans */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Subscription Plans</h3>
                <Button size="sm" onClick={openAddPlan}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Plan
                </Button>
              </div>
              {plansLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : plans.length === 0 ? (
                <p className="text-muted-foreground text-center py-6 text-sm">No plans configured. Add a plan to enable subscriptions.</p>
              ) : (
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary/5 hover:bg-primary/5">
                        <TableHead>Name</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Interval</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plans.map((plan) => (
                        <TableRow key={plan.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{plan.name}</p>
                            {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
                          </TableCell>
                          <TableCell className="text-sm">{formatCurrency(plan.amount, plan.currency)}</TableCell>
                          <TableCell className="text-sm capitalize">
                            {plan.interval}
                            {plan.trial_days > 0 && <Badge variant="default" className="ml-2 text-[10px]">{plan.trial_days}d trial</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={plan.is_active ? 'success' : 'secondary'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge>
                              {plan.active_subscriptions > 0 && <Badge variant="info">{plan.active_subscriptions} sub{plan.active_subscriptions > 1 ? 's' : ''}</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditPlan(plan)}>Edit</Button>
                              <Button variant="ghost" size="sm" className={cn("h-7 text-xs", plan.is_active ? "text-amber-400" : "text-emerald-400")} onClick={() => handleTogglePlanActive(plan)}>
                                {plan.is_active ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400" disabled={plan.active_subscriptions > 0} onClick={() => handleDeletePlan(plan)}>Delete</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <Separator />

            {/* Current Subscription Status */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Current Subscription</h3>
              {subscriptionLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : subscription ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Status', value: <Badge variant={subscription.status === 'active' ? 'success' : subscription.status === 'past_due' ? 'destructive' : 'secondary'} className="capitalize">{subscription.status}</Badge> },
                    { label: 'Plan', value: <span className="capitalize">{subscription.plan_name}</span> },
                    { label: 'Amount', value: `${formatCurrency(subscription.amount, subscription.currency)}/${subscription.interval}` },
                    { label: 'Period', value: `${formatDate(subscription.current_period_start)} \u2013 ${formatDate(subscription.current_period_end)}` },
                    ...(subscription.card_last4 ? [{ label: 'Card', value: <span className="capitalize">{subscription.card_brand} **** {subscription.card_last4}</span> }] : []),
                    { label: 'Created', value: formatDate(subscription.created_at) },
                  ].map((item) => (
                    <div key={item.label} className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{item.label}</span>
                      <div className="text-sm">{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No active subscription. Plan: <span className="capitalize">{tenant.subscription_plan || 'basic'}</span></p>
              )}
            </div>

            {/* Invoices */}
            {invoices.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3">Invoices</h3>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary/5 hover:bg-primary/5">
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="text-sm">{invoice.invoice_number || '\u2014'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatDate(invoice.created_at)}</TableCell>
                            <TableCell className="text-sm">{formatCurrency(invoice.amount_due, invoice.currency)}</TableCell>
                            <TableCell>
                              <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'secondary'} className="capitalize">{invoice.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {invoice.stripe_hosted_invoice_url && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                    <a href={invoice.stripe_hosted_invoice_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 mr-1" />View</a>
                                  </Button>
                                )}
                                {invoice.stripe_invoice_pdf && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                    <a href={invoice.stripe_invoice_pdf} target="_blank" rel="noopener noreferrer"><Download className="w-3 h-3 mr-1" />PDF</a>
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Credits Detail Dialog */}
      <Dialog open={showCreditsDetail} onOpenChange={setShowCreditsDetail}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Credits Management</DialogTitle>
            <DialogDescription>View balances, adjust credits, and transaction history for {tenant.company_name}</DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <TenantCreditsTab tenantId={params.id as string} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Plan Modal */}
      <Dialog open={showPlanModal} onOpenChange={setShowPlanModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Edit Plan' : 'Add Plan'}</DialogTitle>
            {editingPlan && editingPlan.active_subscriptions > 0 && (
              <div className="rounded-lg px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-400 mt-2">
                This plan has {editingPlan.active_subscriptions} active subscriber{editingPlan.active_subscriptions > 1 ? 's' : ''}.
                Changing the price will only apply to new subscriptions.
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g., Starter, Pro, Enterprise"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Short description of the plan"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={planForm.amount}
                  onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })}
                  placeholder="200"
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={planForm.currency} onValueChange={(v) => setPlanForm({ ...planForm, currency: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd">USD</SelectItem>
                    <SelectItem value="gbp">GBP</SelectItem>
                    <SelectItem value="eur">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Interval</Label>
                <Select value={planForm.interval} onValueChange={(v) => setPlanForm({ ...planForm, interval: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Trial Period (days)</Label>
              <Input
                type="number"
                min="0"
                value={planForm.trialDays}
                onChange={(e) => setPlanForm({ ...planForm, trialDays: e.target.value })}
                placeholder="0 = no trial"
              />
              <p className="text-xs text-muted-foreground">Set to 0 for no trial. Customers enter card at checkout but aren&apos;t charged until trial ends.</p>
            </div>

            <div className="space-y-2">
              <Label>Features</Label>
              <div className="space-y-2">
                {planForm.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="flex-1 px-3 py-1.5 bg-muted/50 border border-border/40 rounded-md text-sm">
                      {feature}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400" onClick={() => removeFeature(index)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                    placeholder="Add a feature..."
                    className="text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={addFeature}>Add</Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlanModal(false)}>Cancel</Button>
            <Button onClick={handleSavePlan} disabled={planSaving}>
              {planSaving ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance Banner Dialog */}
      <Dialog open={showBannerDialog} onOpenChange={setShowBannerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Maintenance Banner
            </DialogTitle>
            <DialogDescription>
              Show a custom maintenance banner on this tenant&apos;s portal and booking site.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Enable Banner</Label>
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-medium", tenantBannerEnabled ? "text-amber-400" : "text-muted-foreground")}>
                  {tenantBannerEnabled ? 'Active' : 'Inactive'}
                </span>
                <Switch
                  checked={tenantBannerEnabled}
                  onCheckedChange={setTenantBannerEnabled}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Banner Message</Label>
              <Textarea
                value={tenantBannerMessage}
                onChange={(e) => setTenantBannerMessage(e.target.value)}
                rows={3}
                placeholder="Enter a custom maintenance message..."
              />
            </div>
            {tenantBannerEnabled && tenantBannerMessage && (
              <div className="rounded-lg px-4 py-3 text-sm font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400">
                {tenantBannerMessage}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBannerDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => { await handleSaveBanner(); setShowBannerDialog(false); }}
              disabled={bannerSaving}
            >
              {bannerSaving ? 'Saving...' : 'Save Banner Settings'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode Switch Confirmation */}
      <Dialog open={showModeConfirm} onOpenChange={(open) => { if (!open) { setShowModeConfirm(false); setPendingModeChange(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Switch to Live Mode?</DialogTitle>
            <DialogDescription>
              {pendingModeChange?.type === 'stripe'
                ? 'This will enable real payments for this tenant. Real money will be charged.'
                : 'This will use the production Bonzah API. Real insurance policies will be issued.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-400">
            Make sure everything is properly configured before switching.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowModeConfirm(false); setPendingModeChange(null); }}>Cancel</Button>
            <Button onClick={confirmModeChange}>Yes, Switch to Live</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Logout Confirmation */}
      <Dialog open={showForceLogoutConfirm} onOpenChange={setShowForceLogoutConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Force Logout All Users</DialogTitle>
            <DialogDescription>
              This will immediately sign out all portal staff and booking customers
              for <strong className="text-foreground">{tenant.company_name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-400">
            Users will need to sign in again to access their accounts.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceLogoutConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleForceLogout}
              disabled={forceLogoutLoading}
            >
              {forceLogoutLoading ? 'Logging out...' : 'Yes, Force Logout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => { if (!open) { setShowDeleteConfirm(false); setDeleteConfirmName(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Tenant</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg px-4 py-3 text-sm bg-red-500/10 border border-red-500/30 text-red-400 space-y-2">
            <p>
              This will permanently delete <strong>{tenant.company_name}</strong> and ALL associated data including vehicles, customers, rentals, payments, and users.
            </p>
            <p className="font-semibold">This action cannot be undone!</p>
          </div>
          <div className="space-y-2">
            <Label>
              Type <strong className="text-foreground">{tenant.company_name}</strong> to confirm:
            </Label>
            <Input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder="Enter company name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(''); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmName !== tenant.company_name}
            >
              {deleting ? 'Deleting...' : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
