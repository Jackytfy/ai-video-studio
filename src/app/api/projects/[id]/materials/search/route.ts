import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { searchVideos, searchImages } from "@/lib/materials/pexels";

const searchSchema = z.object({
  query: z.string().min(1),
  type: z.enum(["video", "image"]).default("video"),
  count: z.number().int().min(1).max(30).default(10),
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
    const { query, type, count } = searchSchema.parse(body);

    let results;
    if (type === "video") {
      const videos = await searchVideos(query, count);
      results = videos.map((v) => ({
        externalId: String(v.id),
        type: "VIDEO",
        source: "STOCK_FOOTAGE",
        fileUrl: v.video_files[0]?.link || "",
        thumbnailUrl: v.image,
        width: v.width,
        height: v.height,
        duration: v.duration,
      }));
    } else {
      const images = await searchImages(query, count);
      results = images.map((img) => ({
        externalId: String(img.id),
        type: "IMAGE",
        source: "STOCK_FOOTAGE",
        fileUrl: img.src.large,
        thumbnailUrl: img.src.medium,
        width: img.width,
        height: img.height,
      }));
    }

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("Material search error:", error);
    return NextResponse.json({ error: "搜索素材失败" }, { status: 500 });
  }
}
