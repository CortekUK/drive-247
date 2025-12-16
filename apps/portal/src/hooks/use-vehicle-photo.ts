import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface UseVehiclePhotoOptions {
  vehicleId: string;
  vehicleReg: string;
  onPhotoUpdate?: (photoUrl: string | null) => void;
}

export const useVehiclePhoto = ({ vehicleId, vehicleReg, onPhotoUpdate }: UseVehiclePhotoOptions) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadPhoto = async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File Type",
        description: "Please select an image file (JPG, PNG, WebP, etc.)",
        variant: "destructive",
      });
      return false;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive",
      });
      return false;
    }

    setIsUploading(true);
    
    try {
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${vehicleId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Upload to storage
      const { error: uploadError, data } = await supabase.storage
        .from('vehicle-photos')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-photos')
        .getPublicUrl(filePath);

      // Update vehicle record
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ photo_url: publicUrl })
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      toast({
        title: "Photo Uploaded",
        description: `Photo uploaded successfully for ${vehicleReg}`,
      });

      // Refresh vehicle data
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      
      onPhotoUpdate?.(publicUrl);
      return true;

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload photo. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = async (currentPhotoUrl: string) => {
    setIsRemoving(true);
    
    try {
      // Extract file name from URL
      const urlParts = currentPhotoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      // Remove from storage
      const { error: deleteError } = await supabase.storage
        .from('vehicle-photos')
        .remove([fileName]);

      if (deleteError) {
        console.warn('Storage deletion error:', deleteError);
        // Continue anyway as the file might already be deleted
      }

      // Update vehicle record
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ photo_url: null })
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      toast({
        title: "Photo Removed",
        description: `Photo removed for ${vehicleReg}`,
      });

      // Refresh vehicle data
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      
      onPhotoUpdate?.(null);
      return true;

    } catch (error: any) {
      console.error('Remove error:', error);
      toast({
        title: "Remove Failed",
        description: error.message || "Failed to remove photo. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsRemoving(false);
    }
  };

  const replacePhoto = async (file: File, currentPhotoUrl?: string) => {
    // Remove existing photo if it exists (but don't show toast for intermediate step)
    if (currentPhotoUrl) {
      try {
        const urlParts = currentPhotoUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        await supabase.storage.from('vehicle-photos').remove([fileName]);
      } catch (error) {
        console.warn('Error removing old photo:', error);
        // Continue with upload anyway
      }
    }

    // Upload new photo
    return await uploadPhoto(file);
  };

  return {
    uploadPhoto,
    removePhoto,
    replacePhoto,
    isUploading,
    isRemoving,
    isLoading: isUploading || isRemoving,
  };
};