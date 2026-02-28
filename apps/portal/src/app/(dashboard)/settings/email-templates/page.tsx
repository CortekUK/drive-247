'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Mail,
  Pencil,
  ArrowLeft,
  Loader2,
  Check,
  FileText,
  Search,
  RotateCcw,
} from 'lucide-react';
import { useEmailTemplates } from '@/hooks/use-email-templates';
import { EMAIL_TEMPLATE_TYPES } from '@/lib/email-template-variables';
import { toast } from '@/hooks/use-toast';

export default function EmailTemplatesPage() {
  const router = useRouter();
  const { customTemplates, isLoading, isCustomized, resetTemplateAsync } = useEmailTemplates();
  const [searchQuery, setSearchQuery] = useState('');
  const [showResetAllDialog, setShowResetAllDialog] = useState(false);
  const [isResettingAll, setIsResettingAll] = useState(false);

  const customizedCount = useMemo(() => {
    return EMAIL_TEMPLATE_TYPES.filter(t => isCustomized(t.key)).length;
  }, [customTemplates]);

  const handleResetAll = async () => {
    setIsResettingAll(true);
    try {
      const customizedKeys = EMAIL_TEMPLATE_TYPES
        .filter(t => isCustomized(t.key))
        .map(t => t.key);

      for (const key of customizedKeys) {
        await resetTemplateAsync(key);
      }
      toast({ title: 'All Templates Reset', description: `${customizedKeys.length} email template(s) have been restored to defaults.` });
      setShowResetAllDialog(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to reset templates', variant: 'destructive' });
    } finally {
      setIsResettingAll(false);
    }
  };

  // Filter templates based on search query
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return EMAIL_TEMPLATE_TYPES;
    const query = searchQuery.toLowerCase();
    return EMAIL_TEMPLATE_TYPES.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.key.toLowerCase().includes(query)
    );
  }, [searchQuery]);

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
            onClick={() => router.push('/settings')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Email Templates</h1>
            <p className="text-muted-foreground mt-1">
              Customize the emails sent to your customers
            </p>
          </div>
        </div>
        {customizedCount > 0 && (
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={() => setShowResetAllDialog(true)}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All to Defaults
          </Button>
        )}
      </div>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm">
                Customize each email type to match your brand. Templates not customized will use the default content.
                Use variables like <code className="bg-muted px-1 py-0.5 rounded text-xs">{'{{customer_name}}'}</code> to personalize emails.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 max-w-md"
        />
      </div>

      {/* Templates List */}
      <div className="grid gap-4">
        {filteredTemplates.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No templates match your search.</p>
          </Card>
        )}
        {filteredTemplates.map((templateType) => {
          const customized = isCustomized(templateType.key);
          const customTemplate = customTemplates.find(t => t.template_key === templateType.key);

          return (
            <Card key={templateType.key} className={customized ? 'border-primary/50' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${customized ? 'bg-primary/10' : 'bg-muted'}`}>
                      <FileText className={`h-5 w-5 ${customized ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {templateType.name}
                        {customized && (
                          <Badge variant="outline" className="text-xs border-primary text-primary">
                            <Check className="h-3 w-3 mr-1" />
                            Customized
                          </Badge>
                        )}
                        {!customized && (
                          <Badge variant="secondary" className="text-xs">
                            Default
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {templateType.description}
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant={customized ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => router.push(`/settings/email-templates/${templateType.key}`)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    {customized ? 'Edit' : 'Customize'}
                  </Button>
                </div>
              </CardHeader>
              {customized && customTemplate && (
                <CardContent className="pt-0">
                  <div className="text-xs text-muted-foreground">
                    Subject: <span className="font-medium text-foreground">{customTemplate.subject}</span>
                  </div>
                </CardContent>
              )}
              {!customized && (
                <CardContent className="pt-0">
                  <div className="text-xs text-muted-foreground">
                    Subject: <span className="font-medium text-foreground">{templateType.defaultSubject}</span>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Reset All Confirmation Dialog */}
      <AlertDialog open={showResetAllDialog} onOpenChange={setShowResetAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Email Templates?</AlertDialogTitle>
            <div className="text-sm text-muted-foreground">
              This will remove all your customizations and restore {customizedCount} email template(s) to their default content. This action cannot be undone.
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetAll} disabled={isResettingAll}>
              {isResettingAll ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                'Reset All to Defaults'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
