import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { createRenderJob } from "@/lib/render/pipeline";

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

    const renderJob = await createRenderJob(id, session.user.id);

    await prisma.project.update({
      where: { id },
      data: { status: "RENDERING" },
    });

    return NextResponse.json(renderJob);
  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json(
      { error: "创建渲染任务失败" },
      { status: 500 }
    );
  }
}
