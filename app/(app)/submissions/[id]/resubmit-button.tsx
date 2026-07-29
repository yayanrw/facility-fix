"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import type { FormState } from "../actions";
import { Button } from "@/components/ui/button";

function Pending() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Mengirim…" : "Ajukan ulang"}
    </Button>
  );
}

export function ResubmitButton({
  action,
}: {
  action: (state: FormState) => Promise<FormState>;
}) {
  const [, formAction] = useActionState<FormState>(async (prev) => {
    const result = await action(prev);
    if (result.error) toast.error(result.error);
    else toast.success("Pengajuan dikirim ulang ke reviewer");
    return result;
  }, { error: null });

  return (
    <form action={formAction}>
      <Pending />
    </form>
  );
}
