'use client';

import { useEffect, useRef, useState } from 'react';
import { Input, Label } from '@drive247/ui';
import { customersApi } from '@/lib/api';
import type { CustomerResponse } from '@drive247/shared-types';

interface Props {
  value: CustomerResponse | null;
  onChange: (customer: CustomerResponse | null) => void;
}

export function CustomerPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CustomerResponse[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const { data: res } = await customersApi.list({
          search: search.trim() || undefined,
          status: undefined,
          limit: 10,
        } as never);
        if (res.success) setResults(res.data.items);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search, open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="space-y-2" ref={wrapRef}>
      <Label>Customer</Label>
      {value ? (
        <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-sm">
          <div>
            <div className="font-medium">{value.name}</div>
            <div className="text-xs text-muted-foreground">
              {value.email || value.phone || '—'}
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-[#6366f1] hover:underline"
            onClick={() => {
              onChange(null);
              setSearch('');
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            placeholder="Search customers by name, email, or phone"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="bg-white"
          />
          {open && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-auto rounded-md border bg-white shadow-sm">
              {results.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No customers found
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f1f5f9]"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.email || c.phone || '—'}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
