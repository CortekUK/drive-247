"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBlogCategories } from "@/hooks/use-blog-categories";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TableTile,
  bentoTable,
  EmptyState,
  Shimmer,
  Modal,
} from "@/components/bento";
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
import { ArrowLeft, Plus, Edit, Trash2, Tags, Loader2 } from "lucide-react";
import type { BlogCategoryWithCount } from "@/types/blog";

export default function BlogCategoriesPage() {
  const router = useRouter();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit("cms");

  const {
    categories,
    isLoading,
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating,
    isUpdating,
    isDeleting,
  } = useBlogCategories();

  const [showDialog, setShowDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BlogCategoryWithCount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BlogCategoryWithCount | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const resetForm = () => {
    setName("");
    setSlug("");
    setDescription("");
    setDisplayOrder(0);
    setSlugManuallyEdited(false);
    setEditingCategory(null);
  };

  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEdit = (cat: BlogCategoryWithCount) => {
    setEditingCategory(cat);
    setName(cat.name);
    setSlug(cat.slug);
    setDescription(cat.description || "");
    setDisplayOrder(cat.display_order);
    setSlugManuallyEdited(true);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    if (editingCategory) {
      await updateCategory({
        id: editingCategory.id,
        name,
        slug,
        description: description || undefined,
        display_order: displayOrder,
      });
    } else {
      await createCategory({
        name,
        slug: slug || undefined,
        description: description || undefined,
        display_order: displayOrder,
      });
    }
    setShowDialog(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteCategory(deleteTarget.id);
    setDeleteTarget(null);
  };

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 100)
      );
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Shimmer className="h-8 w-48" />
        <TableTile>
          <div className="space-y-3 p-4">
            {[...Array(6)].map((_, i) => (
              <Shimmer key={i} className="h-12 w-full" />
            ))}
          </div>
        </TableTile>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/cms/blog")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-extrabold tracking-tight">Blog Categories</h1>
        </div>
        {hasEditAccess && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Category
          </Button>
        )}
      </div>

      {/* Table */}
      {categories.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-5 w-5" />}
          title="No categories"
          description="Create categories to organize your blog posts"
          action={
            hasEditAccess ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New Category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableTile>
          <Table>
            <TableHeader className={bentoTable.header}>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id} className="border-border">
                  <TableCell>
                    <div>
                      <span className="font-medium">{cat.name}</span>
                      {cat.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {cat.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {cat.slug}
                  </TableCell>
                  <TableCell className="font-mono text-sm tabular-nums">{cat.post_count}</TableCell>
                  <TableCell className="font-mono text-sm tabular-nums">{cat.display_order}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {hasEditAccess && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(cat)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(cat)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableTile>
      )}

      {/* Create/Edit Dialog */}
      <Modal
        open={showDialog}
        onOpenChange={setShowDialog}
        title={editingCategory ? "Edit Category" : "New Category"}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || isCreating || isUpdating}
            >
              {isCreating || isUpdating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {editingCategory ? "Update" : "Create"}
            </Button>
          </>
        }
      >
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Tips, News, Guides"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugManuallyEdited(true);
                }}
                placeholder="tips"
              />
              <p className="text-xs text-muted-foreground mt-1">
                URL-safe identifier: /blog?category={slug || "..."}
              </p>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this category"
                rows={2}
              />
            </div>
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>
          </div>
      </Modal>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.post_count > 0
                ? `This category has ${deleteTarget.post_count} post${deleteTarget.post_count !== 1 ? "s" : ""}. They will become uncategorized.`
                : `Delete "${deleteTarget?.name}"? This action cannot be undone.`}
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
