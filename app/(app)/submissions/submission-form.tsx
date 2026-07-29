"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { FormState } from "./actions";
import { PhotoUploader } from "@/components/photo-uploader";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CONDITIONS,
  CONDITION_LABEL,
  DEFAULT_DEADLINE_DAYS,
  SEVERITIES,
  SEVERITY_LABEL,
  TYPE_LABEL,
  defaultDeadline,
  toDateInput,
  type Condition,
  type Severity,
  type SubmissionType,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

export type FacilityOption = {
  id: number;
  code: string;
  name: string;
  location: string;
};

export type SubmissionDefaults = {
  type: SubmissionType;
  title?: string;
  description?: string;
  photos?: string[];
  facility_id?: number;
  severity?: Severity | null;
  code?: string;
  name?: string;
  category?: string;
  location?: string;
  condition?: Condition;
  quantity?: number;
  acquired_date?: string | null;
  notes?: string | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Menyimpan…" : label}
    </Button>
  );
}

/**
 * One form for both kinds of submission and for both create and revise.
 *
 * The type toggle is disabled in revise mode: `type` is immutable in the
 * database, so offering the switch would only produce an error message.
 */
export function SubmissionForm({
  action,
  facilities,
  userId,
  defaults,
  mode = "create",
  submitLabel = "Kirim pengajuan",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  facilities: FacilityOption[];
  userId: string;
  defaults?: SubmissionDefaults;
  mode?: "create" | "revise";
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    error: null,
  });
  const [type, setType] = useState<SubmissionType>(defaults?.type ?? "damage");
  const err = state.fields ?? {};
  const isRevise = mode === "revise";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="type" value={type} />

      {!isRevise && (
        <div
          role="radiogroup"
          aria-label="Jenis pengajuan"
          className="inline-flex rounded-lg border border-border p-1"
        >
          {(["damage", "asset"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                type === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <FieldGroup>
        {type === "damage" ? (
          <Field data-invalid={err.facility_id ? true : undefined}>
            <FieldLabel htmlFor="facility_id">Fasilitas</FieldLabel>
            <select
              id="facility_id"
              name="facility_id"
              defaultValue={defaults?.facility_id ?? ""}
              required
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              <option value="" disabled>
                Pilih fasilitas…
              </option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name} ({f.location})
                </option>
              ))}
            </select>
            {facilities.length === 0 && (
              <FieldDescription>
                Belum ada sarana yang disetujui. Ajukan data sarana lebih dulu.
              </FieldDescription>
            )}
            {err.facility_id && <FieldError>{err.facility_id}</FieldError>}
          </Field>
        ) : null}

        <Field data-invalid={err.title ? true : undefined}>
          <FieldLabel htmlFor="title">Judul</FieldLabel>
          <Input
            id="title"
            name="title"
            defaultValue={defaults?.title}
            required
            aria-invalid={err.title ? true : undefined}
          />
          {err.title && <FieldError>{err.title}</FieldError>}
        </Field>

        {type === "damage" && (
          <Field data-invalid={err.severity ? true : undefined}>
            <FieldLabel htmlFor="severity">Tingkat kerusakan</FieldLabel>
            <select
              id="severity"
              name="severity"
              defaultValue={defaults?.severity ?? ""}
              required
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              <option value="" disabled>
                Pilih…
              </option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
            {err.severity && <FieldError>{err.severity}</FieldError>}
          </Field>
        )}

        {type === "asset" && (
          <>
            <Field data-invalid={err.code ? true : undefined}>
              <FieldLabel htmlFor="code">Kode aset</FieldLabel>
              <Input id="code" name="code" defaultValue={defaults?.code} required />
              <FieldDescription>Harus unik, mis. AC-GD1-004</FieldDescription>
              {err.code && <FieldError>{err.code}</FieldError>}
            </Field>

            <Field data-invalid={err.name ? true : undefined}>
              <FieldLabel htmlFor="name">Nama sarana</FieldLabel>
              <Input id="name" name="name" defaultValue={defaults?.name} required />
              {err.name && <FieldError>{err.name}</FieldError>}
            </Field>

            <Field data-invalid={err.category ? true : undefined}>
              <FieldLabel htmlFor="category">Kategori</FieldLabel>
              <Input
                id="category"
                name="category"
                defaultValue={defaults?.category}
                required
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                <option value="AC" />
                <option value="Meubel" />
                <option value="Elektronik" />
                <option value="Bangunan" />
                <option value="Kendaraan" />
              </datalist>
              {err.category && <FieldError>{err.category}</FieldError>}
            </Field>

            <Field data-invalid={err.location ? true : undefined}>
              <FieldLabel htmlFor="location">Lokasi</FieldLabel>
              <Input
                id="location"
                name="location"
                defaultValue={defaults?.location}
                required
              />
              {err.location && <FieldError>{err.location}</FieldError>}
            </Field>

            <Field data-invalid={err.condition ? true : undefined}>
              <FieldLabel htmlFor="condition">Kondisi</FieldLabel>
              <select
                id="condition"
                name="condition"
                defaultValue={defaults?.condition ?? "baik"}
                required
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </select>
              {err.condition && <FieldError>{err.condition}</FieldError>}
            </Field>

            <Field data-invalid={err.quantity ? true : undefined}>
              <FieldLabel htmlFor="quantity">Jumlah</FieldLabel>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                defaultValue={defaults?.quantity ?? 1}
                required
              />
              {err.quantity && <FieldError>{err.quantity}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="acquired_date">Tanggal perolehan</FieldLabel>
              <Input
                id="acquired_date"
                name="acquired_date"
                type="date"
                defaultValue={defaults?.acquired_date ?? ""}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="notes">Catatan</FieldLabel>
              <Textarea id="notes" name="notes" defaultValue={defaults?.notes ?? ""} />
            </Field>
          </>
        )}

        <Field data-invalid={err.description ? true : undefined}>
          <FieldLabel htmlFor="description">Deskripsi</FieldLabel>
          <Textarea
            id="description"
            name="description"
            defaultValue={defaults?.description}
            required
            aria-invalid={err.description ? true : undefined}
          />
          {err.description && <FieldError>{err.description}</FieldError>}
        </Field>

        <Field>
          <FieldLabel>Foto</FieldLabel>
          <PhotoUploader
            name="photos"
            userId={userId}
            defaultPaths={defaults?.photos ?? []}
          />
        </Field>

        {!isRevise && (
          <Field data-invalid={err.deadline ? true : undefined}>
            <FieldLabel htmlFor="deadline">Deadline</FieldLabel>
            <Input
              id="deadline"
              name="deadline"
              type="date"
              min={toDateInput(new Date())}
              defaultValue={defaultDeadline()}
              required
            />
            <FieldDescription>
              Default {DEFAULT_DEADLINE_DAYS} hari sejak hari ini. Tidak bisa diubah
              setelah dikirim.
            </FieldDescription>
            {err.deadline && <FieldError>{err.deadline}</FieldError>}
          </Field>
        )}

        {state.error && (
          <FieldError className="text-sm" role="alert">
            {state.error}
          </FieldError>
        )}

        <div className="flex gap-2">
          <SubmitButton label={submitLabel} />
        </div>
      </FieldGroup>
    </form>
  );
}
