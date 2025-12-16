import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, ShieldCheck, Crown, Plus, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { AddProtectionPlanDialog } from "./add-protection-plan-dialog";
import { EditProtectionPlanDialog } from "./edit-protection-plan-dialog";

interface ProtectionPlan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_per_day: number;
  price_per_week: number | null;
  price_per_month: number | null;
  deductible_amount: number;
  max_coverage_amount: number | null;
  tier: 'basic' | 'standard' | 'premium' | 'ultimate';
  is_active: boolean;
  display_order: number;
  icon_name: string | null;
  color_theme: string | null;
  features: any;
  exclusions: any;
  coverage_details: any;
  created_at: string;
  updated_at: string;
}

const TierBadge = ({ tier }: { tier: string }) => {
  const getTierVariant = () => {
    switch (tier) {
      case 'basic':
        return { variant: 'secondary' as const, label: 'Basic' };
      case 'standard':
        return { variant: 'default' as const, label: 'Standard' };
      case 'premium':
        return { variant: 'default' as const, label: 'Premium', className: 'bg-[#C5A572] text-black hover:bg-[#C5A572]/90' };
      case 'ultimate':
        return { variant: 'default' as const, label: 'Ultimate', className: 'bg-gradient-to-r from-purple-600 to-pink-600' };
      default:
        return { variant: 'outline' as const, label: tier };
    }
  };

  const tierInfo = getTierVariant();
  return (
    <Badge variant={tierInfo.variant} className={tierInfo.className || ''}>
      {tierInfo.label}
    </Badge>
  );
};

const TierIcon = ({ tier, className }: { tier: string; className?: string }) => {
  switch (tier) {
    case 'basic':
      return <Shield className={className} />;
    case 'standard':
      return <ShieldCheck className={className} />;
    case 'premium':
    case 'ultimate':
      return <Crown className={className} />;
    default:
      return <Shield className={className} />;
  }
};

export const ProtectionPlansManagement = () => {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ProtectionPlan | null>(null);
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery({
    queryKey: ["protection_plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protection_plans")
        .select("*")
        .order("display_order", { ascending: true });

      if (error) throw error;
      return data as ProtectionPlan[];
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("protection_plans")
        .update({ is_active: !is_active })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["protection_plans"] });
      toast.success("Protection plan status updated");
    },
    onError: (error: any) => {
      toast.error("Failed to update status: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("protection_plans")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["protection_plans"] });
      toast.success("Protection plan deleted successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to delete: " + error.message);
    },
  });

  const handleToggleActive = (plan: ProtectionPlan) => {
    toggleActiveMutation.mutate({ id: plan.id, is_active: plan.is_active });
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Protection Plans</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">Loading protection plans...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-6 h-6 text-[#C5A572]" />
                Protection Plans
              </CardTitle>
              <CardDescription>
                Manage insurance and protection coverage options for rentals (Bonzah-style)
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddDialog(true)} className="bg-[#C5A572] text-black hover:bg-[#C5A572]/90">
              <Plus className="w-4 h-4 mr-2" />
              Add Protection Plan
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!plans || plans.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">No protection plans configured</p>
              <Button onClick={() => setShowAddDialog(true)} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Create First Plan
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Deductible</TableHead>
                  <TableHead>Max Coverage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id} className={!plan.is_active ? 'opacity-50' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg`} style={{ backgroundColor: plan.color_theme + '20' || '#60A5FA20' }}>
                          <TierIcon tier={plan.tier} className="w-5 h-5" style={{ color: plan.color_theme || '#60A5FA' }} />
                        </div>
                        <div>
                          <div className="font-semibold">{plan.display_name}</div>
                          <div className="text-sm text-muted-foreground">{plan.description}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={plan.tier} />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        <div className="font-semibold">${plan.price_per_day}/day</div>
                        {plan.price_per_week && <div className="text-muted-foreground">${plan.price_per_week}/week</div>}
                        {plan.price_per_month && <div className="text-muted-foreground">${plan.price_per_month}/month</div>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {plan.deductible_amount === 0 ? (
                        <Badge variant="default" className="bg-green-600">ZERO</Badge>
                      ) : (
                        <span className="text-sm">${plan.deductible_amount.toLocaleString()}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {plan.max_coverage_amount ? (
                        <span className="text-sm font-medium">${plan.max_coverage_amount.toLocaleString()}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Unlimited</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(plan)}
                          title={plan.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {plan.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPlan(plan)}
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(plan.id, plan.display_name)}
                          title="Delete"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddProtectionPlanDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
      />

      {editingPlan && (
        <EditProtectionPlanDialog
          open={!!editingPlan}
          onOpenChange={(open) => !open && setEditingPlan(null)}
          plan={editingPlan}
        />
      )}
    </>
  );
};
