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
    const renderJobs = await prisma.renderJob.findMany({
      where: {
        projectId: id,
        userId: session.user.id,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return NextResponse.json(renderJobs);
  } catch (error) {
    return NextResponse.json({ error: "获取渲染状态失败" }, { status: 500 });
  }
}
