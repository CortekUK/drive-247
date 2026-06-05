"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBlogPosts } from "@/hooks/use-blog-posts";
import { useBlogCategories } from "@/hooks/use-blog-categories";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Search,
  Tags,
  Trash2,
  Edit,
  Eye,
  CheckCircle,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
  Settings,
  ArrowLeft,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { BlogPost } from "@/types/blog";

export default function BlogListingPage() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit("cms");
  const { settings: rentalSettings, updateSettings, isUpdating: isTogglingBlog } = useRentalSettings();
  const blogEnabled = !!(rentalSettings as any)?.blog_enabled;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null);

  const { posts, total, totalPages, isLoading, deletePost, isDeleting } =
    useBlogPosts({
      status: statusFilter === "all" ? "all" : (statusFilter as "draft" | "published"),
      categoryId: categoryFilter === "all" ? undefined : categoryFilter,
      search: searchQuery || undefined,
      page: currentPage,
    });

  const { categories } = useBlogCategories();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deletePost(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/cms")}
            className="shrink-0 h-9 px-2 sm:px-3"
          >
            <ArrowLeft className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-gradient-metal">
              Blog
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {total} post{total !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/cms/blog/settings")}
            className="flex-1 sm:flex-none"
          >
            <Settings className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Page Settings</span>
            <span className="sm:hidden">Settings</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/cms/blog/categories")}
            className="flex-1 sm:flex-none"
          >
            <Tags className="h-4 w-4 mr-2" />
            Categories
          </Button>
          {hasEditAccess && (
            <Button size="sm" onClick={() => router.push("/cms/blog/new")} className="flex-1 sm:flex-none">
              <Plus className="h-4 w-4 mr-2" />
              New Post
            </Button>
          )}
        </div>
      </div>

      {/* Blog Visibility Toggle */}
      {hasEditAccess && (
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
          <div className="space-y-0.5">
            <Label className="font-medium">Show blog on website</Label>
            <p className="text-xs text-muted-foreground">
              {blogEnabled
                ? "Blog is visible to customers on your booking website"
                : "Blog is hidden from customers. Enable to show it on your website"}
            </p>
          </div>
          <Switch
            checked={blogEnabled}
            disabled={isTogglingBlog}
            onCheckedChange={async (checked) => {
              try {
                await updateSettings({ blog_enabled: checked } as any);
              } catch (err) {
                // Error toast shown by hook
              }
            }}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search posts..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {posts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No blog posts</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || statusFilter !== "all" || categoryFilter !== "all"
                ? "No posts match your filters"
                : "Create your first blog post to get started"}
            </p>
            {hasEditAccess && !searchQuery && statusFilter === "all" && (
              <Button onClick={() => router.push("/cms/blog/new")}>
                <Plus className="h-4 w-4 mr-2" />
                New Post
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="bg-indigo-50/50 dark:bg-indigo-950/20">
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <TableRow
                    key={post.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/cms/blog/${post.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{post.title}</span>
                        {post.is_featured && (
                          <Badge variant="outline" className="text-xs">
                            Featured
                          </Badge>
                        )}
                      </div>
                      {post.excerpt && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {post.excerpt}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {post.category?.name ? (
                        <Badge variant="secondary">{post.category.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={post.status === "published" ? "default" : "secondary"}
                        className={
                          post.status === "published"
                            ? "bg-green-500/20 text-green-600 hover:bg-green-500/30"
                            : ""
                        }
                      >
                        {post.status === "published" ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <Clock className="h-3 w-3 mr-1" />
                        )}
                        {post.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {post.author_name || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {post.published_at
                        ? format(new Date(post.published_at), "MMM d, yyyy")
                        : formatDistanceToNow(new Date(post.created_at), {
                            addSuffix: true,
                          })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/cms/blog/${post.id}`)}
                        >
                          {hasEditAccess ? (
                            <Edit className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        {hasEditAccess && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(post)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} ({total} posts)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title}&rdquo;.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
