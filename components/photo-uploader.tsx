"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "facility-photos";
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

type Uploaded = { path: string; previewUrl: string };

/**
 * Uploads straight to Supabase Storage from the browser, then posts the
 * resulting object paths along with the form.
 *
 * Objects are keyed `{userId}/{uuid}.{ext}` — by uploader, not by submission,
 * because the submission row does not exist yet while this form is being
 * filled in. That is also the only shape the storage policy can enforce.
 */
export function PhotoUploader({
  name,
  userId,
  defaultPaths = [],
  className,
}: {
  name: string;
  userId: string;
  defaultPaths?: string[];
  className?: string;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Uploaded[]>(
    defaultPaths.map((path) => ({ path, previewUrl: "" }))
  );
  const [pending, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    const accepted: Uploaded[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} lebih dari 10 MB`);
        continue;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file);

      if (error) {
        toast.error(`Gagal mengunggah ${file.name}: ${error.message}`);
        continue;
      }
      accepted.push({ path, previewUrl: URL.createObjectURL(file) });
    }

    if (accepted.length) {
      setItems((prev) => [...prev, ...accepted]);
      toast.success(`${accepted.length} foto terunggah`);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(path: string) {
    // Best-effort delete. If it fails the object is simply orphaned in the
    // bucket — annoying, not incorrect, and never worth blocking the form.
    await supabase.storage.from(BUCKET).remove([path]);
    setItems((prev) => prev.filter((item) => item.path !== path));
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input type="hidden" name={name} value={JSON.stringify(items.map((i) => i.path))} />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          startTransition(() => {
            void handleFiles(files);
          });
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? "Mengunggah…" : "Tambah foto"}
      </Button>

      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.path}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span className="max-w-40 truncate text-muted-foreground">
                {item.path.split("/").pop()}
              </span>
              <button
                type="button"
                onClick={() => void remove(item.path)}
                className="text-destructive hover:underline"
                aria-label="Hapus foto"
              >
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
