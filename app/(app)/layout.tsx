import Link from "next/link";

import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireProfile } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 p-4">
          <Link href="/" className="font-heading text-base font-semibold">
            Facility Fix
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/submissions" className="hover:underline underline-offset-4">
              Pengajuan
            </Link>
            <Link href="/facilities" className="hover:underline underline-offset-4">
              Sarana
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {profile.name} · {ROLE_LABEL[profile.role]}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Keluar
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
