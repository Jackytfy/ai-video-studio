import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { renderProjectInline } from "@/lib/render/pipeline";

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
      include: { storyboard: true },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    if (!project.storyboard || project.storyboard.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "请先确认分镜脚本" },
        { status: 400 }
      );
    }

    // Allow re-render if project was previously failed
    if (project.status === "RENDERING") {
      return NextResponse.json(
        { error: "项目正在渲染中，请稍候" },
        { status: 409 }
      );
    }

    // Reset project status if previously failed
    if (project.status === "FAILED") {
      await prisma.project.update({
        where: { id },
        data: { status: "STORYBOARD_READY" },
      });
    }

    // Inline render - no Redis needed
    const result = await renderProjectInline(id, session.user.id);

    return NextResponse.json({
      success: true,
      outputUrl: result.outputUrl,
      duration: result.duration,
    });
  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json(
      { error: "渲染失败: " + (error instanceof Error ? error.message : "未知错误") },
      { status: 500 }
    );
  }
}
