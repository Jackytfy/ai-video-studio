import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const assignSchema = z.object({
  sceneId: z.string(),
  material: z.object({
    externalId: z.string(),
    type: z.enum(["VIDEO", "IMAGE"]),
    source: z.enum(["STOCK_FOOTAGE", "AI_GENERATED", "USER_UPLOADED"]),
    fileUrl: z.string(),
    thumbnailUrl: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    searchQuery: z.string().optional(),
  }),
});

export async function POST(
  req: Request,
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

    const body = await req.json();
    const { sceneId, material: mat } = assignSchema.parse(body);

    const scene = await prisma.scene.findFirst({
      where: { id: sceneId, storyboard: { projectId: id } },
    });

    if (!scene) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    const material = await prisma.material.create({
      data: {
        projectId: id,
        name: `Scene ${scene.sceneNumber} material`,
        type: mat.type as "VIDEO" | "IMAGE",
        source: mat.source as "STOCK_FOOTAGE" | "AI_GENERATED" | "USER_UPLOADED",
        fileUrl: mat.fileUrl,
        thumbnailUrl: mat.thumbnailUrl,
        width: mat.width,
        height: mat.height,
        duration: mat.duration,
        externalId: mat.externalId,
        externalSource: "pexels",
        searchQuery: mat.searchQuery,
      },
    });

    await prisma.scene.update({
      where: { id: sceneId },
      data: { materialId: material.id },
    });

    return NextResponse.json({ material });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("Material assign error:", error);
    return NextResponse.json({ error: "分配素材失败" }, { status: 500 });
  }
}
