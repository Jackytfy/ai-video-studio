import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { searchVideos } from "@/lib/materials/pexels";
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

    await prisma.storyboard.update({
      where: { projectId: id },
      data: { status: "CONFIRMED" },
    });

    await prisma.project.update({
      where: { id },
      data: { status: "PRODUCING" },
    });

    // Auto-search and assign materials for each scene
    for (const scene of storyboard.scenes) {
      if (!scene.materialQuery || scene.materialId) continue;

      try {
        const videos = await searchVideos(scene.materialQuery, 3);
        if (videos.length === 0) continue;

        const best = videos[0];
        const bestFile = best.video_files.find((f) => f.quality === "hd") || best.video_files[0];
        if (!bestFile) continue;

        const material = await prisma.material.create({
          data: {
            projectId: id,
            name: `Scene ${scene.sceneNumber} - ${scene.materialQuery}`,
            type: "VIDEO",
            source: "STOCK_FOOTAGE",
            fileUrl: bestFile.link,
            thumbnailUrl: best.image,
            width: bestFile.width,
            height: bestFile.height,
            duration: best.duration,
            externalId: String(best.id),
            externalSource: "pexels",
            searchQuery: scene.materialQuery,
            matchScore: 1.0,
          },
        });

        await prisma.scene.update({
          where: { id: scene.id },
          data: { materialId: material.id },
        });
      } catch (err) {
        console.error(`Material search failed for scene ${scene.sceneNumber}:`, err);
      }
    }

    // Auto-trigger render pipeline
    let renderStarted = false;
    try {
      await createRenderJob(id, session.user.id);
      await prisma.project.update({
        where: { id },
        data: { status: "RENDERING" },
      });
      renderStarted = true;
    } catch (renderErr) {
      console.error("Auto-render failed:", renderErr);
    }

    await prisma.chatMessage.create({
      data: {
        projectId: id,
        role: "SYSTEM",
        content: renderStarted
          ? "分镜脚本已确认，素材匹配完成，视频渲染已自动启动。"
          : "分镜脚本已确认，素材匹配完成。渲染启动失败，请手动触发渲染。",
        messageType: "GENERATION_STATUS",
      },
    });

    return NextResponse.json({ success: true, renderStarted });
  } catch (error) {
    return NextResponse.json({ error: "确认分镜失败" }, { status: 500 });
  }
}
