import { z } from "zod";

import { CONDITIONS, SEVERITIES, toDateInput } from "@/lib/domain";

/**
 * Validation lives here and only here. The same schema runs in the Server
 * Action that writes the row, so there is no second, client-side copy that can
 * drift out of sync — shadcn's Base UI build ships no react-hook-form wrapper,
 * and this turns that into an advantage.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");

const notPast = isoDate.refine((d) => d >= toDateInput(new Date()), {
  message: "Deadline tidak boleh di masa lalu",
});

const shortText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi`)
    .max(max, `${label} maksimal ${max} karakter`);

/** Storage paths collected from the uploader, posted as a JSON array. */
const photos = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return [] as string[];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
    } catch {
      return [] as string[];
    }
  });

const base = {
  title: shortText("Judul"),
  description: shortText("Deskripsi", 5000),
  deadline: notPast,
  photos,
};

export const damageSchema = z.object({
  ...base,
  type: z.literal("damage"),
  facility_id: z.coerce.number().int().positive("Pilih fasilitas"),
  severity: z.enum(SEVERITIES, { message: "Pilih tingkat kerusakan" }),
});

export const assetSchema = z.object({
  ...base,
  type: z.literal("asset"),
  code: shortText("Kode aset", 50),
  name: shortText("Nama"),
  category: shortText("Kategori", 80),
  location: shortText("Lokasi"),
  condition: z.enum(CONDITIONS, { message: "Pilih kondisi" }),
  quantity: z.coerce.number().int().min(1, "Jumlah minimal 1"),
  acquired_date: isoDate.optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(5000).optional(),
});

export const submissionSchema = z.discriminatedUnion("type", [
  damageSchema,
  assetSchema,
]);

export type DamageInput = z.infer<typeof damageSchema>;
export type AssetInput = z.infer<typeof assetSchema>;
export type SubmissionInput = z.infer<typeof submissionSchema>;

/** Revision keeps the deadline out — it is immutable once submitted. */
export const damageRevisionSchema = damageSchema.omit({ deadline: true });
export const assetRevisionSchema = assetSchema.omit({ deadline: true });

export const revisionSchema = z.discriminatedUnion("type", [
  damageRevisionSchema,
  assetRevisionSchema,
]);

export const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  remarks_html: z.string().optional(),
});

/** Flattens zod issues into `{ fieldName: firstMessage }` for `FieldError`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** FormData → plain object, so zod can see every field including absent ones. */
export function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
