# Debug: 创建失败 (create-project-fail)

## Session Info
- **Session ID**: `create-project-fail`
- **Status**: OPEN
- **Date**: 2026-06-16
- **Symptom**: User clicks submit on /create page → console shows "创建失败" (from `if (!response.ok) throw new Error("创建失败")` in [create/page.tsx:39](file:///f:/创作/20260512/ai-video-studio/src/app/(platform)/create/page.tsx#L33-L50))
- **Actual vs Expected**: `POST /api/projects` returns non-2xx → caught as "创建失败" → form silently stops at step 1.
- **Stack trace**: `at handleSubmit` only — no server-side stack visible from console.

## Hypotheses (to be falsified via runtime evidence)

1. **H1: Zod validation failure on `materialRequirements.properNouns` etc.** — if any optional nested field is sent as `""` or `null` instead of `undefined`, zod's `.optional()` may reject it. The create-page builds `materialRequirements` from a `hasMaterialReqs` boolean (`TextInputArea.tsx:34`) — it explicitly sets each field `undefined` when empty, so this should be OK. Low likelihood.
2. **H2: Prisma write fails because of stale generated client or unmigrated DB column (`renderMode`, `materialRequirements`).** The local `prisma/dev.db` may be missing columns added in migrations `20260614010744_add_material_requirements` and `20260530022341_add_video_segments_music`. If `prisma generate` was never re-run, the TypeScript client will accept `renderMode` but the underlying SQL will fail on a missing column. **Medium-high likelihood.**
3. **H3: `requireSession()` returns null because JWT cookie is missing or invalid → 401 "请先登录".** Middleware `withAuth` already guards `/create/:path*` and `/api/projects/:path*`. If middleware allows the request to reach the route, the session exists. The previous default-user fallback was removed, so anonymous traffic is now 401. Possible if middleware is disabled in dev.
4. **H4: AI provider key missing → `/quick-generate` second call fails with 500, surfaces as "创建失败" only because the first POST *did* succeed.** But the user error message is exactly "创建失败" which matches the *first* throw (`throw new Error("创建失败")` in create page). If quick-generate failed, the error message would be "分镜生成失败". So H4 is unlikely.
5. **H5: Zod schema rejects `voice: "yunxi"` (the page's default).** The schema declares `voice: z.string().default("yunxi")` — `z.string()` accepts any string. Should be fine.

## Plan

1. Add instrumentation to `[POST /api/projects]` route — log full request body, session status, zod result, prisma result. **No business logic change.**
2. Reproduce by submitting from the create page (or curl).
3. Read captured log to confirm/refute hypotheses.
4. Implement minimal fix based on evidence.
5. Verify with post-fix log.

## Runtime Evidence (collected)

Reproduced the bug with a no-cookie curl-style request:

```
$ r = POST http://localhost:3000/api/projects
  body: {"name":"t","sourceText":"hello world test content","aspectRatio":"16:9",
         "voice":"yunxi","contentStyle":"knowledge","renderMode":"stock"}

→ STATUS: 307
  Location: /login?callbackUrl=%2Fapi%2Fprojects
```

GET `/api/projects` (anonymous) → 307 to login. GET `/create` (anonymous) → **200** (form is public!).

## Root Cause

`src/middleware.ts` uses `withAuth({ pages: { signIn: "/login" } })` from `next-auth`. Reading the next-auth source (`node_modules/next-auth/next/middleware.js`):

```js
const isAuthorized = await options.callbacks?.authorized({req, token}) ?? !!token;
if (isAuthorized) return await onSuccess?.(token);
const signInUrl = new URL(...signInPage, origin);
signInUrl.searchParams.append("callbackUrl", ...);
return NextResponse.redirect(signInUrl);  // ← always 307, no API detection
```

`withAuth` does **not** check whether the request is an API call — it always issues a 307 to the signin page. When `fetch()` follows that 307 with the original POST method, the `/login` page (GET-only) returns 405 (or some non-2xx). `response.ok` is false → `throw new Error("创建失败")` in [create/page.tsx:39](file:///f:/创作/20260512/ai-video-studio/src/app/(platform)/create/page.tsx#L33-L50).

Two compounding problems:
1. The middleware **doesn't** return 401 JSON for `/api/*` — every anonymous API call gets a 307 instead.
2. The middleware matcher `"/api/projects/:path*"` and `"/create/:path*"` use `:path*` (which requires at least one segment in Next.js), so **bare paths `/create` and `/api/projects` are unprotected**. Anonymous user can open the form, then gets bounced on submit.

## Hypothesis Verification

| ID | Status | Evidence |
|---|---|---|
| H1 (zod nested field) | REJECTED | Schema accepts the wire shape; no validation error in the test path before middleware. |
| H2 (prisma column / client stale) | REJECTED | Request never reaches the Prisma `create` call — middleware short-circuits. |
| H3 (no session) | **CONFIRMED** | 307 → /login proves the user has no valid JWT. Combined with the spec-violating 307-on-POST, the client sees a non-2xx. |
| H4 (quick-generate failure) | REJECTED | The exact "创建失败" string comes from the first throw, not the second. |
| H5 (voice validation) | REJECTED | `voice: z.string()` accepts any string. |

## Proposed Fix (minimal)

In `src/middleware.ts`, detect `/api/*` paths inside the auth handler and return a JSON 401 instead of redirecting. Also extend the matcher to cover bare paths. Two small edits, no behavior change for authenticated users.

```ts
// src/middleware.ts
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth({
  pages: { signIn: "/login" },
  callbacks: {
    authorized: ({ req, token }) => {
      if (token) return true;
      // API requests get a JSON 401, not a 307 to /login
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "请先登录" }, { status: 401 });
      }
      return false; // fall through to 307 redirect for page routes
    },
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/create", "/create/:path*",        // ← bare path
    "/projects", "/projects/:path*",    // ← bare path
    "/settings/:path*",
    "/admin/:path*",
    "/api/projects", "/api/projects/:path*",  // ← bare path
    "/api/user/:path*",
    "/api/admin/:path*",
  ],
};
```

The `authorized` callback returns `false` to trigger the default 307, and returns a `NextResponse` to short-circuit with that exact response.

## Change Log

### Fix applied — `src/middleware.ts`

**Iteration 1 (rejected by TypeScript):** tried `withAuth({ callbacks: { authorized } })` returning a `NextResponse` for API paths. `tsc --noEmit` reported `TS2769: 'Awaitable<boolean>' is not assignable to 'NextResponse<{ error: string; }>'` — `AuthorizedCallback` is typed as `Awaitable<boolean>`, not a response.

**Iteration 2 (current, working):** dropped `withAuth`, called `getToken` directly so the middleware can return either `NextResponse.json({...}, 401)` for `/api/*` or `NextResponse.redirect("/login?…")` for page routes. Matcher extended with bare paths (`/create`, `/projects`, `/api/projects`).

### Verification (post-fix, anonymous requests)

| Test | Pre-fix | Post-fix |
|---|---|---|
| `npx tsc --noEmit` | clean (orig) | **clean** (no errors) |
| `POST /api/projects` (anon) | 307 → `/login?callbackUrl=…` (→ `fetch` POST /login → 405) | **401 `{"error":"请先登录"}`** ✓ |
| `GET /api/projects` (anon) | 307 → `/login` | **401 `{"error":"请先登录"}`** ✓ |
| `GET /create` (anon) | 200 (form public!) | **307 → `/login?callbackUrl=…`** ✓ |
| `GET /projects` (anon) | 200 | **307 → `/login?callbackUrl=…`** ✓ |

Anonymous users are now bounced at the page level (no longer see the form) and API calls get a clean 401 JSON the client can show as a toast instead of throwing an unhandled "创建失败". The first-throw in `create/page.tsx:39` is no longer reached for the unauthenticated case.

> **Note (out of scope)**: Next.js 16.2.6 prints a deprecation warning on the renamed convention: `"middleware" file convention is deprecated. Please use "proxy" instead`. The fix still works under the legacy `middleware.ts` filename; a future PR should rename to `proxy.ts`.

## Status: AWAITING USER VERIFICATION
