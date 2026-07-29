import Link from "next/link";
import { notFound } from "next/navigation";

import { DeadlineBadge } from "@/components/deadline-badge";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONDITION_LABEL, SEVERITY_LABEL } from "@/lib/domain";
import { getFacility, listFacilityDamageHistory, signPhotos } from "@/lib/queries";

export default async function FacilityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const facilityId = Number(id);
  if (!Number.isInteger(facilityId)) notFound();

  const facility = await getFacility(facilityId);
  if (!facility) notFound();

  const [history, photoUrls] = await Promise.all([
    listFacilityDamageHistory(facilityId),
    signPhotos(facility.photos),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">{facility.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{facility.code}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!facility.is_active && <Badge variant="secondary">Belum disetujui</Badge>}
          <Badge
            variant={
              facility.condition === "baik"
                ? "success"
                : facility.condition === "rusak_ringan"
                  ? "warning"
                  : "destructive"
            }
          >
            {CONDITION_LABEL[facility.condition]}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Kategori</dt>
            <dd>{facility.category}</dd>
            <dt className="text-muted-foreground">Lokasi</dt>
            <dd>{facility.location}</dd>
            <dt className="text-muted-foreground">Jumlah</dt>
            <dd className="tabular-nums">{facility.quantity}</dd>
            <dt className="text-muted-foreground">Tanggal perolehan</dt>
            <dd className="tabular-nums">{facility.acquired_date ?? "—"}</dd>
            <dt className="text-muted-foreground">Catatan</dt>
            <dd className="whitespace-pre-wrap">{facility.notes ?? "—"}</dd>
          </dl>

          {photoUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photoUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={`Foto ${facility.name}`}
                  className="h-28 w-28 rounded-lg border border-border object-cover"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat kerusakan</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada laporan kerusakan untuk sarana ini.
            </p>
          ) : (
            <ul className="space-y-3">
              {history.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/submissions/${row.id}`}
                    className="font-medium hover:underline underline-offset-4"
                  >
                    {row.title}
                  </Link>
                  {row.severity && (
                    <span className="text-xs text-muted-foreground">
                      {SEVERITY_LABEL[row.severity]}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge status={row.status} />
                    <DeadlineBadge deadline={row.deadline} status={row.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
