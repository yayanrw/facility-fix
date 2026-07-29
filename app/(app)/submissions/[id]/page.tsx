import Link from "next/link";
import { notFound } from "next/navigation";

import { resubmit, reviewAction, updateSubmission } from "../actions";
import { SubmissionForm } from "../submission-form";
import { ResubmitButton } from "./resubmit-button";
import { ReviewPanel } from "./review-panel";
import { DeadlineBadge } from "@/components/deadline-badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireProfile } from "@/lib/auth";
import {
  ACTION_LABEL,
  CONDITION_LABEL,
  ROLE_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  canActOn,
  type Role,
} from "@/lib/domain";
import {
  getActions,
  getFacility,
  getSubmission,
  listActiveFacilityOptions,
  signPhotos,
} from "@/lib/queries";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId)) notFound();

  const profile = await requireProfile();
  const submission = await getSubmission(submissionId);

  // RLS already filtered this row out if the viewer may not see it, so a
  // missing row and a forbidden row look identical from here — which is the
  // behaviour we want: no "this exists but is not yours" oracle.
  if (!submission) notFound();

  const [actions, photoUrls] = await Promise.all([
    getActions(submissionId),
    signPhotos(submission.photos),
  ]);

  const isOwner = submission.submitted_by === profile.id;
  const canDecide = canActOn(profile.role as Role, submission.status);
  const canRevise = isOwner && submission.status === "rejected";

  // Asset submissions carry their full facility draft; the embedded copy in
  // `submission.facility` is only the summary columns.
  const facility =
    submission.type === "asset" && submission.facility
      ? await getFacility(submission.facility.id)
      : null;
  const facilityOptions = canRevise ? await listActiveFacilityOptions() : [];

  const stageLabel =
    submission.status === "pending_review" ? "reviewer" : "approver";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">{submission.title}</h1>
          <p className="text-sm text-muted-foreground">
            {TYPE_LABEL[submission.type]} · diajukan oleh{" "}
            {submission.submitter?.name ?? "—"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge status={submission.status} />
          <DeadlineBadge deadline={submission.deadline} status={submission.status} />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Fasilitas</dt>
            <dd>
              {submission.facility ? (
                submission.facility.id && submission.type === "damage" ? (
                  <Link
                    href={`/facilities/${submission.facility.id}`}
                    className="hover:underline underline-offset-4"
                  >
                    {submission.facility.code} — {submission.facility.name}
                  </Link>
                ) : (
                  `${submission.facility.code} — ${submission.facility.name}`
                )
              ) : (
                "—"
              )}
              {submission.facility && (
                <span className="text-muted-foreground">
                  {" "}
                  ({submission.facility.location})
                </span>
              )}
            </dd>

            {submission.severity && (
              <>
                <dt className="text-muted-foreground">Tingkat kerusakan</dt>
                <dd>{SEVERITY_LABEL[submission.severity]}</dd>
              </>
            )}

            <dt className="text-muted-foreground">Deadline</dt>
            <dd className="tabular-nums">{submission.deadline}</dd>

            <dt className="text-muted-foreground">Deskripsi</dt>
            <dd className="whitespace-pre-wrap">{submission.description}</dd>
          </dl>

          {photoUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photoUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt="Foto pengajuan"
                  className="h-28 w-28 rounded-lg border border-border object-cover"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canDecide && (
        <Card>
          <CardContent className="pt-6">
            <ReviewPanel
              action={reviewAction.bind(null, submissionId)}
              stageLabel={stageLabel}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {actions.map((entry, index) => (
              <li key={entry.id} className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{entry.actor?.name ?? "—"}</span>
                  <span className="text-muted-foreground">
                    ({ROLE_LABEL[entry.actor_role as Role] ?? entry.actor_role})
                  </span>
                  <span>{ACTION_LABEL[entry.action]}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {new Date(entry.created_at).toLocaleString("id-ID")}
                  </span>
                </div>
                {entry.remarks_html && (
                  <div
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                    // Stored HTML is sanitised on write in lib/sanitize.ts; the
                    // allow-list has no <script>, <img>, or event attributes.
                    dangerouslySetInnerHTML={{ __html: entry.remarks_html }}
                  />
                )}
                {index < actions.length - 1 && <Separator className="mt-3" />}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {canRevise && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisi pengajuan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Status saat ini {STATUS_LABEL[submission.status]}. Perbaiki isian lalu
              simpan, kemudian ajukan ulang. Deadline tidak berubah.
            </p>
            <SubmissionForm
              action={updateSubmission.bind(null, submissionId)}
              facilities={facilityOptions}
              userId={profile.id}
              mode="revise"
              submitLabel="Simpan revisi"
              defaults={{
                type: submission.type,
                title: submission.title,
                description: submission.description,
                photos: submission.photos,
                facility_id: submission.facility?.id,
                severity: submission.severity,
                code: facility?.code,
                name: facility?.name,
                category: facility?.category,
                location: facility?.location,
                condition: facility?.condition,
                quantity: facility?.quantity,
                acquired_date: facility?.acquired_date,
                notes: facility?.notes,
              }}
            />
            <Separator />
            <div className="flex items-center gap-3">
              <ResubmitButton action={resubmit.bind(null, submissionId)} />
              <span className="text-sm text-muted-foreground">
                Kembali ke antrean reviewer.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {submission.type === "asset" && submission.status === "approved" && (
        <p className="text-sm text-muted-foreground">
          Sarana ini sudah masuk master data —{" "}
          <Link
            href={`/facilities/${submission.facility?.id}`}
            className="hover:underline underline-offset-4"
          >
            lihat di daftar sarana
          </Link>
          . Kondisi terakhir: {facility ? CONDITION_LABEL[facility.condition] : "—"}
        </p>
      )}
    </div>
  );
}
