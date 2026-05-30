import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; segmentId: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId, segmentId } = await params;

  const segment = await prisma.videoSegment.findFirst({
    where: { id: segmentId, projectId },
  });
  if (!segment) {
    return NextResponse.json({ error: "片段不存在" }, { status: 404 });
  }

  const body = await req.json();

  const updated = await prisma.videoSegment.update({
    where: { id: segmentId },
    data: {
      name: body.name ?? segment.name,
      trimStart: body.trimStart ?? segment.trimStart,
      trimEnd: body.trimEnd ?? segment.trimEnd,
      sortOrder: body.sortOrder ?? segment.sortOrder,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; segmentId: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId, segmentId } = await params;

  await prisma.videoSegment.deleteMany({
    where: { id: segmentId, projectId },
  });

  return NextResponse.json({ success: true });
}
