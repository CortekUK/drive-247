import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CMSPage, CMSPageWithSections } from "@/types/cms";

export const useCMSPages = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all CMS pages
  const { data: pages = [], isLoading, error } = useQuery({
    queryKey: ["cms-pages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cms_pages")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return data as CMSPage[];
    },
  });

  // Fetch single page with sections
  const getPageWithSections = async (slug: string): Promise<CMSPageWithSections | null> => {
    const { data, error } = await supabase
      .from("cms_pages")
      .select(`
        *,
        cms_page_sections(*)
      `)
      .eq("slug", slug)
      .single();

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
      const { data: sections } = await supabase
        .from("cms_page_sections")
        .select("*")
        .eq("page_id", pageId);

      // Get last version number
      const { data: lastVersion } = await supabase
        .from("cms_page_versions")
        .select("version_number")
        .eq("page_id", pageId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();

      const nextVersion = (lastVersion?.version_number || 0) + 1;

      // Get user's app_user id
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user?.id)
        .single();

      // Create version snapshot
      await supabase.from("cms_page_versions").insert({
        page_id: pageId,
        version_number: nextVersion,
        content: sections,
        created_by: appUser?.id || null,
        notes: `Published version ${nextVersion}`,
      });

      // Update page status
      const { error } = await supabase
        .from("cms_pages")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          published_by: appUser?.id || null,
        })
        .eq("id", pageId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Published",
        description: "Your changes are now live on the website.",
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
      const { error } = await supabase
        .from("cms_pages")
        .update({
          status: "draft",
          published_at: null,
          published_by: null,
        })
        .eq("id", pageId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Unpublished",
        description: "Page is now in draft mode.",
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

  return {
    pages,
    isLoading,
    error,
    getPageWithSections,
    publishPage: publishPageMutation.mutate,
    unpublishPage: unpublishPageMutation.mutate,
    isPublishing: publishPageMutation.isPending,
    isUnpublishing: unpublishPageMutation.isPending,
  };
};

// Hook for fetching a single page
export const useCMSPage = (slug: string) => {
  return useQuery({
    queryKey: ["cms-page", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cms_pages")
        .select(`
          *,
          cms_page_sections(*)
        `)
        .eq("slug", slug)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return data as CMSPageWithSections;
    },
    enabled: !!slug,
  });
};
