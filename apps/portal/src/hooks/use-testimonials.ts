import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

export interface Testimonial {
  id: string;
  author: string;
  company_name: string;
  stars: number;
  review: string;
  created_at: string;
  created_by?: string;
  updated_at?: string;
}

export interface AddTestimonialData {
  author: string;
  company_name: string;
  stars: number;
  review: string;
}

export interface UpdateTestimonialData {
  author?: string;
  company_name?: string;
  stars?: number;
  review?: string;
}

export const useTestimonials = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  // Fetch testimonials
  const { data: testimonials = [], isLoading } = useQuery({
    queryKey: ["testimonials", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("testimonials")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Testimonial[];
    },
    enabled: !!tenant,
  });

  // Add testimonial mutation
  const addTestimonialMutation = useMutation({
    mutationFn: async (data: AddTestimonialData) => {
      if (!tenant) throw new Error("No tenant context available");

      const { data: inserted, error } = await supabase.from("testimonials").insert({
        author: data.author,
        company_name: data.company_name,
        stars: data.stars,
        review: data.review,
        tenant_id: tenant.id,
      }).select();

      if (error) throw error;
      return { inserted, testimonial: data };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["testimonials"] });
      toast({
        title: "Testimonial Added",
        description: "The testimonial has been successfully added.",
      });
      logAction({ action: "testimonial_created", entityType: "testimonial", entityId: result.inserted[0].id, details: { name: result.testimonial.author } });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add testimonial. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update testimonial mutation
  const updateTestimonialMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTestimonialData }) => {
      let query = supabase
        .from("testimonials")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
      return { id };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["testimonials"] });
      toast({
        title: "Testimonial Updated",
        description: "The testimonial has been successfully updated.",
      });
      logAction({ action: "testimonial_updated", entityType: "testimonial", entityId: result.id, details: {} });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update testimonial. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete testimonial mutation
  const deleteTestimonialMutation = useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from("testimonials")
        .delete()
        .eq("id", id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
      return { id };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["testimonials"] });
      toast({
        title: "Testimonial Deleted",
        description: "The testimonial has been successfully deleted.",
      });
      logAction({ action: "testimonial_deleted", entityType: "testimonial", entityId: result.id, details: {} });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete testimonial. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    testimonials,
    isLoading,
    addTestimonial: addTestimonialMutation.mutate,
    updateTestimonial: updateTestimonialMutation.mutate,
    deleteTestimonial: deleteTestimonialMutation.mutate,
    isAdding: addTestimonialMutation.isPending,
    isUpdating: updateTestimonialMutation.isPending,
    isDeleting: deleteTestimonialMutation.isPending,
  };
};
