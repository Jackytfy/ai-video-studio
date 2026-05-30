import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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

  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File;
    const name = (formData.get("name") as string) || `音乐 ${Date.now()}`;

    if (!file) {
      return NextResponse.json({ error: "未提供音频文件" }, { status: 400 });
    }

    // Save file
    const uploadDir = join(process.cwd(), "uploads", projectId, "music");
    await mkdir(uploadDir, { recursive: true });

    const ext = file.name.split(".").pop() || "mp3";
    const fileName = `${randomUUID()}.${ext}`;
    const filePath = join(uploadDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Get duration
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
      duration = 0;
    }

    const track = await prisma.musicTrack.create({
      data: {
        projectId,
        name,
        fileUrl: `/api/uploads/${projectId}/music/${fileName}`,
        duration,
        volume: 0.3,
        isBgm: true,
      },
    });

    return NextResponse.json({ track });
  } catch (error) {
    console.error("Upload music error:", error);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
