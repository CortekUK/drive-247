'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
  Pencil,
  Check,
  Loader2,
  ArrowLeft,
  RotateCcw,
  Plus,
  Info,
} from 'lucide-react';
import {
  useTemplateSelection,
  type TemplateType,
  DEFAULT_TEMPLATE_NAME,
  CUSTOM_TEMPLATE_NAME,
} from '@/hooks/use-agreement-templates';

export default function AgreementTemplatesPage() {
  const router = useRouter();
  const {
    defaultTemplate,
    customTemplate,
    activeType,
    isLoading,
    initializeDefault,
    isInitializingDefault,
    initializeCustom,
    isInitializingCustom,
    setActiveByType,
    isSettingActive,
    resetDefault,
    isResetting,
    clearCustom,
    isClearing,
  } = useTemplateSelection();

  const [initialized, setInitialized] = useState(false);

  // Initialize templates if they don't exist
  useEffect(() => {
    const initialize = async () => {
      if (isLoading || initialized) return;

      try {
        if (!defaultTemplate) {
          await initializeDefault();
        }
        if (!customTemplate) {
          await initializeCustom();
        }
        setInitialized(true);
      } catch (error) {
        console.error('Error initializing templates:', error);
        setInitialized(true);
      }
    };

    initialize();
  }, [isLoading, defaultTemplate, customTemplate, initializeDefault, initializeCustom, initialized]);

  const handleTemplateChange = (value: string) => {
    // Don't allow selecting custom template if it's empty
    if (value === 'custom' && (!customTemplate?.template_content || customTemplate.template_content.trim() === '')) {
      return;
    }
    setActiveByType(value as TemplateType);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isInitializing = isInitializingDefault || isInitializingCustom;
  const customTemplateIsEmpty = !customTemplate?.template_content || customTemplate.template_content.trim() === '';

  if (isLoading || isInitializing) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            {isInitializing ? 'Setting up templates...' : 'Loading templates...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/settings')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Agreement Templates</h1>
          <p className="text-muted-foreground text-sm">
            Choose which template to use for rental agreements sent via DocuSign
          </p>
        </div>
      </div>

      {/* Template Selection */}
      <RadioGroup
        value={activeType || 'default'}
        onValueChange={handleTemplateChange}
        className="space-y-4"
        disabled={isSettingActive}
      >
        {/* Default Template Card */}
        <Card className={`relative transition-all ${activeType === 'default' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-muted-foreground/30'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <RadioGroupItem value="default" id="default" className="mt-1 h-5 w-5" />
                <div className="flex-1 min-w-0">
                  <Label htmlFor="default" className="cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{DEFAULT_TEMPLATE_NAME}</span>
                      {activeType === 'default' && (
                        <Badge className="text-xs bg-primary/10 text-primary border-0">
                          <Check className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Standard Terms & Conditions covering liability, insurance, and vehicle use policies.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isResetting}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isResetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Default Template?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will restore the default template to its original content. Any customizations you've made will be lost.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => resetDefault()}>
                        Reset Template
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/settings/agreement-templates/edit?type=default`)}
                >
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              </div>
            </div>
          </CardHeader>
          {defaultTemplate && (
            <CardContent className="pt-0">
              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground line-clamp-2">
                {defaultTemplate.template_content.replace(/<[^>]+>/g, ' ').substring(0, 200)}...
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Last updated: {formatDate(defaultTemplate.updated_at)}
              </p>
            </CardContent>
          )}
        </Card>

        {/* Custom Template Card */}
        <Card className={`relative transition-all ${activeType === 'custom' ? 'border-primary ring-2 ring-primary/20' : customTemplateIsEmpty ? 'border-dashed' : 'hover:border-muted-foreground/30'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <RadioGroupItem
                  value="custom"
                  id="custom"
                  className="mt-1 h-5 w-5"
                  disabled={customTemplateIsEmpty}
                />
                <div className="flex-1 min-w-0">
                  <Label htmlFor="custom" className={`${customTemplateIsEmpty ? '' : 'cursor-pointer'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{CUSTOM_TEMPLATE_NAME}</span>
                      {activeType === 'custom' && (
                        <Badge className="text-xs bg-primary/10 text-primary border-0">
                          <Check className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      )}
                      {customTemplateIsEmpty && (
                        <Badge variant="secondary" className="text-xs">
                          Not configured
                        </Badge>
                      )}
                    </div>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {customTemplateIsEmpty
                      ? 'Create your own custom agreement with your specific terms and branding.'
                      : 'Your customized rental agreement template with your own terms and branding.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!customTemplateIsEmpty && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isClearing}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isClearing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear Custom Template?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove all content from the custom template. You can recreate it at any time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => clearCustom()}>
                          Clear Template
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button
                  variant={customTemplateIsEmpty ? "default" : "outline"}
                  size="sm"
                  onClick={() => router.push(`/settings/agreement-templates/edit?type=custom`)}
                >
                  {customTemplateIsEmpty ? (
                    <>
                      <Plus className="h-4 w-4 mr-1.5" />
                      Create
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4 mr-1.5" />
                      Edit
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          {customTemplate && !customTemplateIsEmpty && (
            <CardContent className="pt-0">
              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground line-clamp-2">
                {customTemplate.template_content.replace(/<[^>]+>/g, ' ').substring(0, 200)}...
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Last updated: {formatDate(customTemplate.updated_at)}
              </p>
            </CardContent>
          )}
          {customTemplateIsEmpty && (
            <CardContent className="pt-0">
              <div className="bg-muted/30 border border-dashed rounded-lg p-6 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No custom template created yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click "Create" to build your own template
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </RadioGroup>

      {/* Loading overlay for template switch */}
      {isSettingActive && (
        <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 flex items-center gap-3 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Switching template...</span>
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <p>
            The active template will be used when sending rental agreements via DocuSign.
            You can edit either template to customize the content using dynamic variables.
          </p>
        </div>
      </div>
    </div>
  );
}
