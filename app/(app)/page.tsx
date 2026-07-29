import Link from "next/link";

import { DeadlineBadge } from "@/components/deadline-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import { ROLE_LABEL, STATUSES, STATUS_LABEL, type Status } from "@/lib/domain";
import { countByStatus, listSubmissions } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard — Facility Fix" };

/** Card tone per status — mirrors StatusBadge's variant mapping. */
const CARD_TONE: Record<Status, string> = {
  pending_review: "",
  pending_approval: "",
  approved: "border-success/40 bg-success/5",
  rejected: "border-destructive/40 bg-destructive/5",
};

export default async function HomePage() {
  const profile = await requireProfile();
  const canSubmit = profile.role === "requester" || profile.role === "admin";

  // Both come back through RLS: a requester sees their own counts and
  // deadlines, staff see the whole queue — no role branching needed here.
  const [counts, rows] = await Promise.all([countByStatus(), listSubmissions()]);

  const upcoming = rows.filter((r) => r.status !== "approved").slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-heading text-xl font-semibold">Halo, {profile.name}</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABEL[profile.role]}
            {profile.unit ? ` · ${profile.unit}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canSubmit && (
            <Button nativeButton={false} render={<Link href="/submissions/new" />}>
              Buat pengajuan
            </Button>
          )}
          <Button variant="outline" nativeButton={false} render={<Link href="/facilities" />}>
            Data sarana
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUSES.map((s) => (
          <Link key={s} href={`/submissions?status=${s}`}>
            <Card className={cn("transition-colors hover:bg-muted/50", CARD_TONE[s])}>
              <CardContent className="py-4">
                <div className="text-2xl font-semibold tabular-nums">{counts[s]}</div>
                <div className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CardTitle className="text-base">Mendekati deadline</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            nativeButton={false}
            render={<Link href="/submissions" />}
          >
            Lihat semua
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 px-2 pb-2">
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Tidak ada pengajuan yang mendekati deadline.
            </p>
          ) : (
            upcoming.map((row) => (
              <Link
                key={row.id}
                href={`/submissions/${row.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{row.title}</span>
                {row.facility && (
                  <span className="text-xs text-muted-foreground">
                    {row.facility.code} · {row.facility.location}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <StatusBadge status={row.status} />
                  <DeadlineBadge deadline={row.deadline} status={row.status} />
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
