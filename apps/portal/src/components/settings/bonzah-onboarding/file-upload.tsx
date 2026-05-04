'use client';

import { useRef, useState } from 'react';
import { UploadCloud, FileIcon, X, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';
import type { UploadedFile, FileField } from './schema';

interface FileUploadProps {
  field: FileField;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  maxFiles?: number;
  accept?: string;
  helperText?: string;
}

const DEFAULT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,image/jpeg,image/png,image/gif';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function FileUpload({
  field,
  files,
  onChange,
  maxFiles = 5,
  accept = DEFAULT_ACCEPT,
  helperText = 'PDF, DOC/DOCX, XLS/CSV, JPG/JPEG, PNG, GIF',
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { tenant } = useTenant();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleSelect = () => inputRef.current?.click();

  const uploadFiles = async (selected: FileList | File[]) => {
    if (!tenant?.id) {
      toast({ title: 'Tenant not loaded', variant: 'destructive' });
      return;
    }
    const list = Array.from(selected);
    if (files.length + list.length > maxFiles) {
      toast({
        title: 'Too many files',
        description: `Maximum ${maxFiles} file${maxFiles === 1 ? '' : 's'} allowed.`,
        variant: 'destructive',
      });
      return;
    }
    for (const f of list) {
      if (f.size > MAX_FILE_SIZE) {
        toast({
          title: 'File too large',
          description: `${f.name} exceeds the 25 MB limit.`,
          variant: 'destructive',
        });
        return;
      }
    }

    setUploading(true);
    const newUploaded: UploadedFile[] = [];
    try {
      for (const file of list) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${tenant.id}/draft/${field}/${Date.now()}_${safeName}`;
        const { error } = await supabase.storage
          .from('bonzah-onboarding-files')
          .upload(path, file, { upsert: false });
        if (error) throw error;
        const { data: signed } = await supabase.storage
          .from('bonzah-onboarding-files')
          .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days for preview
        newUploaded.push({
          url: signed?.signedUrl ?? '',
          path,
          name: file.name,
          size: file.size,
        });
      }
      onChange([...files, ...newUploaded]);
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message || 'Could not upload file',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async (path: string) => {
    try {
      await supabase.storage.from('bonzah-onboarding-files').remove([path]);
    } catch {
      // Non-fatal — still remove locally
    }
    onChange(files.filter((f) => f.path !== path));
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-2">
      <div
        onClick={handleSelect}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed cursor-pointer transition-all px-6 py-8',
          'bg-muted/40 hover:bg-muted/70',
          'dark:bg-gray-900/40 dark:hover:bg-gray-900/60',
          dragOver
            ? 'border-primary bg-primary/5 dark:bg-primary/10'
            : 'border-input',
          uploading && 'pointer-events-none opacity-70',
        )}
      >
        <div className="h-10 w-10 rounded-full bg-muted dark:bg-gray-800 flex items-center justify-center">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <UploadCloud className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Click to upload or drag and drop'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {helperText}
            {maxFiles > 1 && ` · Up to ${maxFiles} files`}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file) => (
            <li
              key={file.path}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background dark:bg-gray-900/40 px-3 py-2"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-md bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {file.url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-7 px-2 text-xs"
                  >
                    <a href={file.url} target="_blank" rel="noopener noreferrer">
                      <FileIcon className="h-3.5 w-3.5 mr-1" />
                      View
                    </a>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-600"
                  onClick={() => handleRemove(file.path)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
