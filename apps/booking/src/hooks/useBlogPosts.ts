import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface BlogPost {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  featured_image_url: string | null;
  category_id: string | null;
  status: string;
  is_featured: boolean;
  author_name: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  canonical_url: string | null;
  noindex: boolean;
  reading_time_minutes: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  category?: { id: string; name: string; slug: string } | null;
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
}

interface UseBlogPostsOptions {
  categorySlug?: string;
  page?: number;
  pageSize?: number;
}

export function useBlogPosts(options?: UseBlogPostsOptions) {
  const { tenant } = useTenant();
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 12;

  return useQuery({
    queryKey: ["blog-posts", tenant?.id, options?.categorySlug, page, pageSize],
    queryFn: async () => {
      let query = (supabase as any)
        .from("blog_posts")
        .select("*, category:blog_categories(id, name, slug)", { count: "exact" })
        .eq("tenant_id", tenant!.id)
        .eq("status", "published")
        .order("published_at", { ascending: false });

      // Filter by category slug
      if (options?.categorySlug) {
        const { data: cat } = await (supabase as any)
          .from("blog_categories")
          .select("id")
          .eq("tenant_id", tenant!.id)
          .eq("slug", options.categorySlug)
          .single();

        if (cat) {
          query = query.eq("category_id", cat.id);
        } else {
          return { posts: [] as BlogPost[], total: 0, page, totalPages: 0 };
        }
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        posts: (data || []) as BlogPost[],
        total: count ?? 0,
        page,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      };
    },
    enabled: !!tenant?.id,
  });
}

export function useBlogPost(slug: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["blog-post", tenant?.id, slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("*, category:blog_categories(id, name, slug)")
        .eq("tenant_id", tenant!.id)
        .eq("slug", slug)
        .eq("status", "published")
        .single();

      if (error) throw error;
      return data as BlogPost;
    },
    enabled: !!tenant?.id && !!slug,
  });
}

export function useBlogCategories() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["blog-categories", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_categories")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return (data || []) as BlogCategory[];
    },
    enabled: !!tenant?.id,
  });
}
