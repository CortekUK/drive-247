'use client';

import { useState } from 'react';
import { useGigDriverImages } from '@/hooks/use-gig-driver-images';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Briefcase, Plus, Trash2, ExternalLink, ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

export default function GigDriverPage() {
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const customerId = customerUser?.customer?.id;
  const { data: images, isLoading } = useGigDriverImages(customerId);
  const queryClient = useQueryClient();

  const [uploading, setUploading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !customerId || !tenant?.id) return;
    const files = Array.from(e.target.files);

    const invalid = files.find(f => !ALLOWED_TYPES.includes(f.type) || f.size > MAX_FILE_SIZE);
    if (invalid) {
      toast.error('Only JPG/PNG images under 10MB are allowed');
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `${tenant.id}/${customerId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('gig-driver-images')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw new Error(`Failed to upload ${file.name}`);

        const { error: dbError } = await (supabase as any)
          .from('gig_driver_images')
          .insert({
            customer_id: customerId,
            tenant_id: tenant.id,
            image_url: filePath,
            file_name: file.name,
            file_size: file.size,
          });

        if (dbError) throw new Error(`Failed to save ${file.name}`);
      }

      toast.success(`${files.length} image(s) uploaded`);
      queryClient.invalidateQueries({ queryKey: ['gig-driver-images'] });
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);

    try {
      const image = images?.find(i => i.id === deleteId);
      if (image) {
        await supabase.storage.from('gig-driver-images').remove([image.image_url]);
        await (supabase as any).from('gig_driver_images').delete().eq('id', deleteId);
      }
      toast.success('Image deleted');
      queryClient.invalidateQueries({ queryKey: ['gig-driver-images'] });
    } catch {
      toast.error('Failed to delete image');
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const getPublicUrl = (path: string) => {
    const { data } = supabase.storage.from('gig-driver-images').getPublicUrl(path);
    return data.publicUrl;
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="aspect-square rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="h-6 w-6" />
            Gig Driver Documents
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload and manage your gig driver proof images
          </p>
        </div>
        <div>
          <Input
            id="gig-upload"
            type="file"
            accept=".jpg,.jpeg,.png"
            multiple
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
          <Label htmlFor="gig-upload">
            <Button asChild disabled={uploading}>
              <span>
                {uploading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>
                ) : (
                  <><Plus className="mr-2 h-4 w-4" /> Add Images</>
                )}
              </span>
            </Button>
          </Label>
        </div>
      </div>

      {images && images.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image) => (
            <Card key={image.id} className="overflow-hidden group">
              <div className="aspect-square relative bg-muted">
                <img
                  src={getPublicUrl(image.image_url)}
                  alt={image.file_name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(getPublicUrl(image.image_url), '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {images.length > 1 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteId(image.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground truncate">{image.file_name}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-1">No documents yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload screenshots showing your active gig driver status
            </p>
            <Label htmlFor="gig-upload">
              <Button asChild variant="outline">
                <span>
                  <Plus className="mr-2 h-4 w-4" /> Upload Images
                </span>
              </Button>
            </Label>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this gig driver document? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
