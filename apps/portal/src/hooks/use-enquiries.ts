"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";

export type EnquiryStatus = "new" | "contacted" | "resolved" | "archived";

export interface Enquiry {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_id: string | null;
  start_date: string;
  end_date: string;
  description: string;
  status: EnquiryStatus;
  is_read: boolean;
  read_at: string | null;
  read_by: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  vehicle?: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
  } | null;
  customer?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

export interface EnquiriesFilter {
  status?: EnquiryStatus[];
  search?: string;
}

const VEHICLE_FRAGMENT = "vehicle:vehicles(id, reg, make, model)";
const CUSTOMER_FRAGMENT = "customer:customers(id, name, email, phone)";

export function useEnquiries(filter: EnquiriesFilter = {}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["enquiries", tenant?.id, filter];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!tenant?.id) return [];
      let q = supabase
        .from("enquiries")
        .select(`*, ${VEHICLE_FRAGMENT}, ${CUSTOMER_FRAGMENT}`)
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (filter.status && filter.status.length > 0) {
        q = q.in("status", filter.status);
      }
      if (filter.search && filter.search.trim()) {
        const term = `%${filter.search.trim()}%`;
        q = q.or(
          `customer_name.ilike.${term},customer_email.ilike.${term},customer_phone.ilike.${term},description.ilike.${term}`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Enquiry[];
    },
    enabled: !!tenant?.id,
    staleTime: 60 * 1000,
  });

  // Realtime: invalidate on any change to enquiries for this tenant.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`enquiries:${tenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "enquiries",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["enquiries", tenant.id] });
          queryClient.invalidateQueries({ queryKey: ["enquiry-stats", tenant.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id, queryClient]);

  return query;
}

export function useEnquiry(id: string | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["enquiry", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("enquiries")
        .select(`*, ${VEHICLE_FRAGMENT}, ${CUSTOMER_FRAGMENT}`)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as Enquiry;
    },
    enabled: !!id && !!tenant?.id,
  });
}

export function useUpdateEnquiryStatus() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: EnquiryStatus;
    }) => {
      const update: Record<string, unknown> = { status };
      // Mark as read whenever status moves out of 'new'.
      if (status !== "new") {
        update.is_read = true;
        update.read_at = new Date().toISOString();
        if (appUser?.id) update.read_by = appUser.id;
      }
      const { error } = await supabase
        .from("enquiries")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enquiries", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["enquiry-stats", tenant?.id] });
      toast({ title: "Enquiry updated" });
    },
    onError: (err) => {
      toast({
        title: "Failed to update enquiry",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });
}

export function useMarkEnquiryRead() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("enquiries")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          read_by: appUser?.id ?? null,
        })
        .eq("id", id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enquiries", tenant?.id] });
    },
  });
}

/**
 * Resolves a customer record to use when starting a Messages conversation
 * for an enquiry. If the enquiry already references a customer, returns
 * that. Otherwise looks up by email; if still not found, creates a minimal
 * lead-style customer record and back-links it on the enquiry.
 */
export function useResolveEnquiryCustomer() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (enquiryId: string) => {
      if (!tenant?.id) throw new Error("Tenant not loaded");

      const { data: enquiry, error: fetchError } = await supabase
        .from("enquiries")
        .select("id, tenant_id, customer_id, customer_name, customer_email, customer_phone")
        .eq("id", enquiryId)
        .single();
      if (fetchError || !enquiry) throw fetchError ?? new Error("Enquiry not found");

      if (enquiry.customer_id) return { customerId: enquiry.customer_id };

      const email = enquiry.customer_email.trim().toLowerCase();
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", enquiry.tenant_id)
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      let customerId = existing?.id ?? null;

      if (!customerId) {
        const { data: created, error: createError } = await supabase
          .from("customers")
          .insert({
            tenant_id: enquiry.tenant_id,
            type: "Individual",
            customer_type: "Individual",
            name: enquiry.customer_name,
            email,
            phone: enquiry.customer_phone,
            status: "Active",
          })
          .select("id")
          .single();
        if (createError || !created) throw createError ?? new Error("Failed to create customer");
        customerId = created.id;
      }

      await supabase
        .from("enquiries")
        .update({ customer_id: customerId })
        .eq("id", enquiry.id);

      return { customerId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enquiries", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["customers", tenant?.id] });
    },
    onError: (err) => {
      toast({
        title: "Couldn't open chat",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });
}
