import "server-only";

import { redirect } from "next/navigation";

import type { Role } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  unit: string | null;
};

/** Current user's profile, or null when signed out. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, name, email, role, unit")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}

/**
 * Profile or a redirect to /login. Use in pages and layouts, where redirecting
 * is the right response to a missing session.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Profile, asserted to hold one of `roles`.
 *
 * This guards the UI so people are not shown controls that will fail. It is
 * not the security boundary — RLS and the service-role Server Actions are.
 * Throws rather than redirects so a Server Action cannot silently no-op.
 */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    throw new Error(
      `Forbidden: ${profile.role} may not perform this action (requires ${roles.join(" or ")})`
    );
  }
  return profile;
}
