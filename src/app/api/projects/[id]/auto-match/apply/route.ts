import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

interface MatchResult {
  sceneId: string;
  sceneNumber: number;
  sceneTitle: string;
  voiceoverText: string;
  suggestedMaterial: string;
  suggestedMood: string;
  keywords: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId } = await params;
  const body = await req.json();
  const { matches } = body as { matches: MatchResult[] };

  if (!Array.isArray(matches) || matches.length === 0) {
    return NextResponse.json({ error: "无匹配数据" }, { status: 400 });
  }

  try {
    // Get or create storyboard
    let storyboard = await prisma.storyboard.findUnique({
      where: { projectId },
    });

    if (!storyboard) {
      storyboard = await prisma.storyboard.create({
        data: {
          projectId,
          title: `智能匹配分镜`,
          totalScenes: matches.length,
          status: "EDITED",
        },
      });
    } else {
      // Clear existing scenes
      await prisma.scene.deleteMany({
        where: { storyboardId: storyboard.id },
      });
    }

    // Create scenes from matches
    for (const match of matches) {
      await prisma.scene.create({
        data: {
          storyboardId: storyboard.id,
          sceneNumber: match.sceneNumber,
          title: match.sceneTitle,
          sceneType: "REAL_FOOTAGE",
          voiceoverText: match.voiceoverText,
          visualDesc: match.suggestedMaterial,
          materialQuery: match.keywords.join(" "),
          wordCount: match.voiceoverText.length,
          estimatedDuration: match.voiceoverText.length / 4,
          transition: "CROSS_DISSOLVE",
        },
      });
    }

    // Update storyboard
    await prisma.storyboard.update({
      where: { id: storyboard.id },
      data: {
        totalScenes: matches.length,
        totalWords: matches.reduce(
          (sum, m) => sum + m.voiceoverText.length,
          0
        ),
        totalDuration: matches.reduce(
          (sum, m) => sum + m.voiceoverText.length / 4,
          0
        ),
      },
    });

    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "STORYBOARD_READY" },
    });

    return NextResponse.json({ success: true, storyboardId: storyboard.id });
  } catch (error) {
    console.error("Apply matches error:", error);
    return NextResponse.json(
      { error: "应用匹配失败" },
      { status: 500 }
    );
  }
}
