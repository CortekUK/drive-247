/**
 * NewLeadDialog — Manual lead creation from the portal kanban "+ New Lead" button.
 * Spec §6.3: top-bar "+ New Lead (manual creation)".
 *
 * Inserts a leads row with source='admin_manual' and creates the conversation row
 * directly (bypasses submit-application — operator is the actor, no honeypot/score
 * checks needed; operator is trusted).
 */
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewLeadDialog({ open, onOpenChange }: Props) {
  const { tenant } = useTenant();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    source: "phone_in" as "phone_in" | "walk_in" | "admin_manual",
    rentalLengthTarget: "weekly" as "daily" | "weekly" | "monthly",
    startDate: "",
    endDate: "",
    notes: "",
  });

  const handleSubmit = async () => {
    if (!tenant?.id) {
      toast.error("Tenant not loaded yet");
      return;
    }
    if (!form.fullName.trim() || !form.email.trim() || !form.phone.trim()) {
      toast.error("Name, email, and phone are required");
      return;
    }
    setSubmitting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lead, error } = await (supabase.from("leads") as any)
        .insert({
          tenant_id: tenant.id,
          full_name: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          application_data: {
            notes: form.notes,
            submissions: [{ submittedAt: new Date().toISOString(), source: form.source }],
          },
          stage: "new",
          source: form.source,
          rental_type: form.rentalLengthTarget,
          start_date: form.startDate || null,
          end_date: form.endDate || null,
        })
        .select("id")
        .single();

      if (error) throw error;
      if (!lead) throw new Error("Insert returned no row");

      // Create the conversation row so the workspace doesn't have to wait
      await supabase.from("conversations").insert({
        tenant_id: tenant.id,
        lead_id: lead.id,
      });

      await supabase.from("lead_activity").insert({
        tenant_id: tenant.id,
        lead_id: lead.id,
        actor_type: "staff",
        event_type: "manual_creation",
        payload: { source: form.source, notes: form.notes || undefined },
      });

      toast.success("Lead created");
      onOpenChange(false);
      setForm({
        fullName: "",
        email: "",
        phone: "",
        source: "phone_in",
        rentalLengthTarget: "weekly",
        startDate: "",
        endDate: "",
        notes: "",
      });
      router.push(`/leads/${lead.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>
            Create a lead manually — for phone-in enquiries, walk-ins, or anything else
            you want to track in the pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="John Smith"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+15551234567"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={form.source}
                onValueChange={(v) => setForm({ ...form, source: v as typeof form.source })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone_in">Phone-in</SelectItem>
                  <SelectItem value="walk_in">Walk-in</SelectItem>
                  <SelectItem value="admin_manual">Admin-created</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rental length</Label>
              <Select
                value={form.rentalLengthTarget}
                onValueChange={(v) => setForm({ ...form, rentalLengthTarget: v as typeof form.rentalLengthTarget })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pickup date (optional)</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Return date (optional)</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Initial notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="What did they ask about? Any context for the team."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…</>
            ) : (
              "Create lead"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
