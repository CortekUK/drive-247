"use client";

/**
 * v2 (northwind): the Team Members table on /users, built from the rentals
 * list's kit (`components/shared/list-table-v2`). No pager: rows arrive 25 at a
 * time as the table scrolls, with one line under the card saying how much is
 * shown.
 *
 * Rows open nothing. There is no /users/[id] route and a v1 row opens nothing
 * either. The ⋯ menu is v1's menu: the same label, items, icons and conditions
 * (Change Role never for a head admin, Edit Permissions only for a manager,
 * Activate/Deactivate never on your own row). Each item calls a handler the
 * page passes with v1's own body, so the dialogs and mutations run exactly as
 * they do in v1, and Deactivate still fires at once with no confirmation.
 *
 * The query is uncapped (a tenant's staff), so the page hands over its
 * filtered array and a growing slice is the whole mechanism.
 */

import { format } from "date-fns";
import { AlertCircle, Key, MoreHorizontal, Settings2, Shield, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/stores/auth-store";

export function UsersTableV2<T extends AppUser>({
  users,
  resetKey,
  currentUserId,
  roleLabel,
  onResetPassword,
  onChangeRole,
  onEditPermissions,
  onToggleActive,
}: {
  /** Every user the search returns, in the query's order. */
  users: T[];
  /** Changes with the result set (tenant, search) and never on a refetch. */
  resetKey: string;
  /** The signed-in user's id: their own row offers no Activate/Deactivate. */
  currentUserId: string | undefined;
  /** The page's `getRoleDisplay`. */
  roleLabel: (role: string) => string;
  onResetPassword: (user: T) => void;
  onChangeRole: (user: T) => void;
  onEditPermissions: (user: T) => void;
  onToggleActive: (user: T) => void;
}) {
  const userRows = useProgressiveRows(users, resetKey);

  return (
    <>
      {/* Widths, measured in the portal's Manrope: the role ("Head Admin"
          78.5px), "Inactive" with its TEMP PASSWORD chip (152.1px), the created
          date (88.4px) and the 32px menu button all fit at a 944px card and at
          the 880px minimum, inside the kit's 24px of cell padding. Name and
          email truncate with a title. */}
      <ListTable rows={userRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[21%]">Name</ListHead>
          <ListHead className="w-[24%]">Email</ListHead>
          <ListHead className="w-[13%]">Role</ListHead>
          <ListHead className="w-[21%]">Status</ListHead>
          <ListHead className="w-[14%]">Created</ListHead>
          <ListHead className="w-[7%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {userRows.visible.map((user) => (
            <ListRow key={user.id}>
              <ListCell>
                <span className={cn("block truncate", LIST_CLASSES.identifier)} title={user.name || 'N/A'}>
                  {user.name || 'N/A'}
                </span>
                {/* A row whose auth account is gone cannot sign in and cannot be
                    password-reset. Without this it looks like a perfectly normal
                    user, which is exactly how an admin ends up resetting the
                    wrong one of two similar rows. A flag line under the name, as
                    rentals flags a row, so it stays readable however long the
                    name is. */}
                {!user.auth_user_id && (
                  <span
                    className="flex items-center justify-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400"
                    title="This user has no login account, so they cannot sign in. Remove them and add them again."
                  >
                    <AlertCircle className="size-3 shrink-0" />
                    Can&apos;t sign in
                  </span>
                )}
              </ListCell>
              <ListCell>
                <span className={cn("block truncate", LIST_CLASSES.text)} title={user.email}>
                  {user.email}
                </span>
              </ListCell>
              <ListCell className="whitespace-nowrap">
                {/* A role is a category, not a state: plain text, no colour. */}
                <span className={LIST_CLASSES.text}>{roleLabel(user.role)}</span>
              </ListCell>
              <ListCell className="whitespace-nowrap">
                {/* A 20px line with or without the chip, so the chip does not make
                    its rows taller than the rest. */}
                <div className="flex h-5 items-center justify-center gap-2">
                  <ListStatusText tone={user.is_active ? "success" : "danger"}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </ListStatusText>
                  {user.must_change_password && (
                    <span className="shrink-0 leading-none">
                      <ListMetaChip>Temp Password</ListMetaChip>
                    </span>
                  )}
                </div>
              </ListCell>
              <ListCell className="whitespace-nowrap tabular-nums">
                <span className={LIST_CLASSES.text}>{format(new Date(user.created_at), 'MMM d, yyyy')}</span>
              </ListCell>
              {/* Rows open nothing, but the menu's clicks (portalled items are
                  still React children of this cell) stop here all the same. */}
              <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      // `flex`, as on Fines: an inline button sits on the text
                      // baseline and the line's descent made every row 3px taller.
                      className={cn(LIST_ROW_ACTION, "flex ml-auto")}
                      aria-label={`Actions for ${user.name || user.email}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onResetPassword(user)}>
                      <Key className="h-4 w-4" />
                      Reset Password
                    </DropdownMenuItem>
                    {user.role !== 'head_admin' && (
                      <DropdownMenuItem onClick={() => onChangeRole(user)}>
                        <Shield className="h-4 w-4" />
                        Change Role
                      </DropdownMenuItem>
                    )}
                    {user.role === 'manager' && (
                      <DropdownMenuItem onClick={() => onEditPermissions(user)}>
                        <Settings2 className="h-4 w-4" />
                        Edit Permissions
                      </DropdownMenuItem>
                    )}
                    {user.id !== currentUserId && (
                      <DropdownMenuItem onClick={() => onToggleActive(user)}>
                        {user.is_active ? (
                          <>
                            <UserX className="h-4 w-4" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-4 w-4" />
                            Activate
                          </>
                        )}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ListCell>
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
      <ListFooter rows={userRows} one="user" many="users" />
    </>
  );
}
