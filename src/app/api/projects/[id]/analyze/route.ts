import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { analyzeContent, buildProviderConfig } from "@/lib/ai";

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
      buildProviderConfig(session.user)
    );

    await prisma.project.update({
      where: { id },
      data: {
        aiAnalysis: JSON.stringify(analysis),
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
