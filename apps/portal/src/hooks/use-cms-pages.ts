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

      // .select("id") is load-bearing. The demote-to-draft in
      // use-cms-page-sections.ts is NOT tenant-filtered while this publish IS,
      // so the write that takes a page off the live site has wider reach than
      // the one that restores it. Without a row count, a publish that matched
      // ZERO rows (e.g. the shared global row, whose tenant_id is NULL) returned
      // error: null and still toasted "Your changes are now live on the
      // website" — while the page stayed draft and the site never updated.
      const { data: publishedRows, error } = await updateQuery.select("id");

      if (error) throw error;
      if (!publishedRows || publishedRows.length === 0) {
        throw new Error(
          "This page could not be published for your account. Please contact support."
        );
      }
    },
    onSuccess: (_data, pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      queryClient.invalidateQueries({ queryKey: ["cms-versions"] });
      // The editor screens render from ["cms-page", slug, tenantId] (useCMSPage),
      // which was NOT invalidated here — so after a successful publish the badge
      // still read "Draft" and the Publish button stayed enabled. That reads as
      // "publishing didn't work", and users click it again or give up. Prefix
      // invalidation covers every slug/tenant variant.
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
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

      // Filter by tenant if available. Prefer the tenant's OWN row over the
      // shared global (tenant_id IS NULL) one — same resolution getPageBySlug
      // uses in use-cms-page-sections.ts, so the editor, the writer and the
      // publisher can never disagree about which row is "the" page.
      if (tenant?.id) {
        query = query
          .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
          .order("tenant_id", { ascending: false, nullsFirst: false });
      }

      // .limit(1).maybeSingle() rather than .single(): this filter can legitimately
      // match TWO rows (the tenant's own AND the global fallback), and PostgREST
      // reports that as PGRST116 — the same code as "no rows". So .single() made a
      // perfectly healthy page render the dead-end "Site Settings page not found
      // in CMS. Please run the SQL migration" card.
      const { data, error } = await query.limit(1).maybeSingle();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return data as CMSPageWithSections;
    },
    enabled: !!slug && !!tenant,
  });
};
