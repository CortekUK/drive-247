import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Image } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface CompanyLogoUploadProps {
  currentLogoUrl?: string;
  onLogoChange: (logoUrl: string | null) => void;
  isUploading?: boolean;
}

export const CompanyLogoUpload: React.FC<CompanyLogoUploadProps> = ({
  currentLogoUrl,
  onLogoChange,
  isUploading = false
}) => {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file (PNG, JPG, etc.)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image smaller than 2MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${Date.now()}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('company-logos')
        .getPublicUrl(filePath);

      onLogoChange(publicUrl);
      
      toast({
        title: "Logo Uploaded",
        description: "Company logo uploaded successfully",
      });
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!currentLogoUrl) return;

    try {
      // Extract file path from URL
      const urlParts = currentLogoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      await supabase.storage
        .from('company-logos')
        .remove([fileName]);

      onLogoChange(null);
      
      toast({
        title: "Logo Removed",
        description: "Company logo removed successfully",
      });
    } catch (error: any) {
      console.error('Error removing logo:', error);
      toast({
        title: "Remove Failed",
        description: "Failed to remove logo",
        variant: "destructive",
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  return (
    <div className="space-y-4">
      <Label htmlFor="logo-upload">Company Logo</Label>
      
      {currentLogoUrl ? (
        <div className="space-y-3">
          <div className="relative inline-block">
            <img 
              src={currentLogoUrl} 
              alt="Company Logo" 
              className="h-20 w-auto rounded-lg border border-border bg-background object-contain"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
              onClick={handleRemoveLogo}
              disabled={isUploading}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Current logo - click X to remove
          </p>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver 
              ? 'border-primary bg-primary/5' 
              : 'border-border hover:border-primary/50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <Image className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload company logo</p>
            <p className="text-xs text-muted-foreground">
              Drag and drop an image, or click to select
            </p>
            <p className="text-xs text-muted-foreground">
              PNG, JPG up to 2MB
            </p>
          </div>
          <Input
            id="logo-upload"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
            disabled={uploading || isUploading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => document.getElementById('logo-upload')?.click()}
            disabled={uploading || isUploading}
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? 'Uploading...' : 'Choose File'}
          </Button>
        </div>
      )}
    </div>
  );
};