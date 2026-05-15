import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { uploadBuffer } from "@/lib/storage/s3";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

const FORMAT_CONFIG: Record<string, { resolution: string; crf: string; preset: string; ext: string }> = {
  MP4_720P: { resolution: "1280x720", crf: "23", preset: "medium", ext: "mp4" },
  MP4_1080P: { resolution: "1920x1080", crf: "20", preset: "medium", ext: "mp4" },
  MP4_4K: { resolution: "3840x2160", crf: "18", preset: "slow", ext: "mp4" },
  MOV_PRORES: { resolution: "1920x1080", crf: "0", preset: "medium", ext: "mov" },
  GIF: { resolution: "480x270", crf: "20", preset: "fast", ext: "gif" },
};

const exportSchema = z.object({
  format: z.enum(["MP4_1080P", "MP4_720P", "MP4_4K", "MOV_PRORES", "GIF"]).default("MP4_1080P"),
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
      include: { renderJobs: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 1 } },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    if (project.status !== "COMPLETED") {
      return NextResponse.json({ error: "视频渲染完成后才能导出" }, { status: 400 });
    }

    const renderJob = project.renderJobs[0];
    if (!renderJob?.outputUrl) {
      return NextResponse.json({ error: "找不到已渲染的视频" }, { status: 400 });
    }

    const body = await req.json();
    const { format } = exportSchema.parse(body);

    const exportJob = await prisma.exportJob.create({
      data: { projectId: id, format, status: "PROCESSING" },
    });

    // Process export in background
    processExport(exportJob.id, renderJob.outputUrl, format).catch((err) => {
      console.error("Export processing error:", err);
    });

    return NextResponse.json(exportJob);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    return NextResponse.json({ error: "创建导出任务失败" }, { status: 500 });
  }
}

async function processExport(exportId: string, sourceUrl: string, format: string) {
  const config = FORMAT_CONFIG[format] || FORMAT_CONFIG.MP4_1080P;
  const workDir = await mkdtemp(join(tmpdir(), "export-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, `output.${config.ext}`);

  try {
    // Download source
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error("Failed to download source video");
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    // Re-encode
    const ffmpegArgs = ["-y", "-i", inputPath];

    if (format === "MOV_PRORES") {
      ffmpegArgs.push("-c:v", "prores_ks", "-profile:v", "3", "-c:a", "pcm_s16le");
    } else if (format === "GIF") {
      ffmpegArgs.push("-vf", `fps=10,scale=${config.resolution}:flags=lanczos`, "-loop", "0");
    } else {
      const [w, h] = config.resolution.split("x");
      ffmpegArgs.push(
        "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v", "libx264", "-crf", config.crf, "-preset", config.preset,
        "-c:a", "aac", "-b:a", "192k"
      );
    }

    ffmpegArgs.push(outputPath);
    await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 300000 });

    const outputBuffer = await readFile(outputPath);
    const contentType = format === "GIF" ? "image/gif" : format === "MOV_PRORES" ? "video/quicktime" : "video/mp4";
    const { url } = await uploadBuffer(outputBuffer, contentType, "exports");

    await prisma.exportJob.update({
      where: { id: exportId },
      data: { status: "COMPLETED", outputUrl: url, fileSize: outputBuffer.length, completedAt: new Date() },
    });
  } catch (error) {
    await prisma.exportJob.update({
      where: { id: exportId },
      data: { status: "FAILED" },
    });
    throw error;
  } finally {
    const fs = await import("fs/promises");
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
