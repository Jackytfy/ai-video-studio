import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

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
    include: {
      segments: { orderBy: { sortOrder: "asc" } },
      musicTracks: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (project.segments.length === 0) {
    return NextResponse.json({ error: "没有视频片段" }, { status: 400 });
  }

  // Declared outside the `try` so the unconditional `finally` cleanup can
  // always see it — even on the very first failure, before we created the
  // dir (the `rm` is no-op-safe via `force: true`).
  const workDir = join(tmpdir(), `editor-render-${projectId}-${randomUUID()}`);

  try {
    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "RENDERING" },
    });

    // Append a random suffix so two concurrent editor-renders of the same
    // project cannot clobber each other's intermediate segments. Cleanup
    // runs unconditionally via `finally` below — the previous implementation
    // only cleaned up on the success path, so a render that threw or timed
    // out leaked the entire tmpdir full of segment files.
    await mkdir(workDir, { recursive: true });

    // Determine output dimensions based on first segment
    const outputWidth = 1920;
    const outputHeight = 1080;
    const fps = 30;

    // Process each segment
    const segmentFiles: string[] = [];
    for (let i = 0; i < project.segments.length; i++) {
      const seg = project.segments[i];
      const outputPath = join(workDir, `seg-${i}.mp4`);

      // Get the actual file path
      const filePath = join(process.cwd(), seg.fileUrl.replace(/^\//, ""));

      // Apply trimming if needed
      if (seg.trimStart !== null && seg.trimEnd !== null) {
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            filePath,
            "-ss",
            String(seg.trimStart),
            "-to",
            String(seg.trimEnd),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-vf",
            `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2`,
            "-r",
            String(fps),
            outputPath,
          ],
          { timeout: 120000 }
        );
      } else {
        // Just scale/encode
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            filePath,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-vf",
            `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2`,
            "-r",
            String(fps),
            outputPath,
          ],
          { timeout: 120000 }
        );
      }

      segmentFiles.push(outputPath);
    }

    // Create concat list file
    const concatListPath = join(workDir, "concat.txt");
    const concatContent = segmentFiles
      .map((f) => `file '${f.replace(/\\/g, "/")}'`)
      .join("\n");
    await writeFile(concatListPath, concatContent);

    // Concatenate all segments
    const concatOutputPath = join(workDir, "concat-output.mp4");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        concatOutputPath,
      ],
      { timeout: 300000 }
    );

    // Process background music if any
    let finalOutputPath = concatOutputPath;
    const totalDuration = getTotalDuration(project.segments);

    if (project.musicTracks.length > 0) {
      const musicTrack = project.musicTracks[0]; // Use first track

      if (musicTrack.fileUrl) {
        const musicPath = join(process.cwd(), musicTrack.fileUrl.replace(/^\//, ""));
        const musicOutputPath = join(workDir, "final-with-music.mp4");

        // Mix music with original audio
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            concatOutputPath,
            "-i",
            musicPath,
            "-filter_complex",
            `[0:a]volume=1.0[voice];[1:a]volume=${musicTrack.volume},afade=t=in:st=0:d=${musicTrack.fadeIn},afade=t=out:st=${totalDuration - musicTrack.fadeOut}:d=${musicTrack.fadeOut}[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
            "-map",
            "0:v",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            musicOutputPath,
          ],
          { timeout: 300000 }
        );

        finalOutputPath = musicOutputPath;
      }
    }

    // Get video duration
    let outputDuration = 0;
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          finalOutputPath,
        ],
        { timeout: 10000 }
      );
      outputDuration = parseFloat(stdout.trim());
    } catch {}

    // Generate thumbnail
    const thumbnailPath = join(workDir, "thumbnail.jpg");
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          finalOutputPath,
          "-ss",
          "00:00:02",
          "-vframes",
          "1",
          "-vf",
          "scale=640:-1",
          thumbnailPath,
        ],
        { timeout: 10000 }
      );
    } catch {}

    // Copy output to uploads directory
    const uploadsDir = join(process.cwd(), "uploads", projectId, "output");
    await mkdir(uploadsDir, { recursive: true });
    const outputFileName = `${randomUUID()}.mp4`;
    const finalPath = join(uploadsDir, outputFileName);

    const outputBuffer = await readFile(finalOutputPath);
    await writeFile(finalPath, outputBuffer);

    // Generate thumbnail in uploads
    const thumbFileName = `${randomUUID()}.jpg`;
    const thumbPath = join(uploadsDir, thumbFileName);
    try {
      const thumbBuffer = await readFile(thumbnailPath);
      await writeFile(thumbPath, thumbBuffer);
    } catch {}

    // Update project
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "COMPLETED",
      },
    });

    return NextResponse.json({
      success: true,
      outputUrl: `/api/uploads/${projectId}/output/${outputFileName}`,
      thumbnailUrl: `/api/uploads/${projectId}/output/${thumbFileName}`,
      duration: outputDuration,
      size: outputBuffer.length,
    });
  } catch (error) {
    console.error("Render editor error:", error);

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "FAILED" },
    });

    return NextResponse.json({ error: "渲染失败" }, { status: 500 });
  } finally {
    // Always clean up the scratch dir, regardless of success / failure /
    // timeout. Best-effort: a leftover tmpdir from a Node crash will be
    // picked up by the next process start's tmp-cleanup pass (or, on most
    // OSes, by tmpfs reaping on reboot).
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Helper to calculate total duration from segments
function getTotalDuration(segments: Array<{ duration: number; trimStart: number | null; trimEnd: number | null }>): number {
  return segments.reduce((sum, seg) => {
    const duration = (seg.trimEnd ?? seg.duration) - (seg.trimStart ?? 0);
    return sum + duration;
  }, 0);
}
