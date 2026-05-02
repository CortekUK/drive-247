"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initials(name: string | null | undefined, email: string) {
  const source = (name && name.trim()) || email;
  const parts = source.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AssigneeAvatar({
  user,
  size = "sm",
  className,
}: {
  user: { name: string | null; email: string; avatar_url: string | null } | null | undefined;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "md" ? "h-8 w-8" : size === "xs" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]";
  if (!user) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          sizeClass,
          className,
        )}
        title="Unassigned"
      >
        —
      </span>
    );
  }
  return (
    <Avatar className={cn(sizeClass, className)} title={user.name || user.email}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt={user.name || user.email} /> : null}
      <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
    </Avatar>
  );
}
