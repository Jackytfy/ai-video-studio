import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

// Free music sources - using Pixabay's free music API
const PIXABAY_API_URL = "https://pixabay.com/api/";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId } = await params;
  const body = await req.json();
  const { query, mood, genre } = body;

  try {
    // Try Pixabay API for free music
    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (pixabayKey) {
      const searchQuery = [query, mood, genre].filter(Boolean).join(" ");
      const res = await fetch(
        `${PIXABAY_API_URL}?key=${pixabayKey}&q=${encodeURIComponent(searchQuery)}&media_type=music&per_page=5`
      );

      if (res.ok) {
        const data = await res.json();
        if (data.hits && data.hits.length > 0) {
          const hit = data.hits[0];
          const track = await prisma.musicTrack.create({
            data: {
              projectId,
              name: hit.tags || query || "背景音乐",
              fileUrl: hit.audio || hit.previewURL,
              duration: hit.duration || 60,
              volume: 0.3,
              mood: mood || null,
              genre: genre || null,
              isBgm: true,
            },
          });
          return NextResponse.json({ track });
        }
      }
    }

    // Fallback: create a placeholder track that will be resolved during render
    const track = await prisma.musicTrack.create({
      data: {
        projectId,
        name: query || "背景音乐",
        fileUrl: "", // Will be resolved by worker
        duration: 0,
        volume: 0.3,
        mood: mood || null,
        genre: genre || null,
        isBgm: true,
      },
    });

    return NextResponse.json({ track });
  } catch (error) {
    console.error("Music search error:", error);
    return NextResponse.json({ error: "搜索失败" }, { status: 500 });
  }
}
