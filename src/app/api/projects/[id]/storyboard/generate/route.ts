import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateStoryboard, buildProviderConfig } from "@/lib/ai";

const generateSchema = z.object({
  plan: z.enum(["A", "B"]),
  sceneCount: z.number().int().min(3).max(20),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const { plan, sceneCount } = generateSchema.parse(body);

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    await prisma.project.update({
      where: { id },
      data: { status: "STORYBOARD_GENERATING" },
    });

    const result = await generateStoryboard(
      project.sourceText,
      plan,
      sceneCount,
      buildProviderConfig(session.user)
    );

    const storyboard = await prisma.storyboard.create({
      data: {
        projectId: id,
        title: result.title,
        totalScenes: result.scenes.length,
        totalDuration: result.estimatedDuration,
        totalWords: result.totalWords,
        status: "READY",
        scenes: {
          create: result.scenes.map((s) => ({
            sceneNumber: s.sceneNumber,
            title: s.title,
            sceneType: s.sceneType === "ANIMATION" ? "ANIMATION" : "REAL_FOOTAGE",
            voiceoverText: s.voiceoverText,
            visualDesc: s.visualDesc,
            materialQuery: s.materialQuery,
            wordCount: s.wordCount,
            estimatedDuration: s.wordCount / 4,
          })),
        },
      },
      include: { scenes: true },
    });

    await prisma.project.update({
      where: { id },
      data: {
        status: "STORYBOARD_READY",
        productionPlan: plan,
      },
    });

    await prisma.chatMessage.create({
      data: {
        projectId: id,
        role: "ASSISTANT",
        content: `分镜脚本已生成！共 ${storyboard.totalScenes} 个场景，预估时长 ${Math.round(storyboard.totalDuration || 0)} 秒。`,
        messageType: "STORYBOARD_CARD",
        metadata: JSON.stringify({
          storyboardId: storyboard.id,
          totalScenes: storyboard.totalScenes,
          totalDuration: storyboard.totalDuration,
        }),
      },
    });

    return NextResponse.json({ storyboard });
  } catch (error) {
    const { id } = await params;
    await prisma.project.update({
      where: { id },
      data: { status: "FAILED" },
    }).catch(() => {});

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("Storyboard generation error:", error);
    return NextResponse.json(
      { error: "分镜生成失败，请稍后重试" },
      { status: 500 }
    );
  }
}
