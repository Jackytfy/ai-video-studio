import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const updateSettingsSchema = z.object({
  name: z.string().optional(),
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
  aiBaseUrl: z.string().url().nullable().optional().or(z.literal("")),
  aiApiKey: z.string().nullable().optional(),
  ttsProvider: z.string().optional(),
  ttsVoice: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        aiProvider: true,
        aiModel: true,
        aiBaseUrl: true,
        aiApiKey: true,
        ttsProvider: true,
        ttsVoice: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "获取设置失败" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const body = await req.json();
    const data = updateSettingsSchema.parse(body);

    const normalized = {
      ...data,
      aiBaseUrl: data.aiBaseUrl || null,
      aiApiKey: data.aiApiKey || null,
    };

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: normalized,
      select: {
        id: true,
        name: true,
        email: true,
        aiProvider: true,
        aiModel: true,
        aiBaseUrl: true,
        aiApiKey: true,
        ttsProvider: true,
        ttsVoice: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "更新设置失败" }, { status: 500 });
  }
}
