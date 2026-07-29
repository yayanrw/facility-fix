"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { isRemarksEmpty } from "@/lib/html";
import { cleanRemarks } from "@/lib/sanitize";
import {
  fieldErrors,
  formObject,
  revisionSchema,
  reviewSchema,
  submissionSchema,
} from "@/lib/schemas";
import { createServiceClient } from "@/lib/supabase/service";

export type FormState = {
  error: string | null;
  fields?: Record<string, string>;
};

const OK: FormState = { error: null };

/**
 * Turns a Postgres error into something a person can act on.
 *
 * The database is the last line of defence, not the first, so most of these
 * only fire when someone bypasses the UI — but a raw `duplicate key value
 * violates unique constraint "facilities_code_key"` helps nobody.
 */
function describe(error: { message: string; code?: string }): string {
  const m = error.message;
  if (m.includes("facilities_code_key")) {
    return "Kode aset sudah dipakai fasilitas lain";
  }
  if (m.includes("may not act on a submission with status")) {
    return "Pengajuan ini sudah diproses orang lain. Muat ulang halaman.";
  }
  if (m.includes("a rejection needs a reason")) {
    return "Alasan penolakan wajib diisi";
  }
  if (m.includes("deadline is immutable")) {
    return "Deadline tidak bisa diubah setelah pengajuan dikirim";
  }
  if (m.includes("is not rejected") || m.includes("only the submitter")) {
    return "Pengajuan ini tidak bisa direvisi";
  }
  return m;
}

// ---------------------------------------------------------------------------

export async function createSubmission(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const profile = await requireProfile();
  if (profile.role !== "requester" && profile.role !== "admin") {
    return { error: "Role Anda tidak dapat membuat pengajuan" };
  }

  const parsed = submissionSchema.safeParse(formObject(formData));
  if (!parsed.success) {
    return { error: "Periksa kembali isian form", fields: fieldErrors(parsed.error) };
  }

  const db = createServiceClient();
  const input = parsed.data;

  // One RPC call is one transaction. The asset branch writes a facility and a
  // submission; splitting that across two client calls risks an orphan draft.
  const { data, error } =
    input.type === "damage"
      ? await db.rpc("create_damage_submission", {
          p_actor: profile.id,
          p_facility_id: input.facility_id,
          p_title: input.title,
          p_description: input.description,
          p_severity: input.severity,
          p_deadline: input.deadline,
          p_photos: input.photos,
        })
      : await db.rpc("create_asset_submission", {
          p_actor: profile.id,
          p_title: input.title,
          p_description: input.description,
          p_deadline: input.deadline,
          p_code: input.code,
          p_name: input.name,
          p_category: input.category,
          p_location: input.location,
          p_condition: input.condition,
          p_quantity: input.quantity,
          p_acquired_date: input.acquired_date ?? null,
          p_notes: input.notes ?? null,
          p_photos: input.photos,
        });

  if (error) return { error: describe(error) };

  revalidatePath("/submissions");
  redirect(`/submissions/${data}`);
}

// ---------------------------------------------------------------------------

export async function updateSubmission(
  submissionId: number,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const profile = await requireProfile();

  const parsed = revisionSchema.safeParse(formObject(formData));
  if (!parsed.success) {
    return { error: "Periksa kembali isian form", fields: fieldErrors(parsed.error) };
  }

  const db = createServiceClient();

  // Status and ownership come from the database, never from the form. A
  // hidden field saying "this is mine and it is rejected" proves nothing.
  const { data: current, error: readError } = await db
    .from("submissions")
    .select("id, type, status, submitted_by, facility_id")
    .eq("id", submissionId)
    .single();

  if (readError || !current) return { error: "Pengajuan tidak ditemukan" };
  if (current.submitted_by !== profile.id) {
    return { error: "Hanya pengaju yang dapat merevisi" };
  }
  if (current.status !== "rejected") {
    return { error: "Hanya pengajuan berstatus Ditolak yang dapat direvisi" };
  }

  const input = parsed.data;
  if (input.type !== current.type) {
    return { error: "Jenis pengajuan tidak dapat diubah" };
  }

  const { error } = await db
    .from("submissions")
    .update({
      title: input.title,
      description: input.description,
      photos: input.photos,
      severity: input.type === "damage" ? input.severity : null,
    })
    .eq("id", submissionId);

  if (error) return { error: describe(error) };

  if (input.type === "asset") {
    const { error: facilityError } = await db
      .from("facilities")
      .update({
        code: input.code,
        name: input.name,
        category: input.category,
        location: input.location,
        condition: input.condition,
        quantity: input.quantity,
        acquired_date: input.acquired_date ?? null,
        notes: input.notes ?? null,
      })
      .eq("id", current.facility_id);

    if (facilityError) return { error: describe(facilityError) };
  }

  revalidatePath(`/submissions/${submissionId}`);
  return OK;
}

// ---------------------------------------------------------------------------

export async function resubmit(
  submissionId: number,
  _prev: FormState
): Promise<FormState> {
  const profile = await requireProfile();
  const db = createServiceClient();

  const { error } = await db.rpc("resubmit_submission", {
    p_submission_id: submissionId,
    p_actor: profile.id,
  });

  if (error) return { error: describe(error) };

  revalidatePath("/submissions");
  revalidatePath(`/submissions/${submissionId}`);
  return OK;
}

// ---------------------------------------------------------------------------

export async function reviewAction(
  submissionId: number,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const profile = await requireProfile();

  const parsed = reviewSchema.safeParse({
    decision: formData.get("decision"),
    remarks_html: formData.get("remarks_html") ?? undefined,
  });
  if (!parsed.success) return { error: "Aksi tidak dikenal" };

  const { decision } = parsed.data;

  // Sanitise before the emptiness check: markup that survives sanitising is
  // the only markup that will be stored, so it is the only markup that counts.
  const remarks = cleanRemarks(parsed.data.remarks_html);

  if (decision === "reject" && (remarks === null || isRemarksEmpty(remarks))) {
    return {
      error: "Alasan penolakan wajib diisi",
      fields: { remarks_html: "Alasan penolakan wajib diisi" },
    };
  }

  const db = createServiceClient();
  const { error } = await db.rpc("review_submission", {
    p_submission_id: submissionId,
    p_actor: profile.id,
    p_decision: decision,
    p_remarks_html: remarks,
  });

  if (error) return { error: describe(error) };

  revalidatePath("/submissions");
  revalidatePath(`/submissions/${submissionId}`);
  revalidatePath("/facilities");
  return OK;
}
