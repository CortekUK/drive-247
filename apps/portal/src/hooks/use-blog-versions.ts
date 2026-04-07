import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import type { BlogPostVersion } from "@/types/blog";

export function useBlogVersions(postId: string | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  const {
    data: versions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["blog-versions", tenant?.id, postId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_post_versions")
        .select("*")
        .eq("post_id", postId!)
        .eq("tenant_id", tenant!.id)
        .order("version_number", { ascending: false });

      if (error) throw error;
      return data as BlogPostVersion[];
    },
    enabled: !!postId && !!tenant?.id,
  });

  // Rollback to a specific version
  const rollbackMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const { data: version, error: vError } = await (supabase as any)
        .from("blog_post_versions")
        .select("*")
        .eq("id", versionId)
        .eq("tenant_id", tenant!.id)
        .single();

      if (vError) throw vError;

      // Restore post fields from version snapshot
      const updates: Record<string, any> = {
        title: version.title,
        content: version.content,
        excerpt: version.excerpt,
        status: "draft",
      };

      // Restore SEO metadata if present
      const meta = version.metadata || {};
      if (meta.meta_title !== undefined) updates.meta_title = meta.meta_title;
      if (meta.meta_description !== undefined) updates.meta_description = meta.meta_description;
      if (meta.meta_keywords !== undefined) updates.meta_keywords = meta.meta_keywords;
      if (meta.canonical_url !== undefined) updates.canonical_url = meta.canonical_url;
      if (meta.noindex !== undefined) updates.noindex = meta.noindex;
      if (meta.featured_image_url !== undefined) updates.featured_image_url = meta.featured_image_url;
      if (meta.category_id !== undefined) updates.category_id = meta.category_id;
      if (meta.is_featured !== undefined) updates.is_featured = meta.is_featured;

      const { error: updateError } = await (supabase as any)
        .from("blog_posts")
        .update(updates)
        .eq("id", version.post_id)
        .eq("tenant_id", tenant!.id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blog-post", tenant?.id, postId] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts", tenant?.id] });
      toast({
        title: "Version Restored",
        description: "Post has been restored to the selected version. Publish to make it live.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore version",
        variant: "destructive",
      });
    },
  });

  // Cleanup old versions (keep last N)
  const cleanupMutation = useMutation({
    mutationFn: async (keepCount: number = 10) => {
      if (!postId) return;

      const { data: toKeep } = await (supabase as any)
        .from("blog_post_versions")
        .select("id")
        .eq("post_id", postId)
        .eq("tenant_id", tenant!.id)
        .order("version_number", { ascending: false })
        .limit(keepCount);

      const keepIds = toKeep?.map((v: any) => v.id) || [];
      if (keepIds.length === 0) return;

      const { error } = await (supabase as any)
        .from("blog_post_versions")
        .delete()
        .eq("post_id", postId)
        .eq("tenant_id", tenant!.id)
        .not("id", "in", `(${keepIds.join(",")})`);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blog-versions", tenant?.id, postId] });
    },
  });

  return {
    versions,
    isLoading,
    error,
    rollback: rollbackMutation.mutate,
    rollbackAsync: rollbackMutation.mutateAsync,
    isRollingBack: rollbackMutation.isPending,
    cleanupVersions: cleanupMutation.mutate,
  };
}
