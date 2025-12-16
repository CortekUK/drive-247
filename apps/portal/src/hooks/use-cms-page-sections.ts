import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CMSPageSection } from "@/types/cms";

export const useCMSPageSections = (pageSlug: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Update a single section
  const updateSectionMutation = useMutation({
    mutationFn: async ({
      sectionKey,
      content,
    }: {
      sectionKey: string;
      content: Record<string, any>;
    }) => {
      // First get the page id from slug
      const { data: page, error: pageError } = await supabase
        .from("cms_pages")
        .select("id")
        .eq("slug", pageSlug)
        .single();

      if (pageError) throw pageError;

      // Upsert the section
      const { error } = await supabase
        .from("cms_page_sections")
        .upsert(
          {
            page_id: page.id,
            section_key: sectionKey,
            content,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "page_id,section_key",
          }
        );

      if (error) throw error;

      // Also update the page's updated_at timestamp
      await supabase
        .from("cms_pages")
        .update({ updated_at: new Date().toISOString(), status: "draft" })
        .eq("id", page.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      toast({
        title: "Section Saved",
        description: "Your changes have been saved as a draft.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save section.",
        variant: "destructive",
      });
    },
  });

  // Update multiple sections at once
  const updateMultipleSectionsMutation = useMutation({
    mutationFn: async (
      sections: { sectionKey: string; content: Record<string, any> }[]
    ) => {
      // Get the page id
      const { data: page, error: pageError } = await supabase
        .from("cms_pages")
        .select("id")
        .eq("slug", pageSlug)
        .single();

      if (pageError) throw pageError;

      // Prepare upsert data
      const upsertData = sections.map((s) => ({
        page_id: page.id,
        section_key: s.sectionKey,
        content: s.content,
        updated_at: new Date().toISOString(),
      }));

      // Upsert all sections
      const { error } = await supabase
        .from("cms_page_sections")
        .upsert(upsertData, {
          onConflict: "page_id,section_key",
        });

      if (error) throw error;

      // Update page timestamp
      await supabase
        .from("cms_pages")
        .update({ updated_at: new Date().toISOString(), status: "draft" })
        .eq("id", page.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      toast({
        title: "All Sections Saved",
        description: "Your changes have been saved as a draft.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save sections.",
        variant: "destructive",
      });
    },
  });

  // Toggle section visibility
  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({
      sectionId,
      isVisible,
    }: {
      sectionId: string;
      isVisible: boolean;
    }) => {
      const { error } = await supabase
        .from("cms_page_sections")
        .update({ is_visible: isVisible })
        .eq("id", sectionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update visibility.",
        variant: "destructive",
      });
    },
  });

  return {
    updateSection: updateSectionMutation.mutate,
    updateSectionAsync: updateSectionMutation.mutateAsync,
    updateMultipleSections: updateMultipleSectionsMutation.mutate,
    toggleVisibility: toggleVisibilityMutation.mutate,
    isUpdating: updateSectionMutation.isPending || updateMultipleSectionsMutation.isPending,
  };
};
