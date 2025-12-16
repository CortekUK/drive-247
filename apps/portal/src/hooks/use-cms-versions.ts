import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CMSPageVersion } from "@/types/cms";

export const useCMSVersions = (pageSlug: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all versions for a page
  const { data: versions = [], isLoading, error } = useQuery({
    queryKey: ["cms-versions", pageSlug],
    queryFn: async () => {
      // First get the page id
      const { data: page, error: pageError } = await supabase
        .from("cms_pages")
        .select("id")
        .eq("slug", pageSlug)
        .single();

      if (pageError) {
        if (pageError.code === "PGRST116") return [];
        throw pageError;
      }

      // Get versions
      const { data, error } = await supabase
        .from("cms_page_versions")
        .select(`
          *,
          
        `)
        .eq("page_id", page.id)
        .order("version_number", { ascending: false });

      if (error) throw error;
      return data as CMSPageVersion[];
    },
    enabled: !!pageSlug,
  });

  // Rollback to a specific version
  const rollbackMutation = useMutation({
    mutationFn: async (versionId: string) => {
      // Get the version content
      const { data: version, error: versionError } = await supabase
        .from("cms_page_versions")
        .select("*, page:cms_pages!cms_page_versions_page_id_fkey(id, slug)")
        .eq("id", versionId)
        .single();

      if (versionError) throw versionError;

      const pageId = version.page.id;
      const sections = version.content as any[];

      // Delete current sections
      await supabase
        .from("cms_page_sections")
        .delete()
        .eq("page_id", pageId);

      // Insert version sections (with new IDs)
      if (sections && sections.length > 0) {
        const newSections = sections.map((s: any) => ({
          page_id: pageId,
          section_key: s.section_key,
          content: s.content,
          display_order: s.display_order,
          is_visible: s.is_visible,
        }));

        const { error: insertError } = await supabase
          .from("cms_page_sections")
          .insert(newSections);

        if (insertError) throw insertError;
      }

      // Set page status back to draft (requires re-publish)
      await supabase
        .from("cms_pages")
        .update({
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pageId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Version Restored",
        description: "Page content has been restored to the selected version. Publish to make it live.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore version.",
        variant: "destructive",
      });
    },
  });

  // Delete old versions (keep last N)
  const cleanupVersionsMutation = useMutation({
    mutationFn: async (keepCount: number = 10) => {
      const { data: page } = await supabase
        .from("cms_pages")
        .select("id")
        .eq("slug", pageSlug)
        .single();

      if (!page) throw new Error("Page not found");

      // Get versions to keep
      const { data: versionsToKeep } = await supabase
        .from("cms_page_versions")
        .select("id")
        .eq("page_id", page.id)
        .order("version_number", { ascending: false })
        .limit(keepCount);

      const keepIds = versionsToKeep?.map((v) => v.id) || [];

      if (keepIds.length === 0) return;

      // Delete older versions
      const { error } = await supabase
        .from("cms_page_versions")
        .delete()
        .eq("page_id", page.id)
        .not("id", "in", `(${keepIds.join(",")})`);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-versions", pageSlug] });
      toast({
        title: "Versions Cleaned Up",
        description: "Old versions have been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup versions.",
        variant: "destructive",
      });
    },
  });

  return {
    versions,
    isLoading,
    error,
    rollback: rollbackMutation.mutate,
    rollbackAsync: rollbackMutation.mutateAsync,
    cleanupVersions: cleanupVersionsMutation.mutate,
    isRollingBack: rollbackMutation.isPending,
  };
};
