'use client';

import { GraduationCap, Loader2, PlayCircle } from 'lucide-react';
import { SectionTitle } from './section-title';
import { Checkbox } from '@/components/ui/checkbox';
import { useBonzahTrainingVideos } from '@/hooks/use-bonzah-training';

interface Step8TrainingProps {
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
}

export function Step8Training({ acknowledged, onAcknowledgedChange }: Step8TrainingProps) {
  const { data: videos, isLoading } = useBonzahTrainingVideos();

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={GraduationCap}
        title="Bonzah Training"
        description="Watch these short videos so you know how Bonzah protection works for your rentals. You'll answer a quick quiz next."
      />

      {isLoading ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading training…
        </div>
      ) : !videos || videos.length === 0 ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          No training videos are configured yet. You can continue.
        </div>
      ) : (
        <div className="space-y-6">
          {videos.map((v) => (
            <div key={v.id} className="rounded-xl border border-border/70 overflow-hidden">
              <div className="flex items-start gap-2 px-4 pt-4 pb-3">
                <PlayCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold leading-tight">{v.title}</h4>
                  {v.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                  )}
                </div>
              </div>
              <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
                <iframe
                  src={v.loom_url}
                  title={v.title}
                  allowFullScreen
                  className="absolute inset-0 h-full w-full"
                  style={{ border: 0 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-border/70 p-4 cursor-pointer">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(c) => onAcknowledgedChange(c === true)}
          className="mt-0.5"
        />
        <span className="text-sm">
          I've watched the training and understand how Bonzah coverage is offered to my renters.
        </span>
      </label>
    </div>
  );
}
