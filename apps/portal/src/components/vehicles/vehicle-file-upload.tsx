import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, X, FileText, Download, Trash2, FileImage, FileSpreadsheet, FileType, File } from 'lucide-react';
import { VehicleFile } from '@/hooks/use-vehicle-files';
import { format } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface VehicleFileUploadProps {
  files: VehicleFile[];
  onUpload: (file: File) => void;
  onDelete: (file: VehicleFile) => void;
  onDownload: (file: VehicleFile) => void;
  isUploading?: boolean;
  isDeleting?: boolean;
  canUpload?: boolean; // Permission control
  canDelete?: boolean; // Permission control
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return 'Unknown size';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getFileIcon = (fileName: string, contentType?: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const type = contentType?.toLowerCase();
  
  if (type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) {
    return <FileImage className="h-5 w-5 text-blue-500" />;
  }
  if (type === 'application/pdf' || ext === 'pdf') {
    return <FileType className="h-5 w-5 text-red-500" />;
  }
  if (type?.includes('spreadsheet') || type?.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext || '')) {
    return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
  }
  if (type?.includes('document') || type?.includes('word') || ['docx', 'doc'].includes(ext || '')) {
    return <FileText className="h-5 w-5 text-blue-600" />;
  }
  if (type?.includes('presentation') || type?.includes('powerpoint') || ['pptx', 'ppt'].includes(ext || '')) {
    return <FileText className="h-5 w-5 text-orange-500" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
};

export const VehicleFileUpload = ({ 
  files, 
  onUpload, 
  onDelete, 
  onDownload, 
  isUploading, 
  isDeleting,
  canUpload = true, // Default to true for now (until auth is implemented)
  canDelete = true  // Default to true for now (until auth is implemented)
}: VehicleFileUploadProps) => {
  const [dragActive, setDragActive] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle rejected files
    rejectedFiles.forEach(({ file, errors }) => {
      errors.forEach((error: any) => {
        if (error.code === 'file-too-large') {
          alert(`File ${file.name} is too large. Maximum size is 25MB.`);
        } else if (error.code === 'file-invalid-type') {
          alert(`File ${file.name} is not a supported format. Please upload images, PDF, Word, Excel, PowerPoint, or text files.`);
        }
      });
    });

    // Process accepted files
    acceptedFiles.forEach((file) => {
      onUpload(file);
    });
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv']
    },
    maxSize: 25 * 1024 * 1024, // 25MB
    multiple: true,
    disabled: !canUpload,
  });

  return (
    <div className="space-y-4">
      {/* File Upload Area */}
      {canUpload && (
        <Card 
          {...getRootProps()} 
          className={`border-2 border-dashed p-6 text-center transition-colors ${
            !canUpload 
              ? 'border-muted-foreground/10 bg-muted/5 cursor-not-allowed' 
              : isDragActive 
                ? 'border-primary bg-primary/5 cursor-pointer' 
                : 'border-muted-foreground/25 hover:border-primary/50 cursor-pointer'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {isDragActive ? (
              "Drop the files here..."
            ) : (
              <>
                Drag & drop files here, or <span className="text-primary">click to select</span>
                <br />
                <span className="text-xs">Supports: Images, PDF, Word, Excel, PowerPoint, Text • Max: 25MB</span>
              </>
            )}
          </p>
        </Card>
      )}

      {isUploading && (
        <Card className="p-4">
          <div className="flex items-center space-x-3">
            <Upload className="h-4 w-4 text-primary animate-pulse" />
            <div className="flex-1">
              <p className="text-sm font-medium">Uploading file...</p>
              <Progress value={undefined} className="h-2 mt-1" />
            </div>
          </div>
        </Card>
      )}

      {/* File List */}
      <div className="space-y-2">
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No files uploaded yet
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{files.length} file{files.length !== 1 ? 's' : ''}</p>
            </div>
            {files.map((file) => (
              <Card key={file.id} className="p-4 hover:bg-muted/5 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    {getFileIcon(file.file_name, file.content_type)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {file.file_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size_bytes)} • Uploaded {format(new Date(file.uploaded_at), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDownload(file)}
                      className="h-8 w-8 p-0"
                      title="Download file"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            disabled={isDeleting}
                            title="Delete file"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete File</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{file.file_name}"? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => onDelete(file)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};