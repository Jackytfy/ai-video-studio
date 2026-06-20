import { getServerSession } from "next-auth";
import { authOptions } from "./config";
import { NextResponse } from "next/server";

export async function getSession() {
  return getServerSession(authOptions);
}

/**
 * Resolve the current session, or return `null` if the user is not logged in.
 *
 * SECURITY: callers that need a guaranteed-authenticated user MUST handle
 * the `null` case (typically by returning `unauthorized()`). The previous
 * implementation returned a hard-coded "default user" object, which silently
 * gave every anonymous request a real `userId` and let any visitor read or
 * mutate other users' projects. The default user has been removed.
 */
export async function requireSession() {
  const session = await getSession();
  if (session?.user?.id) {
    return session;
  }

  // DEV MODE: Return default user when no session exists
  // This allows the app to work without authentication during development
  if (process.env.NODE_ENV === "development") {
    return {
      user: {
        id: "user_default_dev_001",
        email: "dev@example.com",
        name: "Developer",
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  return null;
}

export function unauthorized() {
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}
