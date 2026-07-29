/**
 * Domain vocabulary shared by UI, Server Actions, and validation schemas.
 * Mirrors the CHECK constraints in supabase/migrations/0001_init.sql —
 * changing a value here means changing the migration too.
 */

export const ROLES = ["requester", "reviewer", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const SUBMISSION_TYPES = ["damage", "asset"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export const STATUSES = [
  "pending_review",
  "pending_approval",
  "approved",
  "rejected",
] as const;
export type Status = (typeof STATUSES)[number];

export const SEVERITIES = ["ringan", "sedang", "berat"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONDITIONS = ["baik", "rusak_ringan", "rusak_berat"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const ACTIONS = ["submit", "resubmit", "approve", "reject"] as const;
export type ActionKind = (typeof ACTIONS)[number];

export const DEFAULT_DEADLINE_DAYS = 7;

/** Days before the deadline where the UI switches to a warning tone. */
export const DEADLINE_WARNING_DAYS = 3;

export const ROLE_LABEL: Record<Role, string> = {
  requester: "Pelapor",
  reviewer: "Reviewer",
  approver: "Approver",
  admin: "Admin",
};

export const TYPE_LABEL: Record<SubmissionType, string> = {
  damage: "Laporan Kerusakan",
  asset: "Data Sarana Fasilitas",
};

export const STATUS_LABEL: Record<Status, string> = {
  pending_review: "Menunggu Review",
  pending_approval: "Menunggu Approval",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  ringan: "Ringan",
  sedang: "Sedang",
  berat: "Berat",
};

export const CONDITION_LABEL: Record<Condition, string> = {
  baik: "Baik",
  rusak_ringan: "Rusak Ringan",
  rusak_berat: "Rusak Berat",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  submit: "mengajukan",
  resubmit: "mengajukan ulang",
  approve: "menyetujui",
  reject: "menolak",
};

/**
 * Which role may act on a submission at a given status, and where the
 * submission lands next. Encodes the state machine in docs/02-workflow.md.
 *
 * Admin is an escape hatch at both stages — see the role matrix in the docs.
 */
export const STAGE_ROLE: Record<
  Extract<Status, "pending_review" | "pending_approval">,
  Role[]
> = {
  pending_review: ["reviewer", "admin"],
  pending_approval: ["approver", "admin"],
};

export function canActOn(role: Role, status: Status): boolean {
  if (status !== "pending_review" && status !== "pending_approval") return false;
  return STAGE_ROLE[status].includes(role);
}

/** Resulting status after an approve/reject decision at `status`. */
export function nextStatus(status: Status, decision: "approve" | "reject"): Status {
  if (decision === "reject") return "rejected";
  return status === "pending_review" ? "pending_approval" : "approved";
}

/** Whole days from today to `deadline`. Negative means overdue. */
export function daysUntil(deadline: string | Date, today = new Date()): number {
  const d = typeof deadline === "string" ? new Date(`${deadline}T00:00:00`) : deadline;
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** `YYYY-MM-DD` in the local timezone. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `today + DEFAULT_DEADLINE_DAYS` as an ISO date, for prefilling the form.
 *
 * Formatted from the local calendar date, not `toISOString()` — that converts
 * to UTC first, so anywhere east of Greenwich (WIB is +07:00) it hands back
 * yesterday.
 */
export function defaultDeadline(today = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() + DEFAULT_DEADLINE_DAYS);
  return toDateInput(d);
}
