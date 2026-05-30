import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

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
  const { segmentIds } = body;

  if (!Array.isArray(segmentIds)) {
    return NextResponse.json({ error: "无效的排序数据" }, { status: 400 });
  }

  // Update sort order for each segment
  await Promise.all(
    segmentIds.map((segmentId: string, index: number) =>
      prisma.videoSegment.updateMany({
        where: { id: segmentId, projectId },
        data: { sortOrder: index },
      })
    )
  );

  const segments = await prisma.videoSegment.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(segments);
}
