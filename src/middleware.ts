import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Edge-runtime auth middleware.
 *
 * Two-tier gating:
 * - `/api/projects/*` and `/api/user/*` — require a valid JWT cookie.
 *   Anonymous API requests are short-circuited with a JSON 401 so the
 *   browser's `fetch()` can surface a proper error message instead of
 *   chasing a 307 → /login (which fails the POST with 405).
 * - `/(platform)/*` (dashboard, create, editor, settings) — require a valid
 *   JWT cookie. Anonymous requests are redirected to the login page.
 *
 * Public routes (no auth required):
 * - `/` and `/login` and `/register` — landing & auth pages.
 * - `/api/auth/*` — NextAuth's own endpoints.
 *
 * Implementation note: we use `getToken` directly (instead of next-auth's
 * `withAuth` helper) because its `authorized` callback only returns a
 * boolean — we need to return a `NextResponse` for API routes to send
 * a JSON 401 instead of the default 307 redirect.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search, origin } = req.nextUrl;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  // API routes return a JSON 401; page routes redirect to the signin page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const signInUrl = new URL("/login", origin);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    // All platform pages (dashboard, create, editor, storyboard, settings, admin)
    "/dashboard/:path*",
    "/create",
    "/create/:path*",
    "/projects",
    "/projects/:path*",
    "/settings/:path*",
    "/admin/:path*",
    // Authenticated API routes
    "/api/projects",
    "/api/projects/:path*",
    "/api/user/:path*",
    "/api/admin/:path*",
  ],
};
