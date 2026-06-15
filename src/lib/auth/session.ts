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
  return null;
}

export function unauthorized() {
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}
