import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Hard cap for user-supplied video uploads. `next.config.ts` only enforces
// this on Server Actions — for App Router POST handlers Next streams the
// body straight to `req.formData()` with no built-in cap, so a 4 GB file
// would end up fully in memory (Buffer.from(file.arrayBuffer())) before
// we ever saw a chance to reject it. 200 MB matches what 1080p hand-shot
// video typically tops out at after our editor's transcode step.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // Reject oversized requests before reading the body. Browsers and the
  // `fetch` API always send a Content-Length, so this is the cheap path.
  // Chunked / missing-length uploads (curl --data-binary, some proxies)
  // are caught by the post-parse size check below — we still let them
  // through the Content-Length gate to avoid breaking legitimate clients.
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `视频文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 限制` },
      { status: 413 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("video") as File;
    const name = (formData.get("name") as string) || `片段 ${Date.now()}`;

    if (!file) {
      return NextResponse.json({ error: "未提供视频文件" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `视频文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 限制` },
        { status: 413 },
      );
    }

    // Save file to disk
    const uploadDir = join(process.cwd(), "uploads", projectId);
    await mkdir(uploadDir, { recursive: true });

    const ext = file.name.split(".").pop() || "mp4";
    const fileName = `${randomUUID()}.${ext}`;
    const filePath = join(uploadDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Get video duration using ffprobe
    let duration = 0;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ], { timeout: 10000 });
      duration = parseFloat(stdout.trim());
    } catch {
      duration = 5; // fallback
    }

    // Generate thumbnail
    const thumbnailDir = join(process.cwd(), "uploads", projectId, "thumbnails");
    await mkdir(thumbnailDir, { recursive: true });
    const thumbnailName = `${randomUUID()}.jpg`;
    const thumbnailPath = join(thumbnailDir, thumbnailName);

    try {
      await execFileAsync("ffmpeg", [
        "-y", "-i", filePath,
        "-ss", "00:00:01",
        "-vframes", "1",
        "-vf", "scale=320:-1",
        thumbnailPath,
      ], { timeout: 10000 });
    } catch {
      // thumbnail generation is optional
    }

    // Get max sort order
    const lastSegment = await prisma.videoSegment.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
    });

    const segment = await prisma.videoSegment.create({
      data: {
        projectId,
        name,
        fileUrl: `/api/uploads/${projectId}/${fileName}`,
        thumbnailUrl: `/api/uploads/${projectId}/thumbnails/${thumbnailName}`,
        duration,
        fileSize: buffer.length,
        format: ext,
        sortOrder: (lastSegment?.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json(segment);
  } catch (error) {
    console.error("Upload segment error:", error);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
