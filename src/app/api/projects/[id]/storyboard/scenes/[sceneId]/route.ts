import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const updateSceneSchema = z.object({
  title: z.string().nullable().optional(),
  voiceoverText: z.string().optional(),
  visualDesc: z.string().optional(),
  materialQuery: z.string().optional(),
  sceneType: z.enum(["REAL_FOOTAGE", "ANIMATION", "AI_GENERATED", "CUSTOM"]).optional(),
  wordCount: z.number().nullable().optional(),
  estimatedDuration: z.number().nullable().optional(),
  transition: z.enum(["CUT", "CROSS_DISSOLVE", "FADE_BLACK", "WIPE"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id, sceneId } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const body = await req.json();
    const data = updateSceneSchema.parse(body);

    const scene = await prisma.scene.findFirst({
      where: { id: sceneId, storyboard: { projectId: id } },
    });

    if (!scene) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    const updated = await prisma.scene.update({
      where: { id: sceneId },
      data,
    });

    await prisma.storyboard.update({
      where: { projectId: id },
      data: { status: "EDITED" },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    return NextResponse.json({ error: "更新场景失败" }, { status: 500 });
  }
}
