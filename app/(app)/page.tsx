import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";

export default async function HomePage() {
  const profile = await requireProfile();
  const canSubmit = profile.role === "requester" || profile.role === "admin";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Halo, {profile.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{profile.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{ROLE_LABEL[profile.role]}</dd>
          <dt className="text-muted-foreground">Unit</dt>
          <dd>{profile.unit ?? "—"}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/submissions" />}>Lihat pengajuan</Button>
          {canSubmit && (
            <Button variant="outline" nativeButton={false} render={<Link href="/submissions/new" />}>
              Buat pengajuan
            </Button>
          )}
          <Button variant="outline" nativeButton={false} render={<Link href="/facilities" />}>
            Data sarana
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
