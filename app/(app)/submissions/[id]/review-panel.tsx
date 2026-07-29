"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import type { FormState } from "../actions";
import { RemarksEditor } from "@/components/remarks-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { isRemarksEmpty } from "@/lib/html";

function PendingButton({
  children,
  variant,
  disabled,
}: {
  children: React.ReactNode;
  variant?: "default" | "destructive";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled}>
      {pending ? "Memproses…" : children}
    </Button>
  );
}

/**
 * Approve/reject controls for the current stage.
 *
 * Rendering this at all is a UI convenience; the real gate is
 * `review_submission`, which re-reads the status under a row lock and rejects
 * a decision the caller's role is not entitled to make.
 */
export function ReviewPanel({
  action,
  stageLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  stageLabel: string;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const remarksBlank = isRemarksEmpty(remarks);

  const [state, formAction] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          formData.get("decision") === "approve"
            ? "Pengajuan disetujui"
            : "Pengajuan ditolak"
        );
        setRejectOpen(false);
      }
      return result;
    },
    { error: null }
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Keputusan {stageLabel}:</span>

      <form action={formAction}>
        <input type="hidden" name="decision" value="approve" />
        <PendingButton>Setujui</PendingButton>
      </form>

      <Button variant="destructive" onClick={() => setRejectOpen(true)}>
        Tolak
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-lg">
          <form action={formAction}>
            <input type="hidden" name="decision" value="reject" />
            <DialogHeader>
              <DialogTitle>Tolak pengajuan</DialogTitle>
              <DialogDescription>
                Alasan penolakan wajib diisi — pengaju memakai catatan ini untuk
                merevisi.
              </DialogDescription>
            </DialogHeader>

            <Field className="my-4" data-invalid={state.fields?.remarks_html ? true : undefined}>
              <FieldLabel>Alasan</FieldLabel>
              <RemarksEditor
                name="remarks_html"
                placeholder="Contoh: foto kurang jelas, kode aset belum sesuai format."
                onValueChange={setRemarks}
              />
              {state.fields?.remarks_html && (
                <FieldError>{state.fields.remarks_html}</FieldError>
              )}
            </Field>

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Batal
                  </Button>
                }
              />
              <PendingButton variant="destructive" disabled={remarksBlank}>
                Tolak pengajuan
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
