'use client';

import { useEffect, useRef, useState } from 'react';
import { Input, Label } from '@drive247/ui';
import { rentalsApi, vehiclesApi } from '@/lib/api';
import type { VehicleResponse } from '@drive247/shared-types';

interface Props {
  value: VehicleResponse | null;
  onChange: (vehicle: VehicleResponse | null) => void;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  excludeRentalId?: string;
}

export function VehiclePicker({
  value,
  onChange,
  startDate,
  endDate,
  excludeRentalId,
}: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<VehicleResponse[]>([]);
  const [open, setOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const { data: res } = await vehiclesApi.list({
          search: search.trim() || undefined,
          status: 'active',
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

  // Conflict check: whenever vehicle + dates all set, look for overlapping rentals
  useEffect(() => {
    if (!value || !startDate || !endDate) {
      setConflict(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await rentalsApi.list({
          vehicleId: value.id,
          limit: 50,
        } as never);
        if (cancelled || !res.success) return;
        const overlapping = res.data.items.find((r) => {
          if (excludeRentalId && r.id === excludeRentalId) return false;
          if (r.status !== 'pending' && r.status !== 'active') return false;
          return r.startDate <= endDate && r.endDate >= startDate;
        });
        setConflict(
          overlapping
            ? `Conflict with rental ${overlapping.startDate} → ${overlapping.endDate} (${overlapping.status})`
            : null,
        );
      } catch {
        setConflict(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, startDate, endDate, excludeRentalId]);

  return (
    <div className="space-y-2" ref={wrapRef}>
      <Label>Vehicle</Label>
      {value ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-sm">
            <div>
              <div className="font-medium">{value.reg}</div>
              <div className="text-xs text-muted-foreground">
                {value.make} {value.model} · {value.year}
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
          {conflict && (
            <p className="text-xs text-[#dc2626]">{conflict}</p>
          )}
        </div>
      ) : (
        <div className="relative">
          <Input
            placeholder="Search vehicles by reg, make, or model"
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
                  No active vehicles found
                </div>
              ) : (
                results.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f1f5f9]"
                    onClick={() => {
                      onChange(v);
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium">{v.reg}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.make} {v.model} · {v.year}
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
