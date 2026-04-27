'use client';

import { Megaphone, Sparkles } from 'lucide-react';

interface PreviewItem {
  id: string;
  title: string;
  summary: string | null;
  body_html: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  severity: string;
}

export default function AnnouncementPreview({ item }: { item: PreviewItem }) {
  return (
    <div className="rounded-lg border border-dark-border overflow-hidden bg-white">
      {item.image_url && (
        <img src={item.image_url} alt="" className="w-full h-40 object-cover" />
      )}
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 uppercase tracking-wide">
          {item.severity === 'major' ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Megaphone className="h-3.5 w-3.5" />
          )}
          {item.severity === 'major' ? 'New feature' : "What's new"}
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{item.title || 'Untitled'}</h2>
        {item.summary && <p className="text-sm text-gray-600">{item.summary}</p>}
        {item.body_html && (
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: item.body_html }}
          />
        )}
        <div className="flex items-center gap-2 pt-2">
          {item.cta_label && item.cta_url && (
            <a
              href={item.cta_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2"
            >
              {item.cta_label}
            </a>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 text-sm font-medium px-4 py-2"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
