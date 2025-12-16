'use client';

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Eye } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: any;
}

const SAMPLE_VARIABLES = {
  customerName: 'John Doe',
  bookingRef: 'BK-2024-001',
  rejectionReason: 'Insurance verification required',
  refundAmount: '500.00',
  vehicleName: '2024 Mercedes S-Class',
  pickupDate: 'January 15, 2025',
  returnDate: 'January 30, 2025',
  totalAmount: '2500.00',
  dueDate: 'January 10, 2025',
  amountDue: '1250.00'
};

export default function EmailTemplatePreview({ open, onOpenChange, template }: Props) {
  const [renderedHtml, setRenderedHtml] = useState('');
  const [renderedSubject, setRenderedSubject] = useState('');
  const [rendering, setRendering] = useState(false);
  const [customVariables, setCustomVariables] = useState<Record<string, string>>(SAMPLE_VARIABLES);

  const handleRender = async () => {
    if (!template) return;

    setRendering(true);
    try {
      const { data, error } = await supabase.functions.invoke('render-email-template', {
        body: {
          templateBody: template.body,
          templateSubject: template.subject,
          variables: customVariables
        }
      });

      if (error) throw error;

      setRenderedHtml(data.html);
      setRenderedSubject(data.subject);
    } catch (error: any) {
      toast({
        title: "Rendering Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setRendering(false);
    }
  };

  // Auto-render when dialog opens
  useState(() => {
    if (open && template) {
      handleRender();
    }
  });

  const templateVariables = template ? JSON.parse(template.variables || '[]') : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview: {template?.name}</DialogTitle>
          <DialogDescription>
            Preview how this template will look with sample data
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Variable Inputs */}
          {templateVariables.length > 0 && (
            <div className="p-4 bg-muted rounded-lg">
              <Label className="text-sm font-semibold mb-3 block">
                Template Variables (edit to see changes)
              </Label>
              <div className="grid grid-cols-2 gap-3">
                {templateVariables.map((variable: string) => (
                  <div key={variable}>
                    <Label htmlFor={variable} className="text-xs">
                      {`{{${variable}}}`}
                    </Label>
                    <Input
                      id={variable}
                      value={customVariables[variable] || ''}
                      onChange={(e) => setCustomVariables(prev => ({
                        ...prev,
                        [variable]: e.target.value
                      }))}
                      placeholder={`Enter ${variable}`}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>
              <Button
                onClick={handleRender}
                disabled={rendering}
                className="mt-3"
                size="sm"
              >
                {rendering ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Rendering...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-3 w-3" />
                    Update Preview
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Subject Preview */}
          {renderedSubject && (
            <div>
              <Label className="text-sm font-semibold">Subject Line</Label>
              <div className="mt-2 p-3 bg-muted rounded border">
                <p className="font-medium">{renderedSubject}</p>
              </div>
            </div>
          )}

          {/* Email Preview */}
          <div>
            <Label className="text-sm font-semibold">Email Preview</Label>
            <div className="mt-2 border rounded-lg overflow-hidden bg-white">
              {rendering ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : renderedHtml ? (
                <div
                  className="p-4"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  <p>Click "Update Preview" to render the template</p>
                </div>
              )}
            </div>
          </div>

          {/* Raw HTML View */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
              View Raw HTML
            </summary>
            <div className="mt-2 p-3 bg-muted rounded border text-xs font-mono overflow-x-auto">
              <pre>{renderedHtml}</pre>
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
