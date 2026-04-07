import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuth } from "@/stores/auth-store";
import type {
  BlogPost,
  BlogPostFilters,
  CreateBlogPostInput,
  UpdateBlogPostInput,
} from "@/types/blog";

const PAGE_SIZE = 25;

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function computeReadingTime(html: string): number {
  const text = (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function useBlogPosts(filters?: BlogPostFilters) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();
  const { appUser } = useAuth();

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? PAGE_SIZE;

  // List posts with filters and pagination
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["blog-posts", tenant?.id, filters],
    queryFn: async () => {
      let query = (supabase as any)
        .from("blog_posts")
        .select("*, category:blog_categories(*)", { count: "exact" })
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (filters?.categoryId) {
        query = query.eq("category_id", filters.categoryId);
      }
      if (filters?.search) {
        query = query.ilike("title", `%${filters.search}%`);
      }

      // Pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        posts: (data || []) as BlogPost[],
        total: count ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      };
    },
    enabled: !!tenant?.id,
  });

  // Get single post by ID
  const getPost = async (postId: string): Promise<BlogPost> => {
    const { data, error } = await (supabase as any)
      .from("blog_posts")
      .select("*, category:blog_categories(*)")
      .eq("id", postId)
      .eq("tenant_id", tenant!.id)
      .single();

    if (error) throw error;
    return data as BlogPost;
  };

  // Generate unique slug with collision handling
  const generateUniqueSlug = async (
    title: string,
    excludeId?: string
  ): Promise<string> => {
    const baseSlug = generateSlug(title);
    if (!baseSlug) return `post-${Date.now()}`;

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      let query = (supabase as any)
        .from("blog_posts")
        .select("id")
        .eq("tenant_id", tenant!.id)
        .eq("slug", slug);

      if (excludeId) {
        query = query.neq("id", excludeId);
      }

      const { data } = await query;
      if (!data || data.length === 0) break;

      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    return slug;
  };

  // Create
  const createPost = useMutation({
    mutationFn: async (input: CreateBlogPostInput) => {
      const slug = input.slug || (await generateUniqueSlug(input.title));
      const readingTime = computeReadingTime(input.content || "");

      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .insert({
          tenant_id: tenant!.id,
          title: input.title,
          slug,
          excerpt: input.excerpt || null,
          content: input.content || null,
          featured_image_url: input.featured_image_url || null,
          category_id: input.category_id || null,
          is_featured: input.is_featured ?? false,
          author_name: input.author_name || (appUser as any)?.full_name || appUser?.name || null,
          author_id: appUser?.id || null,
          meta_title: input.meta_title || null,
          meta_description: input.meta_description || null,
          meta_keywords: input.meta_keywords || null,
          canonical_url: input.canonical_url || null,
          noindex: input.noindex ?? false,
          reading_time_minutes: readingTime,
          status: "draft",
        })
        .select("*, category:blog_categories(*)")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("A post with this slug already exists. Please choose a different title or slug.");
        }
        throw error;
      }

      logAction({
        action: "blog_post_created",
        entityType: "blog_post",
        entityId: data.id,
        details: { title: input.title, slug },
      });

      return data as BlogPost;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["blog-posts", tenant?.id],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create post",
        variant: "destructive",
      });
    },
  });

  // Update
  const updatePost = useMutation({
    mutationFn: async (input: UpdateBlogPostInput) => {
      const updates: Record<string, any> = {};

      if (input.title !== undefined) updates.title = input.title;
      if (input.slug !== undefined) updates.slug = input.slug;
      if (input.excerpt !== undefined) updates.excerpt = input.excerpt;
      if (input.content !== undefined) {
        updates.content = input.content;
        updates.reading_time_minutes = computeReadingTime(input.content || "");
      }
      if (input.featured_image_url !== undefined) updates.featured_image_url = input.featured_image_url;
      if (input.category_id !== undefined) updates.category_id = input.category_id;
      if (input.is_featured !== undefined) updates.is_featured = input.is_featured;
      if (input.author_name !== undefined) updates.author_name = input.author_name;
      if (input.meta_title !== undefined) updates.meta_title = input.meta_title;
      if (input.meta_description !== undefined) updates.meta_description = input.meta_description;
      if (input.meta_keywords !== undefined) updates.meta_keywords = input.meta_keywords;
      if (input.canonical_url !== undefined) updates.canonical_url = input.canonical_url;
      if (input.noindex !== undefined) updates.noindex = input.noindex;

      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .update(updates)
        .eq("id", input.id)
        .eq("tenant_id", tenant!.id)
        .select("*, category:blog_categories(*)")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("A post with this slug already exists");
        }
        throw error;
      }

      logAction({
        action: "blog_post_updated",
        entityType: "blog_post",
        entityId: input.id,
        details: { fields: Object.keys(updates) },
      });

      return data as BlogPost;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["blog-posts", tenant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["blog-post", tenant?.id, data.id],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update post",
        variant: "destructive",
      });
    },
  });

  // Publish
  const publishPost = useMutation({
    mutationFn: async (postId: string) => {
      // Fetch current post to validate
      const post = await getPost(postId);
      if (!post.title?.trim()) throw new Error("Post must have a title");
      if (!post.content?.trim()) throw new Error("Post must have content before publishing");

      // Create version snapshot
      const { data: versions } = await (supabase as any)
        .from("blog_post_versions")
        .select("version_number")
        .eq("post_id", postId)
        .eq("tenant_id", tenant!.id)
        .order("version_number", { ascending: false })
        .limit(1);

      const nextVersion = (versions?.[0]?.version_number ?? 0) + 1;

      await (supabase as any).from("blog_post_versions").insert({
        post_id: postId,
        tenant_id: tenant!.id,
        version_number: nextVersion,
        title: post.title,
        content: post.content,
        excerpt: post.excerpt,
        metadata: {
          meta_title: post.meta_title,
          meta_description: post.meta_description,
          meta_keywords: post.meta_keywords,
          canonical_url: post.canonical_url,
          noindex: post.noindex,
          featured_image_url: post.featured_image_url,
          category_id: post.category_id,
          is_featured: post.is_featured,
        },
        created_by: appUser?.id || null,
      });

      // Publish the post
      const now = new Date().toISOString();
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .update({
          status: "published",
          published_at: post.published_at || now,
          published_by: appUser?.id || null,
        })
        .eq("id", postId)
        .eq("tenant_id", tenant!.id)
        .select("*, category:blog_categories(*)")
        .single();

      if (error) throw error;

      logAction({
        action: "blog_post_published",
        entityType: "blog_post",
        entityId: postId,
        details: { title: post.title, version: nextVersion },
      });

      return data as BlogPost;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["blog-posts", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["blog-post", tenant?.id, data.id] });
      queryClient.invalidateQueries({ queryKey: ["blog-versions", tenant?.id, data.id] });
      toast({ title: "Post published" });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot publish",
        description: error.message || "Failed to publish post",
        variant: "destructive",
      });
    },
  });

  // Unpublish
  const unpublishPost = useMutation({
    mutationFn: async (postId: string) => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .update({ status: "draft" })
        .eq("id", postId)
        .eq("tenant_id", tenant!.id)
        .select("*, category:blog_categories(*)")
        .single();

      if (error) throw error;

      logAction({
        action: "blog_post_unpublished",
        entityType: "blog_post",
        entityId: postId,
        details: { title: data.title },
      });

      return data as BlogPost;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["blog-posts", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["blog-post", tenant?.id, data.id] });
      toast({ title: "Post reverted to draft" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unpublish post",
        variant: "destructive",
      });
    },
  });

  // Delete
  const deletePost = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await (supabase as any)
        .from("blog_posts")
        .delete()
        .eq("id", postId)
        .eq("tenant_id", tenant!.id);

      if (error) throw error;

      logAction({
        action: "blog_post_deleted",
        entityType: "blog_post",
        entityId: postId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blog-posts", tenant?.id] });
      toast({ title: "Post deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete post",
        variant: "destructive",
      });
    },
  });

  return {
    posts: data?.posts ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    totalPages: data?.totalPages ?? 1,
    isLoading,
    error,
    getPost,
    generateUniqueSlug,
    createPost: createPost.mutateAsync,
    updatePost: updatePost.mutateAsync,
    publishPost: publishPost.mutateAsync,
    unpublishPost: unpublishPost.mutateAsync,
    deletePost: deletePost.mutateAsync,
    isCreating: createPost.isPending,
    isUpdating: updatePost.isPending,
    isPublishing: publishPost.isPending,
    isDeleting: deletePost.isPending,
  };
}

// Standalone hook for single post by ID
export function useBlogPost(postId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["blog-post", tenant?.id, postId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("*, category:blog_categories(*)")
        .eq("id", postId!)
        .eq("tenant_id", tenant!.id)
        .single();

      if (error) throw error;
      return data as BlogPost;
    },
    enabled: !!tenant?.id && !!postId,
  });
}
