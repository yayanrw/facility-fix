import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes reachable without a session. Everything else requires one.
 *
 * `/api` is here too: API routes authenticate themselves (the cron route
 * checks CRON_SECRET, not a cookie), so this proxy redirecting them to
 * /login would mean Vercel's own cron invocation — bearer token, no
 * session — never reaches the route handler at all.
 */
const PUBLIC_PATHS = ["/login", "/auth", "/api"];

/**
 * Next 16 calls this file `proxy.ts` — `middleware.ts` still runs but logs a
 * deprecation warning.
 *
 * Two jobs: refresh the Supabase session cookie on every request (tokens are
 * short-lived, and a Server Component cannot write cookies), and bounce
 * unauthenticated traffic to /login.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // getUser(), not getSession(): it revalidates the JWT against Supabase.
  // getSession() trusts whatever cookie the browser sent.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Come back to where they were headed once they sign in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip static assets and image files — running auth on them wastes an
  // invocation per request and cannot change the outcome.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
