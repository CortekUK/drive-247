'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  Check,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { useAgreementTemplates } from '@/hooks/use-agreement-templates';

export default function AgreementTemplatesPage() {
  const router = useRouter();
  const {
    templates,
    isLoading,
    deleteTemplate,
    isDeleting,
    setActiveTemplate,
    isSettingActive,
  } = useAgreementTemplates();

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/settings?tab=agreement')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Agreement Templates</h1>
            <p className="text-muted-foreground mt-1">
              Customize the rental agreement template used for DocuSign
            </p>
          </div>
        </div>
        <Button onClick={() => router.push('/settings/agreement-templates/edit')} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Template
        </Button>
      </div>

      {/* Empty State */}
      {templates.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Agreement Templates</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Create your first agreement template to customize the rental agreements sent via DocuSign.
            </p>
            <Button onClick={() => router.push('/settings/agreement-templates/edit')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Templates List */}
      {templates.length > 0 && (
        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id} className={template.is_active ? 'border-primary' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {template.template_name}
                        {template.is_active && (
                          <Badge variant="default" className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Created: {formatDate(template.created_at)}
                        {template.updated_at !== template.created_at && (
                          <> &middot; Updated: {formatDate(template.updated_at)}</>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!template.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveTemplate(template.id)}
                        disabled={isSettingActive}
                      >
                        {isSettingActive ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1" />
                            Set Active
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/settings/agreement-templates/edit?id=${template.id}`)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{template.template_name}"? This action cannot be undone.
                            {template.is_active && (
                              <span className="block mt-2 text-orange-600">
                                Warning: This is your active template. Deleting it will leave you without an agreement template.
                              </span>
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteTemplate(template.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Delete'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded-md p-3 max-h-24 overflow-hidden">
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                    {template.template_content.substring(0, 250)}
                    {template.template_content.length > 250 && '...'}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
