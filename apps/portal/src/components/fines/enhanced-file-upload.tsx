import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, File, X, Image, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileWithPreview extends File {
  id: string;
  preview?: string;
  uploadProgress?: number;
  uploadError?: string;
}

interface EnhancedFileUploadProps {
  files: FileWithPreview[];
  onFilesChange: (files: FileWithPreview[]) => void;
  acceptedTypes?: string[];
  maxFiles?: number;
  maxFileSize?: number; // in MB
  className?: string;
}

export const EnhancedFileUpload = ({
  files,
  onFilesChange,
  acceptedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx'],
  maxFiles = 10,
  maxFileSize = 20,
  className,
}: EnhancedFileUploadProps) => {
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setUploadErrors([]);
    const errors: string[] = [];

    // Handle rejected files
    rejectedFiles.forEach(({ file, errors: fileErrors }) => {
      fileErrors.forEach((error: any) => {
        if (error.code === 'file-too-large') {
          errors.push(`${file.name} is too large. Maximum size is ${maxFileSize}MB.`);
        } else if (error.code === 'file-invalid-type') {
          errors.push(`${file.name} has an invalid file type.`);
        } else {
          errors.push(`${file.name}: ${error.message}`);
        }
      });
    });

    // Check total file count
    if (files.length + acceptedFiles.length > maxFiles) {
      errors.push(`Maximum ${maxFiles} files allowed. Please remove some files first.`);
      setUploadErrors(errors);
      return;
    }

    // Process accepted files
    const newFiles: FileWithPreview[] = acceptedFiles.map((file) => {
      const fileWithPreview = Object.assign(file, {
        id: Math.random().toString(36).substring(7),
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      });

      return fileWithPreview;
    });

    onFilesChange([...files, ...newFiles]);
    
    if (errors.length > 0) {
      setUploadErrors(errors);
    }
  }, [files, onFilesChange, maxFiles, maxFileSize]);

  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDrop,
    accept: acceptedTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    maxFiles,
    maxSize: maxFileSize * 1024 * 1024, // Convert MB to bytes
    multiple: true,
  });

  const removeFile = (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (file?.preview) {
      URL.revokeObjectURL(file.preview);
    }
    onFilesChange(files.filter(f => f.id !== fileId));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <Image className="h-4 w-4" />;
    if (file.type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          {
            "border-primary bg-primary/10": isDragAccept,
            "border-destructive bg-destructive/10": isDragReject,
            "border-muted-foreground/25": !isDragActive,
          }
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-2">
          <Upload className="h-8 w-8 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-sm text-muted-foreground">
              {isDragAccept ? "Drop files here..." : "Some files are not supported"}
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Drag & drop files here, or click to select
              </p>
              <p className="text-xs text-muted-foreground">
                Max {maxFiles} files, up to {maxFileSize}MB each
              </p>
              <p className="text-xs text-muted-foreground">
                Supported: {acceptedTypes.join(', ')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Upload Errors */}
      {uploadErrors.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Upload Errors:</p>
                <ul className="text-xs text-destructive mt-1 space-y-1">
                  {uploadErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* File Previews */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Selected Files ({files.length}/{maxFiles})
          </p>
          <div className="grid gap-2">
            {files.map((file) => (
              <Card key={file.id}>
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    {/* File Icon/Preview */}
                    <div className="flex-shrink-0">
                      {file.preview ? (
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="h-10 w-10 object-cover rounded"
                        />
                      ) : (
                        <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                          {getFileIcon(file)}
                        </div>
                      )}
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                        {file.uploadProgress !== undefined && (
                          <span className="ml-2">• Uploading {file.uploadProgress}%</span>
                        )}
                        {file.uploadError && (
                          <span className="ml-2 text-destructive">• {file.uploadError}</span>
                        )}
                      </p>
                      {file.uploadProgress !== undefined && (
                        <Progress value={file.uploadProgress} className="mt-1 h-1" />
                      )}
                    </div>

                    {/* Remove Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file.id)}
                      className="flex-shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Helper Text */}
      <p className="text-xs text-muted-foreground">
        Evidence files help document fines and can include photos, PDFs, or documents related to the violation.
      </p>
    </div>
  );
};