/**
 * LeadNotesList — Spec Section 6.4 (Notes section).
 * Pinned first, then chronological. Inline composer at top.
 */
"use client";

import { useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLeadNotes, useAddLeadNote, useTogglePinNote, useDeleteLeadNote } from "@/hooks/use-lead-notes";

export function LeadNotesList({ leadId }: { leadId: string }) {
  const { data: notes = [] } = useLeadNotes(leadId);
  const add = useAddLeadNote();
  const togglePin = useTogglePinNote();
  const del = useDeleteLeadNote();
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const body = draft.trim();
    if (!body) return;
    add.mutate({ leadId, body }, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add an internal note…"
        className="min-h-[60px] text-sm"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleAdd} disabled={add.isPending || !draft.trim()}>
          {add.isPending ? "Saving…" : "Add note"}
        </Button>
      </div>

      {notes.length === 0 && <p className="text-xs text-[#737373]">No notes yet.</p>}
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-md border border-[#f1f5f9] bg-[#fefce8] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap text-sm text-[#404040]">{note.body}</p>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => togglePin.mutate({ noteId: note.id, leadId, isPinned: !note.is_pinned })}
                  className="rounded p-1 text-[#737373] hover:bg-amber-100"
                  aria-label={note.is_pinned ? "Unpin" : "Pin"}
                >
                  <Pin className={note.is_pinned ? "h-3.5 w-3.5 fill-current text-amber-600" : "h-3.5 w-3.5"} />
                </button>
                <button
                  type="button"
                  onClick={() => del.mutate({ noteId: note.id, leadId })}
                  className="rounded p-1 text-[#737373] hover:bg-red-100"
                  aria-label="Delete note"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-[#737373]">
              {new Date(note.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
