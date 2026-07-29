/**
 * Pure formatting for deadline emails — no DB, no env, no "server-only".
 * Kept separate from lib/notifications.ts so it can be unit-tested with
 * `npm test`, which never touches a server-only module.
 */
import { STATUS_LABEL, toDateInput, TYPE_LABEL, type Role, type Status, type SubmissionType } from "./domain.ts";

export type CronSubmission = {
  id: number;
  type: SubmissionType;
  title: string;
  status: Status;
  deadline: string;
  facility: { code: string; name: string; location: string } | null;
  submitter: { id: string; name: string; email: string } | null;
};

/** Who else is holding up this submission, besides the submitter. */
export function stalledRoles(status: Status): Role[] {
  if (status === "pending_review") return ["reviewer"];
  if (status === "pending_approval") return ["approver"];
  return []; // rejected: the ball is in the submitter's court alone
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateInput(d);
}

export function daysLabel(days: number): string {
  return days < 0 ? `terlambat ${-days} hari` : `${days} hari lagi`;
}

export function subjectFor(kind: "reminder" | "overdue", sub: CronSubmission, days: number): string {
  return kind === "reminder"
    ? `[H-${days}] ${sub.title} — deadline ${sub.deadline}`
    : `[TERLAMBAT] ${sub.title} — lewat ${-days} hari`;
}

export function bodyFor(sub: CronSubmission, recipientName: string, days: number, appUrl: string): string {
  return `Halo ${recipientName},

Pengajuan berikut mendekati batas waktu:

  ${sub.title}
  Jenis     : ${TYPE_LABEL[sub.type]}
  Fasilitas : ${sub.facility?.code ?? "-"} — ${sub.facility?.name ?? "-"} (${sub.facility?.location ?? "-"})
  Status    : ${STATUS_LABEL[sub.status]}
  Deadline  : ${sub.deadline}  (${daysLabel(days)})

Buka: ${appUrl}/submissions/${sub.id}
`;
}
