import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env.ts";

/**
 * Service-role client. **Bypasses every RLS policy.**
 *
 * Reserved for the writes the policies deliberately forbid to clients:
 * status transitions, audit-trail inserts, publishing a facility, and the
 * deadline cron. Never expose it to a route that echoes arbitrary
 * caller-supplied filters back to the user.
 *
 * The `server-only` import above makes importing this from a Client Component
 * a build error rather than a leaked key.
 */
export function createServiceClient() {
  return createSupabaseClient(SUPABASE_URL(), SUPABASE_SERVICE_ROLE_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
