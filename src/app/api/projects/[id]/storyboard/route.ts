import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

export async function GET(
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

    const storyboard = await prisma.storyboard.findUnique({
      where: { projectId: id },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });

    if (!storyboard) {
      return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
    }

    return NextResponse.json(storyboard);
  } catch (error) {
    return NextResponse.json({ error: "获取分镜失败" }, { status: 500 });
  }
}
