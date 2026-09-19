"use client";

/**
 * v2 (northwind): the Team list on /users.
 *
 * A plain list on the page: no card, no table inside a card, no search and no
 * icons (team lead, Settings walkthrough, Sep 2026: "Don't show it like a
 * card... just show a simple list"). The column heads, cells and status tones
 * are the v2 list kit's (`components/shared/list-table-v2`), so it still reads
 * like every other v2 list. `ListTable` is not used because it IS the card.
 *
 * A tenant's staff is a handful of people, so every row renders at once: no
 * progressive fill, no pager, no count line. The order is the page query's
 * (newest added first) and the columns do not sort.
 *
 * Rows open nothing. There is no /users/[id] route and a v1 row opens nothing
 * either. The ⋯ menu keeps every v1 action and every v1 condition: Change Role
 * never for a head admin, Edit Permissions only for a manager, Activate or
 * Deactivate never on your own row. Each item calls a handler the page passes
 * with v1's own body, so the dialogs and mutations run exactly as in v1, and
 * Deactivate still fires at once with no confirmation.
 *
 * Below `lg` the same people are one stacked row each (name, email, role and
 * status), with the same menu, so nothing hides off the right edge. The table
 * needs 600px, and between `sm` and `lg` the v2 sidebar (16rem) and the page
 * padding leave less than that, so it would scroll sideways there.
 */

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Table, TableHeader, TableRow } from "@/components/ui-v2/table";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  LIST_TONES,
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
} from "@/components/shared/list-table-v2";
import { describeLoadError } from "@/components/settings-v2/section-states";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/stores/auth-store";

/** Hover text for the "Can't sign in" flag. v1's own wording. */
export const CANT_SIGN_IN_HINT =
  "This user has no login account, so they cannot sign in. Remove them and add them again.";

/** The copy for the three non-list states, one place. */
export const TEAM_LIST_COPY = {
  loading: "Loading your team",
  empty: 'No one has been added yet. Select "Add User" to give someone access to your portal.',
  errorTitle: "Couldn't load your team",
} as const;

interface RowActions<T> {
  /** The signed-in user's id: their own row offers no Activate/Deactivate. */
  currentUserId: string | undefined;
  onResetPassword: (user: T) => void;
  onChangeRole: (user: T) => void;
  onEditPermissions: (user: T) => void;
  onToggleActive: (user: T) => void;
}

function displayName(user: AppUser): string {
  return user.name || "N/A";
}

/**
 * The ⋯ menu, shared by the table row and the phone row. Text only, with v1's
 * labels, which are also the titles of the dialogs they open.
 */
function UserRowMenu<T extends AppUser>({
  user,
  currentUserId,
  onResetPassword,
  onChangeRole,
  onEditPermissions,
  onToggleActive,
  className,
}: RowActions<T> & { user: T; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(LIST_ROW_ACTION, className)}
          aria-label={`Actions for ${user.name || user.email}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onResetPassword(user)}>Reset Password</DropdownMenuItem>
        {user.role !== "head_admin" && (
          <DropdownMenuItem onClick={() => onChangeRole(user)}>Change Role</DropdownMenuItem>
        )}
        {user.role === "manager" && (
          <DropdownMenuItem onClick={() => onEditPermissions(user)}>Edit Permissions</DropdownMenuItem>
        )}
        {user.id !== currentUserId && (
          <DropdownMenuItem onClick={() => onToggleActive(user)}>
            {user.is_active ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Active or Inactive as coloured text, with the account's two flags as small
 * lines under it. A row whose auth account is gone cannot sign in and cannot be
 * password-reset; without the flag it looks like a normal user, which is how an
 * admin ends up resetting the wrong one of two similar rows.
 */
function UserStatus({ user, className }: { user: AppUser; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <ListStatusText tone={user.is_active ? "success" : "danger"}>
        {user.is_active ? "Active" : "Inactive"}
      </ListStatusText>
      {!user.auth_user_id && (
        <span className={cn("text-xs font-medium", LIST_TONES.danger)} title={CANT_SIGN_IN_HINT}>
          Can&apos;t sign in
        </span>
      )}
      {user.must_change_password && <span className="text-xs text-muted-foreground">Temporary password</span>}
    </div>
  );
}

export function UsersTableV2<T extends AppUser>({
  users,
  loading = false,
  error,
  onRetry,
  retrying = false,
  roleLabel,
  ...actions
}: RowActions<T> & {
  /** Every user the page query returned, in its order. `undefined` while none have arrived. */
  users: T[] | undefined;
  /** True until the first rows arrive. */
  loading?: boolean;
  /** The query's error. Shown only when there are no rows to show instead. */
  error?: unknown;
  /** Usually the query's `refetch`. */
  onRetry?: () => unknown;
  /** True while a retry is in flight. */
  retrying?: boolean;
  /** The page's `getRoleDisplay`. */
  roleLabel: (role: string) => string;
}) {
  const rows = users ?? [];

  if (rows.length === 0 && error) {
    return (
      <div role="alert" data-team-state="error" className="py-10 text-center">
        <p className="font-medium text-foreground">{TEAM_LIST_COPY.errorTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{describeLoadError(error)}</p>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void onRetry()}
            disabled={retrying}
          >
            {retrying ? "Trying…" : "Try again"}
          </Button>
        )}
      </div>
    );
  }

  if (rows.length === 0 && loading) {
    return (
      <div role="status" aria-busy="true" data-team-state="loading">
        <span className="sr-only">{TEAM_LIST_COPY.loading}</span>
        <div aria-hidden="true" className="divide-y">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-6 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40 max-w-full rounded-full" />
                <Skeleton className="h-3 w-56 max-w-full rounded-full" />
              </div>
              <Skeleton className="hidden h-3.5 w-20 rounded-full lg:block" />
              <Skeleton className="h-3.5 w-16 rounded-full" />
              <Skeleton className="size-8 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p data-team-state="empty" className="py-10 text-center text-sm text-muted-foreground">
        {TEAM_LIST_COPY.empty}
      </p>
    );
  }

  return (
    <>
      {/* Phones and narrow windows: one stacked row per person. The table
          below is hidden here. */}
      <ul className="divide-y lg:hidden" aria-label="Team">
        {rows.map((user) => (
          <li key={user.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className={cn("truncate", LIST_CLASSES.identifier)} title={displayName(user)}>
                {displayName(user)}
              </p>
              <p className="truncate text-sm text-muted-foreground" title={user.email}>
                {user.email}
              </p>
              <div className="mt-1 flex items-start gap-3 text-sm">
                <span className={LIST_CLASSES.text}>{roleLabel(user.role)}</span>
                <UserStatus user={user} />
              </div>
            </div>
            <UserRowMenu user={user} {...actions} />
          </li>
        ))}
      </ul>

      {/* From `lg`: the table, straight on the page. Should it still get less
          than 600px of room it scrolls sideways inside its own box instead of
          crushing Status. Name and email truncate with their full text in a
          tooltip. */}
      <div className="hidden lg:block">
        <Table className="min-w-[600px] table-fixed">
          {/* Not the kit's ListTableHeader: that one is sticky on the card's
              colour, which is a visible band on the dark page ground. */}
          <TableHeader>
            <TableRow className={LIST_CLASSES.headerRow}>
              <ListHead className="w-[44%]">Name</ListHead>
              <ListHead className="w-[18%]">Role</ListHead>
              <ListHead className="w-[24%]">Status</ListHead>
              <ListHead className="w-[14%]">Actions</ListHead>
            </TableRow>
          </TableHeader>
          <ListBody>
            {rows.map((user) => (
              <ListRow key={user.id}>
                <ListCell>
                  <span className={cn("block truncate", LIST_CLASSES.identifier)} title={displayName(user)}>
                    {displayName(user)}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground" title={user.email}>
                    {user.email}
                  </span>
                </ListCell>
                {/* A role is a category, not a state: plain text, no colour. */}
                <ListCell className="whitespace-nowrap">
                  <span className={LIST_CLASSES.text}>{roleLabel(user.role)}</span>
                </ListCell>
                <ListCell className="whitespace-normal">
                  <UserStatus user={user} className="items-center" />
                </ListCell>
                {/* Rows open nothing, but the menu's clicks (portalled items are
                    still React children of this cell) stop here all the same. */}
                <ListCell onClick={(e) => e.stopPropagation()}>
                  {/* `flex mx-auto`: an inline button sits on the text baseline
                      and made the row taller; as a block it centres under the
                      Actions heading. */}
                  <UserRowMenu user={user} {...actions} className="mx-auto flex" />
                </ListCell>
              </ListRow>
            ))}
          </ListBody>
        </Table>
      </div>
    </>
  );
}
