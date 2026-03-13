'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';
import { Maximize2, Minimize2 } from 'lucide-react';

// Global counter to ensure unique IDs across renders
let mermaidCounter = 0;

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const idRef = useRef<string>(`mermaid_diagram_${++mermaidCounter}`);
  const { branding } = useTenantBranding();
  const accentColor = branding?.accent_color || '#6366f1';

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import('mermaid')).default;

        // Reset mermaid state before re-initializing
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          themeVariables: {
            primaryColor: `${accentColor}30`,
            primaryBorderColor: accentColor,
            primaryTextColor: '#e2e8f0',
            lineColor: `${accentColor}90`,
            secondaryColor: `${accentColor}15`,
            tertiaryColor: `${accentColor}10`,
            fontFamily: 'DM Sans, Inter, system-ui, sans-serif',
            fontSize: '13px',
            nodeBorder: accentColor,
            mainBkg: `${accentColor}20`,
            clusterBkg: `${accentColor}08`,
            clusterBorder: `${accentColor}30`,
            titleColor: '#e2e8f0',
            edgeLabelBackground: '#1e293b',
            nodeTextColor: '#e2e8f0',
          },
          flowchart: {
            htmlLabels: true,
            curve: 'basis',
            padding: 16,
            nodeSpacing: 50,
            rankSpacing: 60,
            useMaxWidth: true,
          },
        });

        // Create a temporary container for mermaid to render into
        // (mermaid.render needs an existing element in the DOM in some versions)
        const tempDiv = document.createElement('div');
        tempDiv.id = idRef.current;
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        document.body.appendChild(tempDiv);

        try {
          const { svg: renderedSvg } = await mermaid.render(
            idRef.current,
            chart.trim()
          );

          if (!cancelled) {
            setSvg(renderedSvg);
            setError(null);
          }
        } finally {
          // Clean up temp element
          if (document.body.contains(tempDiv)) {
            document.body.removeChild(tempDiv);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Mermaid render error:', err);
          // Try to clean up any leftover mermaid error elements
          const errorEl = document.getElementById(`d${idRef.current}`);
          if (errorEl) errorEl.remove();

          setError('Could not render diagram');
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart, accentColor]);

  if (error) {
    return (
      <div className="rounded-xl border border-border/40 bg-secondary/20 p-4 text-sm text-muted-foreground">
        <p>{error}</p>
        <pre className="mt-2 text-xs opacity-60 whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border/40 bg-secondary/10 p-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: `${accentColor}40`, borderTopColor: 'transparent' }}
          />
          Rendering diagram...
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group/diagram relative rounded-xl border bg-background/50 overflow-hidden transition-all duration-300 animate-fade-in',
        expanded ? 'my-3' : 'my-2'
      )}
      style={{ borderColor: `${accentColor}25` }}
    >
      {/* Subtle gradient top bar */}
      <div
        className="h-px w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)`,
        }}
      />

      {/* Expand/collapse toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'absolute top-2 right-2 z-10 p-1.5 rounded-lg',
          'bg-background/80 border border-border/40 backdrop-blur-sm',
          'opacity-0 group-hover/diagram:opacity-100 transition-all duration-200',
          'hover:bg-secondary hover:scale-105'
        )}
      >
        {expanded ? (
          <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* SVG container */}
      <div
        ref={containerRef}
        className={cn(
          'flex items-center justify-center overflow-x-auto p-6',
          expanded ? 'max-h-none' : 'max-h-[500px]',
          '[&_svg]:max-w-full [&_svg]:h-auto',
        )}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {/* Footer label */}
      <div className="flex items-center justify-center border-t py-1.5" style={{ borderColor: `${accentColor}15` }}>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-medium">
          Flow Diagram
        </span>
      </div>
    </div>
  );
}
