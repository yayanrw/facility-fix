import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { daysUntil, toDateInput } from "./domain.ts";
import {
  addDays,
  bodyFor,
  stalledRoles,
  subjectFor,
  type CronSubmission,
} from "./notification-content.ts";
import { createServiceClient } from "./supabase/service.ts";

export type EmailSender = (to: string, subject: string, text: string) => Promise<void>;

const CRON_SELECT = `
  id, type, title, status, deadline,
  facility:facilities!submissions_facility_id_fkey ( code, name, location ),
  submitter:profiles!submissions_submitted_by_fkey ( id, name, email )
`;

async function recipientsFor(
  db: SupabaseClient,
  sub: CronSubmission
): Promise<{ name: string; email: string }[]> {
  const out: { name: string; email: string }[] = [];
  if (sub.submitter) out.push({ name: sub.submitter.name, email: sub.submitter.email });

  const roles = stalledRoles(sub.status);
  if (roles.length === 0) return out;

  const { data, error } = await db.from("profiles").select("name, email").in("role", roles);
  if (error) throw new Error(`recipientsFor: ${error.message}`);
  out.push(...((data ?? []) as { name: string; email: string }[]));
  return out;
}

async function notify(
  db: SupabaseClient,
  send: EmailSender,
  kind: "reminder" | "overdue",
  sub: CronSubmission,
  appUrl: string,
  today: Date
): Promise<void> {
  const days = daysUntil(sub.deadline, today);
  const recipients = await recipientsFor(db, sub);
  await Promise.all(
    recipients.map((r) => send(r.email, subjectFor(kind, sub, days), bodyFor(sub, r.name, days, appUrl)))
  );

  const column = kind === "reminder" ? "reminder_sent_at" : "overdue_sent_at";
  const { error } = await db
    .from("submissions")
    .update({ [column]: new Date().toISOString() })
    .eq("id", sub.id);
  if (error) throw new Error(`stamp ${column} for submission ${sub.id}: ${error.message}`);
}

/**
 * Runs the daily deadline sweep: H-3 reminders and overdue notices, each sent
 * at most once per submission (docs/04-notifications.md).
 *
 * A submission that fails mid-send (recipient query, provider error) is
 * skipped without stamping, so tomorrow's run retries it. One bad submission
 * does not abort the rest of the batch.
 */
export async function runDeadlineCron(
  send: EmailSender,
  appUrl: string,
  today = new Date()
): Promise<{ reminders: number; overdue: number }> {
  const db = createServiceClient();
  const todayStr = toDateInput(today);

  const [dueSoon, overdue] = await Promise.all([
    db
      .from("submissions")
      .select(CRON_SELECT)
      .neq("status", "approved")
      .is("reminder_sent_at", null)
      .gte("deadline", todayStr)
      .lte("deadline", addDays(todayStr, 3)),
    db
      .from("submissions")
      .select(CRON_SELECT)
      .neq("status", "approved")
      .is("overdue_sent_at", null)
      .lt("deadline", todayStr),
  ]);
  if (dueSoon.error) throw new Error(`runDeadlineCron reminders query: ${dueSoon.error.message}`);
  if (overdue.error) throw new Error(`runDeadlineCron overdue query: ${overdue.error.message}`);

  let reminders = 0;
  for (const sub of (dueSoon.data ?? []) as unknown as CronSubmission[]) {
    try {
      await notify(db, send, "reminder", sub, appUrl, today);
      reminders++;
    } catch (err) {
      console.error(`reminder failed for submission ${sub.id}:`, err);
    }
  }

  let overdueCount = 0;
  for (const sub of (overdue.data ?? []) as unknown as CronSubmission[]) {
    try {
      await notify(db, send, "overdue", sub, appUrl, today);
      overdueCount++;
    } catch (err) {
      console.error(`overdue notice failed for submission ${sub.id}:`, err);
    }
  }

  return { reminders, overdue: overdueCount };
}
