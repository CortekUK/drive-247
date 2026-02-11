'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { ArrowLeft, Pencil, Trash2, Copy, ExternalLink, Download } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
  integration_canopy: boolean;
  integration_veriff: boolean;
  integration_bonzah: boolean;
  subscription_plan: string | null;
  stripe_subscription_customer_id: string | null;
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

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
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
    features: [],
  });
  const [newFeature, setNewFeature] = useState('');

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

      // Load subscription data and plans
      loadSubscription(id);
      loadPlans(id);
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
      // Load active subscription
      const { data: subData } = await supabase
        .from('tenant_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'trialing', 'past_due'])
        .maybeSingle();

      setSubscription(subData);

      // Load invoices
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

      // Fetch active subscription counts per plan
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
        // Update
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
        // Create
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
        toast.success(`"${planForm.name}" plan created — tenant can now subscribe from their portal`);
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
        toast.success(`"${plan.name}" deactivated — no longer visible to new subscribers`);
      } else {
        toast.success(`"${plan.name}" activated — now visible to the tenant in their portal`);
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

  const handleToggleIntegration = async (integration: 'canopy' | 'veriff' | 'bonzah', enabled: boolean) => {
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

    // Sanitize slug
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

  const handleDelete = async () => {
    if (!tenant || deleteConfirmName !== tenant.company_name) {
      toast.error('Company name does not match');
      return;
    }

    setDeleting(true);

    try {
      // Use the edge function to delete tenant and all associated data including auth users
      const { data, error } = await supabase.functions.invoke('admin-delete-tenant', {
        body: { tenant_id: tenant.id }
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      // Log what was deleted
      console.log('Deletion results:', data?.deletionResults);
      console.log('Deleted auth users:', data?.deletedAuthUsers);

      toast.success('Tenant and all associated data deleted successfully!');
      router.push('/admin/rentals');
    } catch (error: any) {
      toast.error(`Error deleting tenant: ${error.message}`);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-dark-card rounded w-48 mb-4"></div>
          <div className="h-4 bg-dark-card rounded w-96 mb-8"></div>
          <div className="h-64 bg-dark-card rounded"></div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">Tenant not found</p>
          <button
            onClick={() => router.push('/admin/rentals')}
            className="mt-4 text-primary-400 hover:text-primary-300"
          >
            Back to Rental Companies
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-auto">
      <button
        onClick={() => router.push('/admin/rentals')}
        className="flex items-center text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rental Companies
      </button>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-white">{tenant.company_name}</h1>
            <span className={`px-4 py-1.5 text-sm font-bold rounded-full uppercase tracking-wide ${
              tenant.tenant_type === 'production'
                ? 'bg-green-600 text-white'
                : tenant.tenant_type === 'test'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-600 text-white'
            }`}>
              {tenant.tenant_type || 'Not Set'}
            </span>
            <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
              tenant.status === 'active'
                ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                : 'bg-red-900/30 text-red-400 border border-red-800/50'
            }`}>
              {tenant.status}
            </span>
          </div>
        </div>
        <p className="text-gray-400 mb-4">Tenant Details</p>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-dark-card rounded-lg p-1 border border-dark-border">
            <button
              onClick={() => handleUpdateType('production')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tenant.tenant_type === 'production'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Production
            </button>
            <button
              onClick={() => handleUpdateType('test')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tenant.tenant_type === 'test'
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Test
            </button>
          </div>

          <button
            onClick={() => handleUpdateStatus(tenant.status === 'active' ? 'suspended' : 'active')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              tenant.status === 'active'
                ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {tenant.status === 'active' ? 'Suspend' : 'Activate'}
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company Information */}
            <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Company Information</h2>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center text-primary-400 hover:text-primary-300 text-sm"
                  >
                    <Pencil className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Company Name</label>
                    <input
                      type="text"
                      value={editForm.company_name}
                      onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Admin Name</label>
                    <input
                      type="text"
                      value={editForm.admin_name}
                      onChange={(e) => setEditForm({ ...editForm, admin_name: e.target.value })}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Slug (subdomain)</label>
                    <input
                      type="text"
                      value={editForm.slug}
                      onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="text-xs text-yellow-500 mt-1">
                      Warning: Changing the slug will change the portal and booking URLs
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
                    <input
                      type="email"
                      value={editForm.contact_email}
                      onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditForm({
                          company_name: tenant.company_name,
                          admin_name: tenant.admin_name || '',
                          slug: tenant.slug,
                          contact_email: tenant.contact_email,
                        });
                      }}
                      className="px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Company Name</label>
                    <p className="text-white">{tenant.company_name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Admin Name</label>
                    <p className="text-white">{tenant.admin_name || <span className="text-gray-500">Not set</span>}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Slug</label>
                    <p className="text-white">{tenant.slug}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
                    <p className="text-white">{tenant.contact_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Created</label>
                    <p className="text-white">
                      {new Date(tenant.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Access URLs */}
            <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
              <h2 className="text-xl font-semibold text-white mb-4">Access URLs</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Portal URL (Admin Dashboard)</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-dark-bg px-3 py-2 rounded border border-dark-border text-sm text-primary-400 break-all">
                      https://{tenant.slug}.portal.drive-247.com
                    </code>
                    <button
                      onClick={() => copyToClipboard(`https://${tenant.slug}.portal.drive-247.com`, 'Portal URL')}
                      className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Booking URL (Customer Facing)</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-dark-bg px-3 py-2 rounded border border-dark-border text-sm text-primary-400 break-all">
                      https://{tenant.slug}.drive-247.com
                    </code>
                    <button
                      onClick={() => copyToClipboard(`https://${tenant.slug}.drive-247.com`, 'Booking URL')}
                      className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Integrations */}
            <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
              <h2 className="text-xl font-semibold text-white mb-4">Integrations</h2>
              <p className="text-sm text-gray-400 mb-6">Enable or disable third-party integrations for this tenant</p>

              <div className="space-y-4">
                {/* Canopy */}
                <div className="flex items-center justify-between py-3 border-b border-dark-border">
                  <div>
                    <h3 className="text-white font-medium">Canopy</h3>
                    <p className="text-sm text-gray-400">Insurance verification service</p>
                  </div>
                  <button
                    onClick={() => handleToggleIntegration('canopy', !tenant.integration_canopy)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      tenant.integration_canopy ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        tenant.integration_canopy ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Veriff */}
                <div className="flex items-center justify-between py-3 border-b border-dark-border">
                  <div>
                    <h3 className="text-white font-medium">Veriff</h3>
                    <p className="text-sm text-gray-400">Identity verification service</p>
                  </div>
                  <button
                    onClick={() => handleToggleIntegration('veriff', !tenant.integration_veriff)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      tenant.integration_veriff ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        tenant.integration_veriff ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Bonzah */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <h3 className="text-white font-medium">Bonzah</h3>
                    <p className="text-sm text-gray-400">Insurance integration</p>
                  </div>
                  <button
                    onClick={() => handleToggleIntegration('bonzah', !tenant.integration_bonzah)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      tenant.integration_bonzah ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        tenant.integration_bonzah ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-dark-card rounded-lg p-6 border border-dark-border lg:col-span-2">
              <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
              <div className="flex flex-wrap gap-3">
                <a
                  href={`https://${tenant.slug}.portal.drive-247.com`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
                >
                  Open Portal
                </a>
                <a
                  href={`https://${tenant.slug}.drive-247.com`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-dark-hover text-white rounded-lg hover:bg-dark-border border border-dark-border text-sm font-medium"
                >
                  Open Booking Site
                </a>
                <a
                  href={`mailto:${tenant.contact_email}`}
                  className="px-4 py-2 bg-dark-hover text-white rounded-lg hover:bg-dark-border border border-dark-border text-sm font-medium"
                >
                  Email Contact
                </a>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Subscription Tab */}
        <TabsContent value="subscription">
          {/* Subscription Plans Management */}
          <div className="mb-6 bg-dark-card rounded-lg p-6 border border-dark-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Subscription Plans</h2>
              <button
                onClick={openAddPlan}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
              >
                + Add Plan
              </button>
            </div>

            {plansLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-10 bg-dark-bg rounded"></div>
                <div className="h-10 bg-dark-bg rounded"></div>
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-2">No subscription plans configured</p>
                <p className="text-sm text-gray-500">Add a plan to enable subscriptions for this tenant</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-dark-border">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Name</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Interval</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Features</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan) => (
                      <tr key={plan.id} className="border-b border-dark-border last:border-0">
                        <td className="py-3 pr-4">
                          <p className="text-white font-medium">{plan.name}</p>
                          {plan.description && (
                            <p className="text-xs text-gray-400 mt-0.5">{plan.description}</p>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-white">
                          {formatCurrency(plan.amount, plan.currency)}
                        </td>
                        <td className="py-3 pr-4 text-gray-300 capitalize">
                          {plan.interval}
                          {plan.trial_days > 0 && (
                            <span className="ml-2 inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-900/30 text-purple-400">
                              {plan.trial_days}-day trial
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-gray-300 text-sm">
                          {plan.features.length} feature{plan.features.length !== 1 ? 's' : ''}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                              plan.is_active
                                ? 'bg-green-900/30 text-green-400'
                                : 'bg-gray-900/30 text-gray-400'
                            }`}>
                              {plan.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {plan.active_subscriptions > 0 && (
                              <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-900/30 text-blue-400">
                                {plan.active_subscriptions} subscriber{plan.active_subscriptions > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditPlan(plan)}
                              className="text-primary-400 hover:text-primary-300 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleTogglePlanActive(plan)}
                              className={`text-sm ${plan.is_active ? 'text-yellow-400 hover:text-yellow-300' : 'text-green-400 hover:text-green-300'}`}
                            >
                              {plan.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan)}
                              disabled={plan.active_subscriptions > 0}
                              className={`text-sm ${plan.active_subscriptions > 0 ? 'text-gray-600 cursor-not-allowed' : 'text-red-400 hover:text-red-300'}`}
                              title={plan.active_subscriptions > 0 ? 'Cannot delete a plan with active subscribers — deactivate it instead' : 'Permanently delete this plan'}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {subscriptionLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-32 bg-dark-card rounded-lg"></div>
              <div className="h-64 bg-dark-card rounded-lg"></div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Subscription Status */}
              <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
                <h2 className="text-xl font-semibold text-white mb-4">Subscription Status</h2>

                {subscription ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                        <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full capitalize ${
                          subscription.status === 'active'
                            ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                            : subscription.status === 'past_due'
                            ? 'bg-red-900/30 text-red-400 border border-red-800/50'
                            : 'bg-gray-900/30 text-gray-400 border border-gray-800/50'
                        }`}>
                          {subscription.status}
                        </span>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Plan</label>
                        <p className="text-white capitalize">{subscription.plan_name}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Amount</label>
                        <p className="text-white">
                          {formatCurrency(subscription.amount, subscription.currency)}/{subscription.interval}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Current Period</label>
                        <p className="text-white">
                          {formatDate(subscription.current_period_start)} – {formatDate(subscription.current_period_end)}
                        </p>
                      </div>
                      {subscription.card_last4 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">Payment Method</label>
                          <p className="text-white capitalize">
                            {subscription.card_brand} **** {subscription.card_last4} ({subscription.card_exp_month}/{subscription.card_exp_year})
                          </p>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Created</label>
                        <p className="text-white">{formatDate(subscription.created_at)}</p>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-400 mb-2">No active subscription</p>
                    <p className="text-sm text-gray-500">
                      Plan: <span className="capitalize">{tenant.subscription_plan || 'basic'}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Invoices */}
              <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
                <h2 className="text-xl font-semibold text-white mb-4">Invoices</h2>

                {invoices.length === 0 ? (
                  <p className="text-gray-400 text-center py-6">No invoices</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-dark-border">
                          <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Invoice</th>
                          <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Date</th>
                          <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                          <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                          <th className="text-left py-2 pr-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((invoice) => (
                          <tr key={invoice.id} className="border-b border-dark-border last:border-0">
                            <td className="py-3 pr-4 text-sm text-white">{invoice.invoice_number || '—'}</td>
                            <td className="py-3 pr-4 text-sm text-gray-300">{formatDate(invoice.created_at)}</td>
                            <td className="py-3 pr-4 text-sm text-white">{formatCurrency(invoice.amount_due, invoice.currency)}</td>
                            <td className="py-3 pr-4">
                              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full capitalize ${
                                invoice.status === 'paid'
                                  ? 'bg-green-900/30 text-green-400'
                                  : invoice.status === 'open'
                                  ? 'bg-yellow-900/30 text-yellow-400'
                                  : 'bg-gray-900/30 text-gray-400'
                              }`}>
                                {invoice.status}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-sm">
                              <div className="flex items-center gap-3">
                                {invoice.stripe_hosted_invoice_url && (
                                  <a
                                    href={invoice.stripe_hosted_invoice_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    View
                                  </a>
                                )}
                                {invoice.stripe_invoice_pdf && (
                                  <a
                                    href={invoice.stripe_invoice_pdf}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    PDF
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-card rounded-lg p-6 max-w-lg w-full border border-dark-border max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">
              {editingPlan ? 'Edit Plan' : 'Add Plan'}
            </h2>

            {editingPlan && editingPlan.active_subscriptions > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-400">
                  This plan has {editingPlan.active_subscriptions} active subscriber{editingPlan.active_subscriptions > 1 ? 's' : ''}.
                  Changing the name, description, or features will update immediately.
                  Changing the price will only apply to new subscriptions — existing subscribers will continue at their current rate.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Plan Name</label>
                <input
                  type="text"
                  value={planForm.name}
                  onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., Starter, Pro, Enterprise"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                <input
                  type="text"
                  value={planForm.description}
                  onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Short description of the plan"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={planForm.amount}
                    onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })}
                    className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Currency</label>
                  <select
                    value={planForm.currency}
                    onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value })}
                    className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="usd">USD</option>
                    <option value="gbp">GBP</option>
                    <option value="eur">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Interval</label>
                  <select
                    value={planForm.interval}
                    onChange={(e) => setPlanForm({ ...planForm, interval: e.target.value })}
                    className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Trial Period (days)</label>
                <input
                  type="number"
                  min="0"
                  value={planForm.trialDays}
                  onChange={(e) => setPlanForm({ ...planForm, trialDays: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="0 = no trial"
                />
                <p className="text-xs text-gray-500 mt-1">Set to 0 for no trial. Customers enter card at checkout but aren't charged until trial ends.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Features</label>
                <div className="space-y-2">
                  {planForm.features.map((feature, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="flex-1 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-md text-white text-sm">
                        {feature}
                      </span>
                      <button
                        onClick={() => removeFeature(index)}
                        className="text-red-400 hover:text-red-300 text-sm px-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newFeature}
                      onChange={(e) => setNewFeature(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                      className="flex-1 px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      placeholder="Add a feature..."
                    />
                    <button
                      onClick={addFeature}
                      className="px-3 py-2 bg-dark-hover text-white rounded-md hover:bg-dark-border border border-dark-border text-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex space-x-3 pt-4 mt-4 border-t border-dark-border">
              <button
                onClick={() => setShowPlanModal(false)}
                className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePlan}
                disabled={planSaving}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {planSaving ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-card rounded-lg p-6 max-w-md w-full border border-dark-border">
            <h2 className="text-xl font-bold text-white mb-2">Delete Tenant</h2>
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-400">
                This will permanently delete <strong>{tenant.company_name}</strong> and ALL associated data including vehicles, customers, rentals, payments, and users.
              </p>
              <p className="text-sm text-red-400 mt-2 font-semibold">
                This action cannot be undone!
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Type <strong className="text-white">{tenant.company_name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Enter company name"
              />
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName('');
                }}
                className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmName !== tenant.company_name}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
