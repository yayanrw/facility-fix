import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Request-scoped client for Server Components, Route Handlers, and Server
 * Actions. Uses the anon key, so RLS still applies — this is the client to
 * reach for by default. Use `createServiceClient` only where a write must
 * legitimately outrank the policies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Harmless here: proxy.ts
          // already refreshed the session for this request.
        }
      },
    },
  });
}
