import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export interface VehicleFile {
  id: string;
  vehicle_id: string;
  file_name: string;
  storage_path: string;
  content_type?: string;
  size_bytes?: number;
  uploaded_by?: string;
  uploaded_at: string;
  created_at: string;
}

export function useVehicleFiles(vehicleId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  // Fetch files for a vehicle
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['vehicleFiles', tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('vehicle_files')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('vehicle_id', vehicleId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      return data as VehicleFile[];
    },
    enabled: !!tenant && !!vehicleId,
  });

  // Upload file mutation
  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      // Validate file type
      const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
        'text/plain',
        'text/csv'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        throw new Error(`File type not supported. Please upload images, PDF, Word, Excel, PowerPoint, or text files.`);
      }

      // Validate file size (25MB max)
      if (file.size > 25 * 1024 * 1024) {
        throw new Error(`File size too large. Maximum size is 25MB.`);
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `vehicle/${vehicleId}/${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('vehicle-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Save file metadata to database
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error: dbError } = await supabase
        .from('vehicle_files')
        .insert({
          vehicle_id: vehicleId,
          file_name: file.name,
          storage_path: filePath,
          content_type: file.type,
          size_bytes: file.size,
          tenant_id: tenant.id,
        })
        .select()
        .single();

      if (dbError) {
        // Clean up storage if database insert fails
        await supabase.storage.from('vehicle-files').remove([filePath]);
        throw dbError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleFiles', tenant?.id, vehicleId] });
      toast({
        title: "File Uploaded",
        description: "File has been uploaded successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Error",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    },
  });

  // Delete file mutation
  const deleteFileMutation = useMutation({
    mutationFn: async (file: VehicleFile) => {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('vehicle-files')
        .remove([file.storage_path]);

      if (storageError) throw storageError;

      // Delete from database
      let deleteQuery = supabase
        .from('vehicle_files')
        .delete()
        .eq('id', file.id);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
      }

      const { error: dbError } = await deleteQuery;

      if (dbError) throw dbError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleFiles', tenant?.id, vehicleId] });
      toast({
        title: "File Deleted",
        description: "File has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Error",
        description: error.message || "Failed to delete file",
        variant: "destructive",
      });
    },
  });

  // Download file function
  const downloadFile = async (file: VehicleFile) => {
    try {
      // Create signed URL for download (valid for 1 hour)
      const { data, error } = await supabase.storage
        .from('vehicle-files')
        .createSignedUrl(file.storage_path, 3600);

      if (error) throw error;

      if (!data?.signedUrl) {
        throw new Error('Failed to create download URL');
      }

      // Create download link using signed URL
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = file.file_name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error: any) {
      toast({
        title: "Download Error",
        description: error.message || "Failed to download file",
        variant: "destructive",
      });
    }
  };

  return {
    files,
    isLoading,
    uploadFile: uploadFileMutation.mutate,
    deleteFile: deleteFileMutation.mutate,
    downloadFile,
    isUploading: uploadFileMutation.isPending,
    isDeleting: deleteFileMutation.isPending,
  };
}