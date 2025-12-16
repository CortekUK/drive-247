import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2 } from "lucide-react";
import { ServiceRecord } from "@/hooks/use-vehicle-services";
import { AddServiceRecordDialog } from "./add-service-record-dialog";

interface ServiceHistoryTableProps {
  serviceRecords: ServiceRecord[];
  onEdit: (data: any) => void;
  onDelete: (id: string) => void;
  isEditing: boolean;
  isDeleting: boolean;
}

export function ServiceHistoryTable({ 
  serviceRecords, 
  onEdit, 
  onDelete, 
  isEditing, 
  isDeleting 
}: ServiceHistoryTableProps) {
  const [editingRecord, setEditingRecord] = useState<ServiceRecord | undefined>();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (serviceRecords.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No service records found.</p>
        <p className="text-sm">Add your first service record to start tracking maintenance history.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Mileage</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {serviceRecords.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="font-medium">
                {formatDate(record.service_date)}
              </TableCell>
              <TableCell>
                {record.mileage ? record.mileage.toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                <div className="max-w-xs">
                  {record.description ? (
                    <p className="text-sm truncate" title={record.description}>
                      {record.description}
                    </p>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={record.cost > 0 ? "font-medium" : "text-muted-foreground"}>
                    {formatCurrency(record.cost)}
                  </span>
                  {record.cost > 0 && <Badge variant="secondary" className="text-xs">P&L</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <AddServiceRecordDialog
                    onSubmit={onEdit}
                    isLoading={isEditing}
                    editingRecord={record}
                    trigger={
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    }
                  />
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Service Record</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this service record from {formatDate(record.service_date)}? 
                          This will also remove any associated P&L entries. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDelete(record.id)}
                          disabled={isDeleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}