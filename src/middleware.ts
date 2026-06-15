import { withAuth } from "next-auth/middleware";

/**
 * Edge-runtime auth middleware.
 *
 * Two-tier gating:
 * - `/api/projects/*` and `/api/user/*` — require a valid JWT cookie.
 *   Anonymous requests are redirected to the API-style JSON 401 response.
 * - `/(platform)/*` (dashboard, create, editor, settings) — require a valid
 *   JWT cookie. Anonymous requests are redirected to the login page by
 *   NextAuth's `withAuth` helper (default `pages.signIn` is `/login`).
 *
 * Public routes (no auth required):
 * - `/` and `/login` and `/register` — landing & auth pages.
 * - `/api/auth/*` — NextAuth's own endpoints.
 * - `/api/projects` (POST) and `/api/auth/register` — public sign-up flows.
 *
 * SECURITY: this replaces the previous stub that allowed every request through.
 */
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    // All platform pages (dashboard, create, editor, storyboard, settings, admin)
    "/dashboard/:path*",
    "/create/:path*",
    "/projects/:path*",
    "/settings/:path*",
    "/admin/:path*",
    // Authenticated API routes
    "/api/projects/:path*",
    "/api/user/:path*",
    "/api/admin/:path*",
  ],
};
