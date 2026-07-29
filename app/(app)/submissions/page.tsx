import Link from "next/link";

import { DeadlineBadge } from "@/components/deadline-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireProfile } from "@/lib/auth";
import { STATUSES, STATUS_LABEL, TYPE_LABEL, type Status } from "@/lib/domain";
import { countByStatus, listSubmissions } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pengajuan — Facility Fix" };

function isStatus(value: string | undefined): value is Status {
  return !!value && (STATUSES as readonly string[]).includes(value);
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await requireProfile();
  const { status } = await searchParams;
  const active = isStatus(status) ? status : undefined;

  // Both come back through RLS, so a requester's counts describe their own
  // submissions and a reviewer's describe the whole queue — no branching here.
  const [rows, counts] = await Promise.all([
    listSubmissions({ status: active }),
    countByStatus(),
  ]);

  const canSubmit = profile.role === "requester" || profile.role === "admin";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-xl font-semibold">Pengajuan</h1>
        {canSubmit && (
          <Button
            size="sm"
            className="ml-auto"
            nativeButton={false} render={<Link href="/submissions/new" />}
          >
            Pengajuan baru
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip href="/submissions" label="Semua" count={total} active={!active} />
        {STATUSES.map((s) => (
          <FilterChip
            key={s}
            href={`/submissions?status=${s}`}
            label={STATUS_LABEL[s]}
            count={counts[s]}
            active={active === s}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {active
              ? `Tidak ada pengajuan berstatus ${STATUS_LABEL[active]}.`
              : "Belum ada pengajuan."}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Judul</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Pengaju</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/submissions/${row.id}`}
                        className="font-medium hover:underline underline-offset-4"
                      >
                        {row.title}
                      </Link>
                      {row.facility && (
                        <div className="text-xs text-muted-foreground">
                          {row.facility.code} · {row.facility.location}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{TYPE_LABEL[row.type]}</TableCell>
                    <TableCell className="text-sm">
                      {row.submitter?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-sm tabular-nums">{row.deadline}</span>
                        <DeadlineBadge deadline={row.deadline} status={row.status} />
                      </div>
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

function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-4xl border px-3 py-1 text-xs transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
      )}
    >
      {label} <span className="tabular-nums">({count})</span>
    </Link>
  );
}
