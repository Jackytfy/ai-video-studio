import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { searchMaterialsForScene, type SceneSearchContext } from "@/lib/materials/search-engine";

const searchSchema = z.object({
  sceneId: z.string(),
  count: z.number().int().min(1).max(20).default(5),
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
    const { sceneId, count } = searchSchema.parse(body);

    const scene = await prisma.scene.findFirst({
      where: { id: sceneId, storyboard: { projectId: id } },
    });

    if (!scene) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    // Parse productionMeta for English keywords
    let materialQueryEn: string | undefined;
    if (scene.productionMeta) {
      try {
        const meta = JSON.parse(scene.productionMeta);
        materialQueryEn = meta.materialQueryEn;
      } catch {}
    }

    const searchCtx: SceneSearchContext = {
      sceneNumber: scene.sceneNumber,
      materialQuery: scene.materialQuery,
      materialQueryEn,
      visualDesc: scene.visualDesc,
    };

    const results = await searchMaterialsForScene(searchCtx, count);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("Smart material search error:", error);
    return NextResponse.json({ error: "搜索素材失败" }, { status: 500 });
  }
}
