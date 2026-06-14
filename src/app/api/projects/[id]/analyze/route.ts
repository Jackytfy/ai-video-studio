import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { analyzeContent, buildProviderConfig } from "@/lib/ai";
import { splitLongText } from "@/lib/ai/chapterize";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    await prisma.project.update({
      where: { id },
      data: { status: "ANALYZING" },
    });

    const analysis = await analyzeContent(
      project.sourceText,
      project.contentStyle,
      buildProviderConfig(session.user),
      project.materialRequirements ? JSON.parse(project.materialRequirements) : null,
    );

    // For long texts, pre-split into chapters and scene segments
    const WORD_THRESHOLD = 800;
    const textLength = (project.sourceText.match(/[\u4e00-\u9fff]/g) || []).length +
      project.sourceText.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(w => w).length;

    let chapterInfo = null;
    if (textLength > WORD_THRESHOLD) {
      const { chapters, scenes } = splitLongText(project.sourceText);
      chapterInfo = {
        totalChapters: chapters.length,
        totalScenes: scenes.length,
        chapters: chapters.map(c => ({ title: c.title, wordCount: c.wordCount })),
        sceneSegments: scenes,
      };
    }

    await prisma.project.update({
      where: { id },
      data: {
        aiAnalysis: JSON.stringify({ ...analysis, chapterInfo }),
        status: "DRAFT",
      },
    });

    await prisma.chatMessage.create({
      data: {
        projectId: id,
        role: "ASSISTANT",
        content: JSON.stringify(analysis),
        messageType: "ANALYSIS",
        metadata: JSON.stringify({ analysis }),
      },
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    const { id } = await params;
    await prisma.project.update({
      where: { id },
      data: { status: "FAILED" },
    }).catch(() => {});

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Analysis error:", errMsg);
    return NextResponse.json(
      { error: `AI 分析失败: ${errMsg}` },
      { status: 500 }
    );
  }
}
