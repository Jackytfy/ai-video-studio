import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export async function POST(
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
  const { trimStart, trimEnd } = body;

  if (
    typeof trimStart !== "number" ||
    typeof trimEnd !== "number" ||
    trimStart >= trimEnd
  ) {
    return NextResponse.json({ error: "无效的裁剪范围" }, { status: 400 });
  }

  try {
    // Get the original file path from the URL
    const originalPath = join(process.cwd(), segment.fileUrl.replace(/^\//, ""));
    const outputDir = join(process.cwd(), "uploads", projectId);
    await mkdir(outputDir, { recursive: true });

    const outputName = `${randomUUID()}.mp4`;
    const outputPath = join(outputDir, outputName);

    // Trim the video using ffmpeg
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", originalPath,
      "-ss", String(trimStart),
      "-to", String(trimEnd),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      outputPath,
    ], { timeout: 60000 });

    // Generate new thumbnail
    const thumbnailDir = join(outputDir, "thumbnails");
    await mkdir(thumbnailDir, { recursive: true });
    const thumbnailName = `${randomUUID()}.jpg`;
    const thumbnailPath = join(thumbnailDir, thumbnailName);

    try {
      await execFileAsync("ffmpeg", [
        "-y", "-i", outputPath,
        "-ss", "00:00:01",
        "-vframes", "1",
        "-vf", "scale=320:-1",
        thumbnailPath,
      ], { timeout: 10000 });
    } catch {}

    // Update segment record
    const updated = await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        fileUrl: `/api/uploads/${projectId}/${outputName}`,
        thumbnailUrl: `/api/uploads/${projectId}/thumbnails/${thumbnailName}`,
        trimStart,
        trimEnd,
        duration: trimEnd - trimStart,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Trim error:", error);
    return NextResponse.json({ error: "裁剪失败" }, { status: 500 });
  }
}
