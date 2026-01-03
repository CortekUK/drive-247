'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Mail,
  Pencil,
  ArrowLeft,
  Loader2,
  Check,
  FileText,
} from 'lucide-react';
import { useEmailTemplates } from '@/hooks/use-email-templates';
import { EMAIL_TEMPLATE_TYPES } from '@/lib/email-template-variables';

export default function EmailTemplatesPage() {
  const router = useRouter();
  const { customTemplates, isLoading, isCustomized } = useEmailTemplates();

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

      {/* Templates List */}
      <div className="grid gap-4">
        {EMAIL_TEMPLATE_TYPES.map((templateType) => {
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
    </div>
  );
}
