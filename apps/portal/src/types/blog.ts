export interface BlogCategory {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface BlogCategoryWithCount extends BlogCategory {
  post_count: number;
}

export interface BlogPost {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  featured_image_url: string | null;
  category_id: string | null;
  status: "draft" | "published";
  is_featured: boolean;
  author_name: string | null;
  author_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  canonical_url: string | null;
  noindex: boolean;
  reading_time_minutes: number;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  category?: BlogCategory | null;
}

export interface BlogPostVersion {
  id: string;
  post_id: string;
  tenant_id: string;
  version_number: number;
  title: string;
  content: string;
  excerpt: string | null;
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: string;
}

export interface BlogPostFilters {
  status?: "draft" | "published" | "all";
  categoryId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateBlogPostInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  featured_image_url?: string | null;
  category_id?: string | null;
  is_featured?: boolean;
  author_name?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  canonical_url?: string;
  noindex?: boolean;
}

export interface UpdateBlogPostInput extends Partial<CreateBlogPostInput> {
  id: string;
}
