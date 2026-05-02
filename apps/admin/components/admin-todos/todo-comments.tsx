"use client";

import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { useAdminTodoComments } from "@/hooks/use-admin-todo-comments";
import { AssigneeAvatar } from "./assignee-avatar";

function safeRelative(s: string) {
  try {
    return formatDistanceToNow(parseISO(s), { addSuffix: true });
  } catch {
    return s;
  }
}

export function TodoComments({ todoId }: { todoId: string | null }) {
  const { user } = useAuthStore();
  const { comments, loading, posting, postComment, deleteComment } = useAdminTodoComments(todoId);
  const [draft, setDraft] = useState("");

  const handlePost = async () => {
    if (!draft.trim()) return;
    const ok = await postComment(draft);
    if (ok) setDraft("");
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Comments {comments.length > 0 && <span className="ml-1 text-muted-foreground/70">{comments.length}</span>}
      </h4>

      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Add a comment…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handlePost();
            }
          }}
        />
        <Button onClick={handlePost} disabled={posting || !draft.trim()}>
          {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Post"}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const isOwn = c.author_id && user?.id && c.author_id === user.id;
            return (
              <li key={c.id} className="flex gap-3">
                <AssigneeAvatar user={c.author ?? null} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs">
                      <span className="font-medium">
                        {c.author?.name || c.author?.email || "Unknown user"}
                      </span>{" "}
                      <span className="text-muted-foreground">· {safeRelative(c.created_at)}</span>
                    </p>
                    {isOwn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => deleteComment(c.id)}
                        title="Delete your comment"
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
