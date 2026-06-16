import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { searchMaterialsForScene, extractVisualDescKeywords, type MaterialResult, type SceneSearchContext } from "@/lib/materials/search-engine";
import { renderProjectInline } from "@/lib/render/pipeline";

/**
 * Re-rank material results by visualDesc semantic relevance.
 * Prioritizes sourceVideos title match + visualDesc keyword coverage.
 */
function rerankByVisualDesc(
  results: MaterialResult[],
  visualDesc: string,
  materialQuery: string,
  sourceVideos: string[]
): MaterialResult[] {
  if (!visualDesc || results.length <= 1) return results;

  const visKeywords = extractVisualDescKeywords(visualDesc);

  const scored = results.map(r => {
    const title = (r.title || "").replace(/[\s　、。，；《》「」『』""''【】]/g, "");
    const searchTarget = title + " " + (r.description || "") + " " + (r.searchQuery || "");

    let bonus = 0;

    // SourceVideos title match bonus (+0.3)
    for (const sv of sourceVideos) {
      const svClean = sv.replace(/[\s　、。，；《》「」『』""''【】]/g, "");
      if (title.includes(svClean)) {
        bonus += 0.3;
        break;
      }
      // Abbreviation match
      const half = svClean.slice(0, Math.ceil(svClean.length / 2));
      if (half.length >= 2 && title.includes(half)) {
        bonus += 0.2;
        break;
      }
    }

    // visualDesc keyword coverage bonus (max +0.4)
    let kwHits = 0;
    for (const kw of visKeywords) {
      if (searchTarget.includes(kw)) kwHits++;
    }
    if (visKeywords.length > 0) {
      bonus += (kwHits / visKeywords.length) * 0.4;
    }

    // materialQuery exact match bonus (+0.1)
    const mqClean = materialQuery.replace(/[\s,，、]+/g, "");
    if (mqClean && searchTarget.includes(mqClean)) {
      bonus += 0.1;
    }

    return { result: r, finalScore: Math.min(1, (r.matchScore || 0.5) + bonus) };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.map(s => s.result);
}

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

    // Auto-search and assign materials for each scene using smart search engine
    // Bilibili search does NOT require PEXELS_API_KEY — only Pexels/Pixabay fallback does
    const pexelsApiKey = process.env.PEXELS_API_KEY;
    if (!pexelsApiKey) {
      console.warn("PEXELS_API_KEY not configured — Pexels/Pixabay fallback disabled, Bilibili search still available");
    }

    for (const scene of storyboard.scenes) {
      if (scene.materialId) {
        console.log(`[Confirm] Scene ${scene.sceneNumber}: already has material, skipping`);
        continue;
      }
      if (!scene.materialQuery && !scene.visualDesc) {
        console.warn(`[Confirm] Scene ${scene.sceneNumber}: no materialQuery or visualDesc, skipping`);
        continue;
      }
      // AI-generated scenes: skip stock search, pipeline handles generation during render
      if (scene.sceneType === "AI_GENERATED") {
        console.log(`[Confirm] Scene ${scene.sceneNumber}: AI_GENERATED, deferred to render pipeline`);
        continue;
      }

      try {
        // Parse productionMeta to get English keywords and sourceVideos
        let materialQueryEn: string | undefined;
        let sourceVideos: string[] | undefined;
        if (scene.productionMeta) {
          try {
            const meta = JSON.parse(scene.productionMeta);
            materialQueryEn = meta.materialQueryEn;
            sourceVideos = meta.sourceVideos;
          } catch {}
        }

        console.log(`[Confirm] Scene ${scene.sceneNumber}: searching material (query="${(scene.materialQuery || "").substring(0, 40)}", sourceVideos=${JSON.stringify(sourceVideos)})`);

        const searchCtx: SceneSearchContext = {
          sceneNumber: scene.sceneNumber,
          materialQuery: scene.materialQuery || "",
          materialQueryEn,
          visualDesc: scene.visualDesc,
          sourceVideos,
        };

        const results = await searchMaterialsForScene(searchCtx, 3);
        if (results.length === 0) {
          console.warn(`[Confirm] Scene ${scene.sceneNumber}: no material found`);
          continue;
        }

        const reranked = rerankByVisualDesc(
          results,
          scene.visualDesc || "",
          scene.materialQuery || "",
          sourceVideos || []
        );
        const best = reranked[0];
        console.log(`[Confirm] Scene ${scene.sceneNumber}: found material from ${best.platform} (${best.type}, ${best.width}x${best.height}, score=${best.matchScore})${best.title ? ` title="${best.title.slice(0, 40)}"` : ""}`);

        const material = await prisma.material.create({
          data: {
            projectId: id,
            name: best.title
              ? `Scene ${scene.sceneNumber} - ${best.title.slice(0, 60)}`
              : `Scene ${scene.sceneNumber} - ${scene.materialQuery}`,
            type: best.type,
            source: "STOCK_FOOTAGE",
            fileUrl: best.fileUrl,
            thumbnailUrl: best.thumbnailUrl,
            width: best.width,
            height: best.height,
            duration: best.duration,
            externalId: best.externalId,
            externalSource: best.platform,
            searchQuery: best.searchQuery,
            matchScore: best.matchScore,
          },
        });

        await prisma.scene.update({
          where: { id: scene.id },
          data: { materialId: material.id },
        });
      } catch (err) {
        console.error(`[Confirm] Scene ${scene.sceneNumber} material search failed:`, err);
      }
    }

    // Auto-trigger render pipeline (inline, no Redis needed)
    let renderStarted = false;
    try {
      renderProjectInline(id, session.user.id).catch(err => {
        console.error("Inline render failed:", err);
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
