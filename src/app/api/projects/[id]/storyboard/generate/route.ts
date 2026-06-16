import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateStoryboard, buildProviderConfig } from "@/lib/ai";
import { estimateAudioDuration } from "@/lib/render/subtitle";

const generateSchema = z.object({
  plan: z.enum(["A", "B"]),
  sceneCount: z.number().int().min(3).max(40).optional(),
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
    const parsed = generateSchema.parse(body);
    const { plan } = parsed;

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // Auto-calculate scene count based on text length if not provided.
    // CHARS_PER_SCENE controls how many Chinese characters map to one scene.
    // Lower = more scenes = shorter per scene (better for fast-paced content).
    // Higher = fewer scenes = longer per scene (better for documentary/narrative).
    // Default 80 chars/scene — increases from the old 70 to reduce pipeline latency
    // (fewer scenes = fewer B站 searches + downloads + renders).
    const CHARS_PER_SCENE = 80;
    const MIN_SCENES = 3;
    const MAX_SCENES = 30;
    const chineseChars = (project.sourceText.match(/[\u4e00-\u9fff]/g) || []).length;
    const autoSceneCount = Math.max(MIN_SCENES, Math.min(MAX_SCENES, Math.round(chineseChars / CHARS_PER_SCENE)));
    const sceneCount = parsed.sceneCount || autoSceneCount;
    console.log(`[Storyboard] Text has ${chineseChars} chars, divisor=${CHARS_PER_SCENE}, auto=${autoSceneCount}, using=${sceneCount}`);

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

    // Post-generation consistency validation: check visualDesc ↔ materialQuery ↔ sourceVideos
    const consistencyWarnings: string[] = [];
    for (const scene of result.scenes) {
      const visualDesc = (scene.visualDesc || "").toLowerCase();
      const materialQuery = (scene.materialQuery || "").toLowerCase();
      const sourceVideos = scene.sourceVideos || [];

      // Check 1: materialQuery shares no keywords with visualDesc
      const mqParts = materialQuery.split(/[\s,，、]+/).filter((p: string) => p.length >= 2);
      const mqOrphanParts = mqParts.filter((p: string) => !visualDesc.includes(p));
      if (mqParts.length > 0 && mqOrphanParts.length === mqParts.length) {
        consistencyWarnings.push(
          `Scene ${scene.sceneNumber}: materialQuery "${scene.materialQuery}" shares no keywords with visualDesc`
        );
      }

      // Check 2: sourceVideos empty
      if (sourceVideos.length === 0) {
        consistencyWarnings.push(`Scene ${scene.sceneNumber}: sourceVideos is empty`);
      }

      // Check 3: visualDesc too short
      if (visualDesc.length < 30) {
        consistencyWarnings.push(`Scene ${scene.sceneNumber}: visualDesc only ${visualDesc.length} chars (expected 50+)`);
      }
    }
    if (consistencyWarnings.length > 0) {
      console.warn(`[Storyboard] Consistency warnings for ${consistencyWarnings.length}/${result.scenes.length} scenes:`);
      consistencyWarnings.forEach(w => console.warn(`  ${w}`));
    }

    // Delete existing storyboard if any (allows regeneration)
    const existing = await prisma.storyboard.findFirst({ where: { projectId: id } });
    if (existing) {
      await prisma.scene.deleteMany({ where: { storyboardId: existing.id } });
      await prisma.storyboard.delete({ where: { id: existing.id } });
    }

    const storyboard = await prisma.storyboard.create({
      data: {
        projectId: id,
        title: result.title,
        totalScenes: result.scenes.length,
        totalDuration: result.estimatedDuration,
        totalWords: result.totalWords,
        status: "READY",
        scenes: {
          create: result.scenes.map((s) => {
            const meta: Record<string, unknown> = {};
            if (s.scripts && s.scripts.length > 0) meta.scripts = s.scripts;
            if (s.materialQueryEn) meta.materialQueryEn = s.materialQueryEn;
            if (s.sourceVideos && s.sourceVideos.length > 0) meta.sourceVideos = s.sourceVideos;

            return {
              sceneNumber: s.sceneNumber,
              title: s.title,
              sceneType: s.sceneType === "ANIMATION" ? "ANIMATION" : "REAL_FOOTAGE",
              voiceoverText: s.voiceoverText,
              visualDesc: s.visualDesc,
              materialQuery: s.materialQuery,
              wordCount: s.wordCount,
              estimatedDuration: estimateAudioDuration(s.voiceoverText),
              productionMeta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
            };
          }),
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
