import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONDITIONS,
  CONDITION_LABEL,
  type Condition,
} from "@/lib/domain";
import { listFacilities } from "@/lib/queries";

export const metadata = { title: "Sarana — Facility Fix" };

const CONDITION_VARIANT: Record<Condition, "success" | "warning" | "destructive"> = {
  baik: "success",
  rusak_ringan: "warning",
  rusak_berat: "destructive",
};

function isCondition(value: string | undefined): value is Condition {
  return !!value && (CONDITIONS as readonly string[]).includes(value);
}

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string }>;
}) {
  const { q, category, condition } = await searchParams;

  const rows = await listFacilities({
    q: q || undefined,
    category: category || undefined,
    condition: isCondition(condition) ? condition : undefined,
  });

  // Built from the visible rows rather than a separate query — the filter can
  // only usefully offer categories that exist in the published master.
  const categories = [...new Set(rows.map((r) => r.category))].sort();

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-semibold">Data sarana fasilitas</h1>

      <Card>
        <CardContent className="pt-6">
          {/* GET form: filters end up in the URL, so a filtered view is
              shareable and survives a refresh. */}
          <form className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Cari kode / nama</span>
              <Input name="q" defaultValue={q ?? ""} placeholder="AC-GD1…" />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Kategori</span>
              <select
                name="category"
                defaultValue={category ?? ""}
                className="flex h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="">Semua</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Kondisi</span>
              <select
                name="condition"
                defaultValue={condition ?? ""}
                className="flex h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="">Semua</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" size="sm">
              Terapkan
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              nativeButton={false} render={<Link href="/facilities" />}
            >
              Reset
            </Button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Tidak ada sarana yang cocok. Sarana baru muncul di sini setelah
            pengajuannya disetujui.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Kondisi</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/facilities/${row.id}`}
                        className="hover:underline underline-offset-4"
                      >
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm">{row.category}</TableCell>
                    <TableCell className="text-sm">{row.location}</TableCell>
                    <TableCell>
                      <Badge variant={CONDITION_VARIANT[row.condition]}>
                        {CONDITION_LABEL[row.condition]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
