import "server-only";

import type { Condition, Severity, Status, SubmissionType } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const PHOTO_BUCKET = "facility-photos";

/** Signed URLs are short-lived; long enough to load a page, not to share. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export type Facility = {
  id: number;
  code: string;
  name: string;
  category: string;
  location: string;
  condition: Condition;
  quantity: number;
  acquired_date: string | null;
  notes: string | null;
  photos: string[];
  is_active: boolean;
  created_by: string;
  created_at: string;
};

export type SubmissionRow = {
  id: number;
  type: SubmissionType;
  title: string;
  description: string;
  severity: Severity | null;
  deadline: string;
  status: Status;
  photos: string[];
  submitted_by: string;
  created_at: string;
  facility: Pick<Facility, "id" | "code" | "name" | "location"> | null;
  submitter: { name: string; unit: string | null } | null;
};

export type ActionRow = {
  id: number;
  action: "submit" | "resubmit" | "approve" | "reject";
  actor_role: string;
  remarks_html: string | null;
  created_at: string;
  actor: { name: string } | null;
};

const SUBMISSION_SELECT = `
  id, type, title, description, severity, deadline, status, photos,
  submitted_by, created_at,
  facility:facilities!submissions_facility_id_fkey ( id, code, name, location ),
  submitter:profiles!submissions_submitted_by_fkey ( name, unit )
`;

/**
 * Submissions the signed-in user is allowed to see.
 *
 * No role branching here on purpose: `submissions_select` already scopes a
 * requester to their own rows and lets staff see the queue. Re-implementing
 * that filter in TypeScript would create a second source of truth that can
 * disagree with the policy.
 */
export async function listSubmissions(options?: {
  status?: Status;
  type?: SubmissionType;
}): Promise<SubmissionRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    // Soonest deadline first — the queue is ordered by urgency, not recency.
    .order("deadline", { ascending: true })
    .order("id", { ascending: false });

  if (options?.status) query = query.eq("status", options.status);
  if (options?.type) query = query.eq("type", options.type);

  const { data, error } = await query;
  if (error) throw new Error(`listSubmissions: ${error.message}`);
  return (data ?? []) as unknown as SubmissionRow[];
}

export async function getSubmission(id: number): Promise<SubmissionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getSubmission: ${error.message}`);
  return (data as unknown as SubmissionRow) ?? null;
}

/** Full facility record for the revision form; RLS keeps drafts owner-only. */
export async function getFacility(id: number): Promise<Facility | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getFacility: ${error.message}`);
  return (data as Facility) ?? null;
}

export async function getActions(submissionId: number): Promise<ActionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submission_actions")
    .select(
      `id, action, actor_role, remarks_html, created_at,
       actor:profiles!submission_actions_actor_id_fkey ( name )`
    )
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(`getActions: ${error.message}`);
  return (data ?? []) as unknown as ActionRow[];
}

/** Published master data only — drafts awaiting approval are not facilities yet. */
export async function listFacilities(filters?: {
  category?: string;
  location?: string;
  condition?: Condition;
  q?: string;
}): Promise<Facility[]> {
  const supabase = await createClient();

  let query = supabase
    .from("facilities")
    .select("*")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (filters?.category) query = query.eq("category", filters.category);
  if (filters?.condition) query = query.eq("condition", filters.condition);
  if (filters?.location) query = query.ilike("location", `%${filters.location}%`);
  if (filters?.q) {
    // `or` takes a PostgREST filter string, so a comma or parenthesis in the
    // search box would otherwise be read as syntax.
    const safe = filters.q.replace(/[(),]/g, " ");
    query = query.or(`code.ilike.%${safe}%,name.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listFacilities: ${error.message}`);
  return (data ?? []) as Facility[];
}

/** Facilities a requester may file a damage report against. */
export async function listActiveFacilityOptions(): Promise<
  Pick<Facility, "id" | "code" | "name" | "location">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facilities")
    .select("id, code, name, location")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) throw new Error(`listActiveFacilityOptions: ${error.message}`);
  return data ?? [];
}

export async function listFacilityDamageHistory(
  facilityId: number
): Promise<SubmissionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .eq("facility_id", facilityId)
    .eq("type", "damage")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listFacilityDamageHistory: ${error.message}`);
  return (data ?? []) as unknown as SubmissionRow[];
}

export async function countByStatus(): Promise<Record<Status, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("submissions").select("status");
  if (error) throw new Error(`countByStatus: ${error.message}`);

  const out = {
    pending_review: 0,
    pending_approval: 0,
    approved: 0,
    rejected: 0,
  } as Record<Status, number>;

  for (const row of data ?? []) out[(row as { status: Status }).status]++;
  return out;
}

/**
 * Signed URLs for stored photos.
 *
 * Uses the service client because storage policies scope reads to the
 * uploader's own folder — a reviewer looking at someone else's report would
 * otherwise see nothing. Authorisation already happened: the caller could only
 * reach these paths through a row `submissions_select` let them read.
 */
export async function signPhotos(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];

  const db = createServiceClient();
  const { data, error } = await db.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error) throw new Error(`signPhotos: ${error.message}`);
  return (data ?? [])
    .map((entry) => entry.signedUrl)
    .filter((url): url is string => Boolean(url));
}
