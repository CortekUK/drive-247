import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CMSMedia } from "@/types/cms";

const BUCKET_NAME = "cms-media";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

export const useCMSMedia = (folder?: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch media files
  const { data: media = [], isLoading, error } = useQuery({
    queryKey: ["cms-media", folder],
    queryFn: async () => {
      let query = supabase
        .from("cms_media")
        .select("*")
        .order("created_at", { ascending: false });

      if (folder) {
        query = query.eq("folder", folder);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as CMSMedia[];
    },
  });

  // Upload media file
  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      folder: uploadFolder = "general",
      altText,
    }: {
      file: File;
      folder?: string;
      altText?: string;
    }) => {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("Invalid file type. Only JPG, PNG, WebP, and SVG are allowed.");
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("File size exceeds 5MB limit.");
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user?.id)
        .single();

      // Generate unique filename
      const fileExt = file.name.split(".").pop();
      const fileName = `${uploadFolder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

      // Save to database
      const { data, error: dbError } = await supabase
        .from("cms_media")
        .insert({
          file_name: file.name,
          file_url: urlData.publicUrl,
          file_size: file.size,
          mime_type: file.type,
          alt_text: altText || file.name,
          folder: uploadFolder,
          uploaded_by: appUser?.id || null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      return data as CMSMedia;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-media"] });
      toast({
        title: "File Uploaded",
        description: "Image has been added to the media library.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file.",
        variant: "destructive",
      });
    },
  });

  // Delete media file
  const deleteMutation = useMutation({
    mutationFn: async (mediaId: string) => {
      // Get the media record
      const { data: mediaRecord, error: fetchError } = await supabase
        .from("cms_media")
        .select("file_url")
        .eq("id", mediaId)
        .single();

      if (fetchError) throw fetchError;

      // Extract file path from URL
      const url = new URL(mediaRecord.file_url);
      const pathParts = url.pathname.split(`/${BUCKET_NAME}/`);
      const filePath = pathParts[1];

      if (filePath) {
        // Delete from storage
        await supabase.storage.from(BUCKET_NAME).remove([filePath]);
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from("cms_media")
        .delete()
        .eq("id", mediaId);

      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-media"] });
      toast({
        title: "File Deleted",
        description: "Image has been removed from the media library.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete file.",
        variant: "destructive",
      });
    },
  });

  // Update alt text
  const updateAltTextMutation = useMutation({
    mutationFn: async ({ mediaId, altText }: { mediaId: string; altText: string }) => {
      const { error } = await supabase
        .from("cms_media")
        .update({ alt_text: altText })
        .eq("id", mediaId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-media"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update alt text.",
        variant: "destructive",
      });
    },
  });

  return {
    media,
    isLoading,
    error,
    uploadMedia: uploadMutation.mutate,
    uploadMediaAsync: uploadMutation.mutateAsync,
    deleteMedia: deleteMutation.mutate,
    updateAltText: updateAltTextMutation.mutate,
    isUploading: uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};
