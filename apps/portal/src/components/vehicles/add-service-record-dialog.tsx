import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wrench, Plus, Edit } from "lucide-react";
import { ServiceRecord, ServiceFormData } from "@/hooks/use-vehicle-services";
import { addServiceRecordSchema } from "@/client-schemas/vehicles/add-service-record";

interface AddServiceRecordDialogProps {
  onSubmit: (data: ServiceFormData) => void;
  isLoading: boolean;
  editingRecord?: ServiceRecord;
  trigger?: React.ReactNode;
}

export function AddServiceRecordDialog({ 
  onSubmit, 
  isLoading, 
  editingRecord,
  trigger 
}: AddServiceRecordDialogProps) {
  const [open, setOpen] = useState(false);

  const form = useForm<ServiceFormData>({
    resolver: zodResolver(addServiceRecordSchema),
    defaultValues: {
      service_date: editingRecord?.service_date || new Date().toISOString().split('T')[0],
      service_type: editingRecord?.service_type || "",
      mileage: editingRecord?.mileage || undefined,
      description: editingRecord?.description || "",
      cost: editingRecord?.cost || 0,
    },
  });

  const handleSubmit = (data: ServiceFormData) => {
    if (editingRecord) {
      onSubmit({ ...data, id: editingRecord.id } as any);
    } else {
      onSubmit(data);
    }
    setOpen(false);
    form.reset();
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen && !editingRecord) {
      form.reset();
    }
  };

  const defaultTrigger = (
    <Button size="sm">
      {editingRecord ? <Edit className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
      {editingRecord ? "Edit" : "Add Service Record"}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {editingRecord ? "Edit Service Record" : "Add Service Record"}
          </DialogTitle>
          <DialogDescription>
            {editingRecord ? "Update the service record details." : "Record a new service performed on this vehicle."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="service_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Date <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="service_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Type <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select service type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Oil Change">Oil Change</SelectItem>
                      <SelectItem value="Tire Rotation">Tire Rotation</SelectItem>
                      <SelectItem value="Brake Service">Brake Service</SelectItem>
                      <SelectItem value="Battery Replacement">Battery Replacement</SelectItem>
                      <SelectItem value="Air Filter">Air Filter</SelectItem>
                      <SelectItem value="Transmission Service">Transmission Service</SelectItem>
                      <SelectItem value="Coolant Flush">Coolant Flush</SelectItem>
                      <SelectItem value="Spark Plugs">Spark Plugs</SelectItem>
                      <SelectItem value="Wheel Alignment">Wheel Alignment</SelectItem>
                      <SelectItem value="AC Service">AC Service</SelectItem>
                      <SelectItem value="General Inspection">General Inspection</SelectItem>
                      <SelectItem value="MOT">MOT</SelectItem>
                      <SelectItem value="Full Service">Full Service</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mileage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mileage</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      placeholder="Enter mileage"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cost ($)</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Service details, parts replaced, etc."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : editingRecord ? "Update Record" : "Add Record"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}