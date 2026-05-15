import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const createProjectSchema = z.object({
  name: z.string().min(1, "项目名称不能为空"),
  sourceText: z.string().min(1, "请输入文稿内容"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  voice: z.string().default("yunxi"),
  contentStyle: z.enum(["knowledge", "culture", "classic", "custom"]).default("knowledge"),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const projects = await prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        storyboard: {
          select: { totalScenes: true, totalDuration: true, status: true },
        },
      },
    });
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: "获取项目列表失败" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const body = await req.json();
    const data = createProjectSchema.parse(body);

    const project = await prisma.project.create({
      data: {
        name: data.name,
        sourceText: data.sourceText,
        aspectRatio: data.aspectRatio === "9:16" ? "W_9_16" : data.aspectRatio === "1:1" ? "W_1_1" : "W_16_9",
        contentStyle: data.contentStyle === "culture" ? "CULTURE" : data.contentStyle === "classic" ? "CLASSIC_HISTORY" : data.contentStyle === "custom" ? "CUSTOM" : "KNOWLEDGE",
        userId: session.user.id,
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      return NextResponse.json(
        { error: firstError?.message ?? "参数错误" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "创建项目失败" },
      { status: 500 }
    );
  }
}
