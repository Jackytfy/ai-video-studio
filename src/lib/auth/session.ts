import { getServerSession } from "next-auth";
import { authOptions } from "./config";
import { NextResponse } from "next/server";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}
