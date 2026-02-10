import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { CMSPage, CMSPageWithSections } from "@/types/cms";

export const useCMSPages = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  // Fetch all CMS pages for the current tenant
  const { data: pages = [], isLoading, error } = useQuery({
    queryKey: ["cms-pages", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("cms_pages")
        .select("*")
        .order("name", { ascending: true });

      // Filter by tenant if available
      if (tenant?.id) {
        query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as CMSPage[];
    },
    enabled: !!tenant,
  });

  // Fetch single page with sections (filtered by tenant)
  const getPageWithSections = async (slug: string): Promise<CMSPageWithSections | null> => {
    let query = supabase
      .from("cms_pages")
      .select(`
        *,
        cms_page_sections(*)
      `)
      .eq("slug", slug);

    // Filter by tenant if available
    if (tenant?.id) {
      query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return data as CMSPageWithSections;
  };

  // Publish page mutation
  const publishPageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Get current sections for version snapshot
      let sectionsQuery = supabase
        .from("cms_page_sections")
        .select("*")
        .eq("page_id", pageId);

      if (tenant?.id) {
        sectionsQuery = sectionsQuery.eq("tenant_id", tenant.id);
      }

      const { data: sections } = await sectionsQuery;

      // Get last version number
      let versionQuery = supabase
        .from("cms_page_versions")
        .select("version_number")
        .eq("page_id", pageId)
        .order("version_number", { ascending: false })
        .limit(1);

      if (tenant?.id) {
        versionQuery = versionQuery.eq("tenant_id", tenant.id);
      }

      const { data: lastVersion } = await versionQuery.single();

      const nextVersion = (lastVersion?.version_number || 0) + 1;

      // Get user's app_user id
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user?.id)
        .single();

      // Create version snapshot with tenant_id
      await supabase.from("cms_page_versions").insert({
        page_id: pageId,
        version_number: nextVersion,
        content: sections,
        created_by: appUser?.id || null,
        notes: `Published version ${nextVersion}`,
        tenant_id: tenant?.id || null,
      });

      // Update page status
      let updateQuery = supabase
        .from("cms_pages")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          published_by: appUser?.id || null,
        })
        .eq("id", pageId);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await updateQuery;

      if (error) throw error;
    },
    onSuccess: (_data, pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Published",
        description: "Your changes are now live on the website.",
      });
      logAction({
        action: "cms_page_published",
        entityType: "cms_page",
        entityId: pageId,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to publish page.",
        variant: "destructive",
      });
    },
  });

  // Unpublish (revert to draft) mutation
  const unpublishPageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      let updateQuery = supabase
        .from("cms_pages")
        .update({
          status: "draft",
          published_at: null,
          published_by: null,
        })
        .eq("id", pageId);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await updateQuery;

      if (error) throw error;
    },
    onSuccess: (_data, pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Unpublished",
        description: "Page is now in draft mode.",
      });
      logAction({
        action: "cms_page_unpublished",
        entityType: "cms_page",
        entityId: pageId,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unpublish page.",
        variant: "destructive",
      });
    },
  });

  // Create a new page mutation (with tenant_id)
  const createPageMutation = useMutation({
    mutationFn: async ({
      slug,
      name,
      description,
    }: {
      slug: string;
      name: string;
      description?: string;
    }) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("cms_pages")
        .insert({
          slug,
          name,
          description: description || null,
          status: "draft",
          tenant_id: tenant.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CMSPage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Created",
        description: "New CMS page has been created.",
      });
      logAction({
        action: "cms_page_created",
        entityType: "cms_page",
        entityId: data.id,
        details: { slug: data.slug, name: data.name },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create page.",
        variant: "destructive",
      });
    },
  });

  return {
    pages,
    isLoading,
    error,
    tenant,
    getPageWithSections,
    createPage: createPageMutation.mutate,
    createPageAsync: createPageMutation.mutateAsync,
    publishPage: publishPageMutation.mutate,
    unpublishPage: unpublishPageMutation.mutate,
    isCreating: createPageMutation.isPending,
    isPublishing: publishPageMutation.isPending,
    isUnpublishing: unpublishPageMutation.isPending,
  };
};

// Hook for fetching a single page (filtered by tenant)
export const useCMSPage = (slug: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["cms-page", slug, tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("cms_pages")
        .select(`
          *,
          cms_page_sections(*)
        `)
        .eq("slug", slug);

      // Filter by tenant if available
      if (tenant?.id) {
        query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return data as CMSPageWithSections;
    },
    enabled: !!slug && !!tenant,
  });
};
