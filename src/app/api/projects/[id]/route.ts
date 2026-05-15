import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "ANALYZING", "STORYBOARD_GENERATING", "STORYBOARD_READY", "PRODUCING", "EDITING", "RENDERING", "COMPLETED", "FAILED"]).optional(),
  aiAnalysis: z.string().nullable().optional(),
  productionPlan: z.string().optional(),
  contentStyle: z.enum(["KNOWLEDGE", "CULTURE", "CLASSIC_HISTORY", "CUSTOM"]).optional(),
  colorTheme: z.string().optional(),
});

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
      include: {
        storyboard: {
          include: { scenes: { orderBy: { sceneNumber: "asc" } } },
        },
        _count: { select: { messages: true, materials: true, renderJobs: true } },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    return NextResponse.json({ error: "获取项目失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const data = updateProjectSchema.parse(body);

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const updated = await prisma.project.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    return NextResponse.json({ error: "更新项目失败" }, { status: 500 });
  }
}

export async function DELETE(
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

    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "删除项目失败" }, { status: 500 });
  }
}
