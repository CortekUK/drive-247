"use client";

/**
 * Team, while the head admin is the only person on it (lean tenants only —
 * `app/(dashboard)/users/page.tsx` decides when this renders: every loaded
 * `app_users` row is the signed-in user).
 *
 * The action opens the page's own Add User dialog, which creates the login
 * and shows the credentials to pass on — it does not email an invite, so the
 * copy says "add", never "invite".
 */

import { Plus, Users } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { UsersEmptyArt } from "@/components/illustrations-v2/scenes/users";

export function UsersTeachingEmptyState({ onAddUser }: { onAddUser: () => void }) {
  return (
    <TeachingEmptyState
      icon={Users}
      illustration={<UsersEmptyArt />}
      headline="Bring your team in"
      body="Give each person their own login and choose what they can see and change."
      primaryAction={{
        label: "Add a team member",
        onClick: onAddUser,
        icon: Plus,
        hint: "Create their login and pick a role: admin, manager, operations or viewer.",
      }}
    />
  );
}
