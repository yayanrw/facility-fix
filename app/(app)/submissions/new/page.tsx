import { redirect } from "next/navigation";

import { createSubmission } from "../actions";
import { SubmissionForm } from "../submission-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import { listActiveFacilityOptions } from "@/lib/queries";

export const metadata = { title: "Pengajuan baru — Facility Fix" };

export default async function NewSubmissionPage() {
  const profile = await requireProfile();
  if (profile.role !== "requester" && profile.role !== "admin") {
    redirect("/submissions");
  }

  const facilities = await listActiveFacilityOptions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengajuan baru</CardTitle>
      </CardHeader>
      <CardContent>
        <SubmissionForm
          action={createSubmission}
          facilities={facilities}
          userId={profile.id}
        />
      </CardContent>
    </Card>
  );
}
