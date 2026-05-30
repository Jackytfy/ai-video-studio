import { prisma } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import {
  generateSubtitleChunks,
  buildSubtitleFilterChain,
  estimateAudioDuration,
  getAudioDuration,
  type SubtitleConfig,
} from "./subtitle";

const execFileAsync = promisify(execFile);

export interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  format: string;
}

const ASPECT_CONFIGS: Record<string, RenderConfig> = {
  W_16_9: { width: 1920, height: 1080, fps: 30, format: "mp4" },
  W_9_16: { width: 1080, height: 1920, fps: 30, format: "mp4" },
  W_1_1: { width: 1080, height: 1080, fps: 30, format: "mp4" },
};

export function getRenderConfig(aspectRatio: string): RenderConfig {
  return ASPECT_CONFIGS[aspectRatio] || ASPECT_CONFIGS.W_16_9;
}

// Inline render - no Redis/BullMQ dependency
export async function renderProjectInline(
  projectId: string,
  userId: string
): Promise<{ outputUrl: string; duration: number }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      storyboard: {
        include: {
          scenes: { orderBy: { sceneNumber: "asc" } },
        },
      },
      musicTracks: { where: { isBgm: true }, take: 1 },
    },
  });

  if (!project) throw new Error("Project not found");
  if (!project.storyboard) throw new Error("Storyboard not found");
  if (project.storyboard.scenes.length === 0) throw new Error("No scenes");

  const config = getRenderConfig(project.aspectRatio);
  const scenes = project.storyboard.scenes;

  // Create render job record
  const renderJob = await prisma.renderJob.create({
    data: {
      projectId,
      userId,
      status: "PREPARING",
      config: JSON.stringify({ ...config, sceneCount: scenes.length }),
      startedAt: new Date(),
    },
  });

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "RENDERING" },
    });

    const workDir = join(tmpdir(), `render-${projectId}`);
    await mkdir(workDir, { recursive: true });

    // TTS stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "TTS_GENERATING", currentStage: "tts" },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isMiMo = user?.ttsProvider === "mimo";
    const edgeVoice = user?.ttsVoice || "zh-CN-YunxiNeural";

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (scene.audioUrl) continue;

      const audioFile = join(workDir, `tts-${i}.mp3`);

      if (isMiMo) {
        // MiMo TTS
        const mimoVoice = user?.ttsVoice || "冰糖";
        const mimoApiKey = user?.aiApiKey || process.env.MIMO_API_KEY || "";
        const mimoBaseUrl = user?.aiBaseUrl || "https://token-plan-cn.xiaomimimo.com/v1";
        const res = await fetch(`${mimoBaseUrl}/chat/completions`, {
          method: "POST",
          headers: { "api-key": mimoApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "mimo-v2.5-tts",
            messages: [{ role: "assistant", content: scene.voiceoverText }],
            audio: { format: "wav", voice: mimoVoice },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const audioData = data.choices?.[0]?.message?.audio?.data;
          if (audioData) {
            await writeFile(audioFile, Buffer.from(audioData, "base64"));
          }
        }
      } else {
        // Edge TTS
        try {
          await execFileAsync("python", [
            "-m", "edge_tts",
            "--voice", edgeVoice,
            "--rate", "+0%",
            "--volume", "+0%",
            "--text", scene.voiceoverText,
            "--write-media", audioFile,
          ], { timeout: 30000 });
        } catch (e) {
          console.error(`TTS failed for scene ${i}:`, e);
          // Create silent audio fallback (use mp3 codec for .mp3 container)
          await execFileAsync("ffmpeg", [
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
          ], { timeout: 10000 });
        }
      }

      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioUrl: audioFile, audioDuration: scene.voiceoverText.length / 4 },
      });
    }

    // Materials stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "MATERIALS_LOADING", currentStage: "materials" },
    });

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const materialFile = join(workDir, `scene-${i}.mp4`);

      if (scene.materialId) {
        const material = await prisma.material.findUnique({
          where: { id: scene.materialId },
        });
        if (material) {
          try {
            const res = await fetch(material.fileUrl);
            if (res.ok) {
              const ext = material.type === "VIDEO" ? "mp4" : "jpg";
              const localPath = join(workDir, `src-${i}.${ext}`);
              await writeFile(localPath, Buffer.from(await res.arrayBuffer()));

              if (ext === "jpg") {
                await execFileAsync("ffmpeg", [
                  "-y", "-loop", "1", "-i", localPath,
                  "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p",
                  "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
                  "-an", materialFile,
                ], { timeout: 30000 }).catch(() => {});
              } else {
                await execFileAsync("ffmpeg", [
                  "-y", "-i", localPath,
                  "-c:v", "libx264", "-preset", "fast",
                  "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
                  "-an", materialFile,
                ], { timeout: 60000 }).catch(() => {});
              }
              continue;
            }
          } catch {}
        }
      }

      // Fallback: black placeholder (long enough, will be trimmed to audio duration)
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i",
        `color=c=black:s=${config.width}x${config.height}:d=60`,
        "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p",
        "-an", materialFile,
      ], { timeout: 15000 }).catch(() => {});
    }

    // Compose stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "COMPOSITING", currentStage: "compose" },
    });

    const outputName = `${randomUUID()}.mp4`;
    const outputDir = join(process.cwd(), "uploads", projectId, "output");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, outputName);

    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    let totalDuration = 0; // accumulated actual audio durations

    for (let i = 0; i < scenes.length; i++) {
      const materialFile = join(workDir, `scene-${i}.mp4`);
      const audioFile = join(workDir, `tts-${i}.mp3`);

      // Ensure files exist
      let hasMaterial = true;
      try { await readFile(materialFile); } catch { hasMaterial = false; }
      if (!hasMaterial) {
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i",
          `color=c=black:s=${config.width}x${config.height}:d=5`,
          "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p",
          "-an", materialFile,
        ], { timeout: 15000 });
      }

      let hasAudio = true;
      try { await readFile(audioFile); } catch { hasAudio = false; }
      if (!hasAudio) {
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
        ], { timeout: 10000 });
      }

      inputArgs.push("-i", materialFile, "-i", audioFile);

      const videoIdx = i * 2;
      const audioIdx = i * 2 + 1;

      // Get actual audio duration for precise video trim + subtitle sync
      const actualAudioDuration = await getAudioDuration(audioFile);
      const audioDuration = actualAudioDuration > 0
        ? actualAudioDuration
        : estimateAudioDuration(scenes[i].voiceoverText);

      // Scale video AND trim to audio duration (prevents gaps/silence)
      filterParts.push(
        `[${videoIdx}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${audioDuration},setpts=PTS-STARTPTS[v${i}]`
      );

      // Normalize audio: boost volume + resample to 44100Hz stereo, trim to actual duration
      filterParts.push(
        `[${audioIdx}:a]volume=2.0,aresample=44100,atrim=0:${audioDuration},asetpts=PTS-STARTPTS[a${i}]`
      );

      // Subtitles: auto-adapt fontsize, line-break by punctuation, sync with actual audio duration
      const subtitleConfig: SubtitleConfig = {
        videoWidth: config.width,
        videoHeight: config.height,
        audioDuration,
      };
      const subtitleChunks = generateSubtitleChunks(scenes[i].voiceoverText, subtitleConfig);
      const { filterParts: subFilters, outputLabel: subLabel } = buildSubtitleFilterChain(
        `v${i}`,
        subtitleChunks,
        subtitleConfig
      );
      filterParts.push(...subFilters);

      // Update scene with actual audio duration for accuracy
      if (actualAudioDuration > 0) {
        await prisma.scene.update({
          where: { id: scenes[i].id },
          data: { audioDuration: actualAudioDuration },
        });
      }

      totalDuration += audioDuration;

      concatInputs.push(`[${subLabel}][a${i}]`);
    }

    if (concatInputs.length === 0) throw new Error("No scenes to compose");

    filterParts.push(
      `${concatInputs.join("")}concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`
    );

    let finalAudioMap = "[outa]";

    // Background music
    if (project.musicTracks.length > 0) {
      const music = project.musicTracks[0];
      if (music.fileUrl) {
        const musicFile = join(workDir, "bgm.mp3");
        try {
          const res = await fetch(music.fileUrl);
          if (res.ok) {
            await writeFile(musicFile, Buffer.from(await res.arrayBuffer()));
            inputArgs.push("-i", musicFile);
            const musicIdx = scenes.length * 2;

            filterParts.push(
              `[${musicIdx}:a]volume=${music.volume},afade=t=in:st=0:d=${music.fadeIn},afade=t=out:st=${totalDuration - music.fadeOut}:d=${music.fadeOut}[bgm]`
            );
            filterParts.push(
              `[outa][bgm]amix=inputs=2:duration=first:dropout_transition=2[finala]`
            );
            finalAudioMap = "[finala]";
          }
        } catch {}
      }
    }

    await execFileAsync("ffmpeg", [
      "-y", ...inputArgs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]", "-map", finalAudioMap,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-r", String(config.fps),
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 600000 });

    // Get duration
    let duration = 0;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
      ], { timeout: 10000 });
      duration = parseFloat(stdout.trim());
    } catch {}

    const outputUrl = `/api/uploads/${projectId}/output/${outputName}`;
    const videoBuffer = await readFile(outputPath);

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: "COMPLETED",
        outputUrl,
        outputFormat: config.format,
        outputSize: videoBuffer.length,
        outputDuration: duration,
        completedAt: new Date(),
        progress: 100,
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "COMPLETED" },
    });

    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return { outputUrl, duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "FAILED", errorMessage: message },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "FAILED" },
    });
    throw error;
  }
}
