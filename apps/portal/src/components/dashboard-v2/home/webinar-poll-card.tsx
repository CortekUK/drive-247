'use client';

/**
 * Webinar polls — the very last thing on the v2 home.
 *
 * A super admin publishes them (admin → Customer management → Webinar Poll).
 * Each live poll the tenant isn't excluded from shows here; the company
 * answers once, and the card then thanks them and shows what they chose.
 * Reads and writes go through get_my_webinar_polls() /
 * submit_webinar_poll_response(), which check tenant, status and options
 * server-side. Renders nothing when there is no live poll.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { cn } from '@/lib/utils';
import { Eyebrow } from './ui';

type Kind = 'single' | 'multi' | 'text';

interface Poll {
  id: string;
  question: string;
  kind: Kind;
  options: { id: string; label: string }[];
  response: { option_ids: string[]; text_answer: string | null; created_at: string } | null;
}

function usePolls() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['webinar-polls', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<Poll[]> => {
      const { data, error } = await supabaseUntyped.rpc('get_my_webinar_polls');
      if (error) throw error;
      return Array.isArray(data) ? (data as Poll[]) : [];
    },
  });
}

export function WebinarPolls() {
  const { data } = usePolls();
  if (!data || data.length === 0) return null;
  return (
    <div className="space-y-5">
      {data.map((poll) => (
        <PollCard key={poll.id} poll={poll} />
      ))}
    </div>
  );
}

function PollCard({ poll }: { poll: Poll }) {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabaseUntyped.rpc('submit_webinar_poll_response', {
        p_poll_id: poll.id,
        p_option_ids: poll.kind === 'text' ? [] : picked,
        p_text: poll.kind === 'text' ? text : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['webinar-polls', tenant?.id] }),
    onError: (e: Error) => {
      toast.error("We couldn't send your answer", { description: e.message });
      void queryClient.invalidateQueries({ queryKey: ['webinar-polls', tenant?.id] });
    },
  });

  const toggle = (id: string) =>
    setPicked((cur) => (poll.kind === 'single' ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const ready = poll.kind === 'text' ? text.trim().length > 0 : picked.length > 0;
  const labelOf = new Map(poll.options.map((o) => [o.id, o.label]));

  return (
    <div className="rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] p-6">
      <Eyebrow>Webinar poll</Eyebrow>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--pv-ink)]">{poll.question}</h3>

      {poll.response ? (
        /* Answered — thank them and show what the company chose. */
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-[color-mix(in_srgb,var(--pv-accent)_8%,var(--pv-paper))] p-4">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent)] text-[var(--pv-on-accent)]">
            <Check className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 text-[13px]">
            <p className="font-medium text-[var(--pv-ink)]">Thanks — your answer is in.</p>
            <p className="mt-0.5 text-[var(--pv-ink-2)]">
              {poll.kind === 'text'
                ? `“${poll.response.text_answer}”`
                : poll.response.option_ids.map((id) => labelOf.get(id) ?? '—').join(', ')}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-[var(--pv-ink-3)]">
            {poll.kind === 'single' ? 'Choose one.' : poll.kind === 'multi' ? 'Choose all that apply.' : 'Type your answer.'} One answer per
            company.
          </p>

          {poll.kind === 'text' ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Your answer"
              className="mt-4 w-full resize-none rounded-xl border border-[var(--pv-line)] bg-transparent px-4 py-3 text-[14px] text-[var(--pv-ink)] outline-none transition-colors placeholder:text-[var(--pv-ink-3)] focus:border-[var(--pv-accent)]"
            />
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {poll.options.map((o) => {
                const on = picked.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role={poll.kind === 'single' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    onClick={() => toggle(o.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[14px] transition-colors duration-200 motion-reduce:transition-none',
                      on
                        ? 'border-[var(--pv-accent)] bg-[color-mix(in_srgb,var(--pv-accent)_8%,var(--pv-paper))] text-[var(--pv-ink)]'
                        : 'border-[var(--pv-line)] text-[var(--pv-ink-2)] hover:border-[color-mix(in_srgb,var(--pv-accent)_45%,var(--pv-line))]',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center border transition-colors',
                        poll.kind === 'single' ? 'rounded-full' : 'rounded-[4px]',
                        on ? 'border-[var(--pv-accent)] bg-[var(--pv-accent)] text-[var(--pv-on-accent)]' : 'border-[var(--pv-ink-3)]',
                      )}
                    >
                      {on && (poll.kind === 'single' ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Check className="h-3 w-3" />)}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={!ready || submit.isPending}
              onClick={() => submit.mutate()}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--pv-accent)] px-5 text-[13px] font-medium text-[var(--pv-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit answer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
