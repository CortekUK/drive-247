'use client';

/**
 * Displays document + selfie images via backend-generated signed URLs.
 * URLs are short-lived (5 min) — the parent page fetches them fresh on
 * load. No caching, no permanent URLs, no S3 keys exposed client-side.
 */
interface Props {
  documentFrontUrl: string | null;
  documentBackUrl: string | null;
  selfieUrl: string | null;
}

export function DocumentImageViewer({
  documentFrontUrl,
  documentBackUrl,
  selfieUrl,
}: Props) {
  const items = [
    { url: documentFrontUrl, label: 'Document (front)' },
    { url: documentBackUrl, label: 'Document (back)' },
    { url: selfieUrl, label: 'Selfie' },
  ].filter((i) => Boolean(i.url));

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No images uploaded yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.url ?? ''}
            alt={item.label}
            className="w-full h-48 object-cover rounded-md border border-[#f1f5f9] bg-[#f8fafc]"
          />
        </div>
      ))}
    </div>
  );
}
