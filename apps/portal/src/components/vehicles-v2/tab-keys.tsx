"use client";

/**
 * OPERATIONS — Keys & documents.
 *
 * Custody of the physical car and its papers. Nothing on this tab is ever
 * shown to a customer, which is why it is last in the group: it is the one
 * place an operator looks for something only they need.
 */

import { useRef } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import {
  ActionButton,
  DataRow,
  EmptyHint,
  Field,
  IconButton,
  List,
  Panel,
  Section,
  Select,
  SwitchRow,
  TextInput,
  fmtDate,
  textareaCls,
} from "./kit";
import type { VehicleFile } from "@/hooks/use-vehicle-files";
import type { VehicleRecord } from "./use-vehicle-record";

/** `chk_spare_key_holder` on `vehicles` — these two values or NULL. */
const SPARE_KEY_HOLDERS = [
  { value: "Company", label: "The company" },
  { value: "Customer", label: "The customer" },
];

const fileSize = (bytes: number | null | undefined) => {
  const n = Number(bytes) || 0;
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export function KeysDocsTab({
  vehicle,
  patch,
  patchNow,
  files,
  onUpload,
  onDownload,
  onDelete,
  isUploading,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  patchNow: (fields: Partial<VehicleRecord>) => void;
  files: VehicleFile[];
  onUpload: (file: File) => void;
  onDownload: (file: VehicleFile) => void;
  onDelete: (file: VehicleFile) => void;
  isUploading: boolean;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Panel
      title="Keys & documents"
      description="Custody of the physical car and its papers. None of this is shown to a customer."
    >
      <Section title="Keys & security">
        <List>
          <SwitchRow
            checked={!!vehicle.has_spare_key}
            disabled={readOnly}
            onChange={(v) => patchNow({ has_spare_key: v })}
            label="Spare key"
            hint={
              vehicle.has_spare_key
                ? vehicle.spare_key_holder
                  ? `Held by the ${vehicle.spare_key_holder.toLowerCase()}`
                  : "No holder recorded"
                : "No spare key on file"
            }
          />
          <SwitchRow
            checked={!!vehicle.has_logbook}
            disabled={readOnly}
            onChange={(v) => patchNow({ has_logbook: v })}
            label="Title / logbook on file"
          />
          <SwitchRow
            checked={!!vehicle.has_tracker}
            disabled={readOnly}
            onChange={(v) => patchNow({ has_tracker: v })}
            label="GPS tracker fitted"
          />
          <SwitchRow
            checked={!!vehicle.has_remote_immobiliser}
            disabled={readOnly}
            onChange={(v) => patchNow({ has_remote_immobiliser: v })}
            label="Remote immobiliser fitted"
          />
        </List>

        {vehicle.has_spare_key && (
          <div className="mt-4 grid grid-cols-2 gap-5">
            {/* `chk_spare_key_holder` allows exactly 'Company' or 'Customer'.
                This was a free-text box in an earlier pass, which wrote fine in
                the UI and then failed on the constraint a second later. */}
            <Field label="Spare key held by">
              <Select
                value={vehicle.spare_key_holder}
                onChange={(v) => patchNow({ spare_key_holder: v || null })}
                options={SPARE_KEY_HOLDERS}
                placeholder="Not recorded"
                disabled={readOnly}
              />
            </Field>
            <Field label="Notes">
              <TextInput
                value={vehicle.spare_key_notes}
                onChange={(v) => patch({ spare_key_notes: v })}
                placeholder="Tagged, signed out in the key book"
                disabled={readOnly}
              />
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field label="Security notes">
            <textarea
              value={vehicle.security_notes ?? ""}
              onChange={(e) => patch({ security_notes: e.target.value })}
              rows={2}
              disabled={readOnly}
              placeholder="Tracker make and model, immobiliser fitment, anything the next person needs."
              className={textareaCls}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Documents"
        hint="Title, insurance certificate, purchase invoice, inspection reports."
        action={
          !readOnly && (
            <ActionButton
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {isUploading ? "Uploading" : "File one"}
            </ActionButton>
          )
        }
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />

        {files.length === 0 ? (
          <EmptyHint>Nothing on file for this car yet.</EmptyHint>
        ) : (
          <List>
            {files.map((f) => (
              <DataRow
                key={f.id}
                label={
                  <span className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    {f.file_name}
                  </span>
                }
                sub={`${fmtDate(f.uploaded_at)} · ${fileSize(f.size_bytes)}`}
                right={
                  <div className="flex items-center gap-1">
                    <IconButton title="Download" onClick={() => onDownload(f)}>
                      <Download className="size-3.5" />
                    </IconButton>
                    {!readOnly && (
                      <IconButton title="Remove" onClick={() => onDelete(f)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </div>
                }
              />
            ))}
          </List>
        )}
      </Section>
    </Panel>
  );
}
