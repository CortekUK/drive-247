"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TodoBoard } from "./todo-board";

interface Props {
  tenantId: string;
  tenantName?: string | null;
}

/**
 * Per-tenant Todos tab content. Cards are scoped to the surrounding tenant —
 * cards created here only show on this tenant's detail page.
 */
export function AdminTodosTab({ tenantId, tenantName }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {tenantName ? `${tenantName} — Todos` : "Todos"}
        </CardTitle>
        <CardDescription>
          Internal Kanban board for this tenant. Drag cards between columns to update
          status; click a card to edit, comment, or delete. Visible only on this tenant
          page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TodoBoard tenantId={tenantId} />
      </CardContent>
    </Card>
  );
}
