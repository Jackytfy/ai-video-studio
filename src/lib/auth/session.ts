import { getServerSession } from "next-auth";
import { authOptions } from "./config";
import { NextResponse } from "next/server";

// Default user for unauthenticated access
const DEFAULT_USER = {
  id: "cmp3v2aqa0000k8ulak8r79d5",
  email: "user@ai-video.local",
  name: "默认用户",
  aiProvider: "openai" as string,
  aiModel: "mimo-v2.5-pro" as string,
  aiBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1" as string,
  aiApiKey: "" as string,
  ttsVoice: "zh-CN-YunxiNeural" as string,
};

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (session?.user?.id) {
    return session;
  }
  // Return default user when not logged in
  return { user: DEFAULT_USER } as any;
}

export function unauthorized() {
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}
