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
import { searchMaterialsForScene } from "@/lib/materials/search-engine";

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
        // Edge TTS with robust fallback
        let ttsOk = false;
        try {
          await execFileAsync("python", [
            "-m", "edge_tts",
            "--voice", edgeVoice,
            "--rate", "+0%",
            "--volume", "+0%",
            "--text", scene.voiceoverText,
            "--write-media", audioFile,
          ], { timeout: 60000 });
          ttsOk = true;
        } catch (e) {
          console.error(`[Render] TTS failed for scene ${i}:`, e instanceof Error ? e.message : e);
        }
        
        if (!ttsOk) {
          try {
            await execFileAsync("ffmpeg", [
              "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
              "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
            ], { timeout: 10000 });
          } catch (ffErr) {
            console.error(`[Render] Silent audio fallback failed for scene ${i}:`, ffErr);
            // Last resort: write minimal silent mp3 via Node
            const { writeFile } = await import("fs/promises");
            // Minimal valid MP3 frame (silence, 44100Hz stereo)
            const silentMp3 = Buffer.from([
              0xFF,0xFB,0x90,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
              0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
              0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            ]);
            await writeFile(audioFile, silentMp3).catch(() => {});
          }
        }
      }

      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioUrl: audioFile, audioDuration: estimateAudioDuration(scene.voiceoverText) },
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
      let materialLoaded = false;

      // Auto-search materials if none attached
      if (!scene.materialId && scene.materialQuery) {
        try {
          console.log(`[Render] Scene ${i} auto-searching materials: "${scene.materialQuery.slice(0, 50)}"`);
          const searchResults = await searchMaterialsForScene({
            sceneNumber: scene.sceneNumber,
            materialQuery: scene.materialQuery,
            visualDesc: scene.visualDesc || undefined,
          }, 1);

          if (searchResults.length > 0) {
            const best = searchResults[0];
            const material = await prisma.material.create({
              data: {
                projectId,
                name: `${best.platform}_${best.externalId}`,
                type: best.type,
                source: best.source,
                fileUrl: best.fileUrl,
                thumbnailUrl: best.thumbnailUrl || undefined,
                width: best.width,
                height: best.height,
                duration: best.duration || null,
                externalId: best.externalId,
                externalSource: best.platform,
                searchQuery: best.searchQuery,
                matchScore: best.matchScore,
              },
            });

            // Attach material to scene
            await prisma.scene.update({
              where: { id: scene.id },
              data: { materialId: material.id },
            });

            scene.materialId = material.id;
            console.log(`[Render] Scene ${i} auto-matched: ${best.platform} ${best.type} (score: ${best.matchScore.toFixed(2)})`);
          }
        } catch (err) {
          console.warn(`[Render] Scene ${i} auto-search failed:`, err instanceof Error ? err.message : err);
        }
      }

      if (scene.materialId) {
        const material = await prisma.material.findUnique({
          where: { id: scene.materialId },
        });
        if (material) {
          const ext = material.type === "VIDEO" ? "mp4" : "jpg";
          const localPath = join(workDir, `src-${i}.${ext}`);

          // Try download with retry (Pexels CDN can be flaky)
          for (let attempt = 0; attempt < 3 && !materialLoaded; attempt++) {
            try {
              if (attempt > 0) {
                console.log(`[Render] Scene ${i} material download retry ${attempt}`);
                await new Promise(r => setTimeout(r, 1000 * attempt));
              }

              const res = await fetch(material.fileUrl, {
                signal: AbortSignal.timeout(30000),
                headers: { "User-Agent": "Mozilla/5.0" },
              });

              if (!res.ok) {
                console.warn(`[Render] Scene ${i} material HTTP ${res.status} from ${material.fileUrl.substring(0, 80)}`);
                continue;
              }

              const buffer = Buffer.from(await res.arrayBuffer());
              if (buffer.length < 1000) {
                console.warn(`[Render] Scene ${i} material too small (${buffer.length} bytes)`);
                continue;
              }

              await writeFile(localPath, buffer);
              console.log(`[Render] Scene ${i} material downloaded: ${(buffer.length / 1024).toFixed(0)}KB`);

              // Watermark removal: crop edges for non-stock or watermark-prone sources
              let processedPath = localPath;
              const needsWatermarkRemoval =
                (material.source !== "STOCK_FOOTAGE" && material.source !== "AI_GENERATED") ||
                material.externalSource === "bilibili" ||
                material.externalSource === "douyin";
              if (needsWatermarkRemoval) {
                const cleanPath = join(workDir, `clean-${i}.${ext}`);
                try {
                  await execFileAsync("ffmpeg", [
                    "-y", "-i", localPath,
                    "-vf", "crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02",
                    "-c:v", "libx264", "-preset", "fast", "-q:v", "2",
                    cleanPath,
                  ], { timeout: 30000 });
                  processedPath = cleanPath;
                } catch {}
              }

              // Convert to scene video
              if (ext === "jpg") {
                await execFileAsync("ffmpeg", [
                  "-y", "-loop", "1", "-i", processedPath,
                  "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p",
                  "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
                  "-an", materialFile,
                ], { timeout: 30000 });
              } else {
                await execFileAsync("ffmpeg", [
                  "-y", "-i", processedPath,
                  "-c:v", "libx264", "-preset", "fast",
                  "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
                  "-an", materialFile,
                ], { timeout: 60000 });
              }
              materialLoaded = true;
              console.log(`[Render] Scene ${i} material processed OK`);
            } catch (err) {
              console.error(`[Render] Scene ${i} material attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
            }
          }
        } else {
          console.warn(`[Render] Scene ${i} material record not found: ${scene.materialId}`);
        }
      } else {
        console.warn(`[Render] Scene ${i} has no materialId`);
      }

      if (!materialLoaded) {
        console.warn(`[Render] Scene ${i} using black placeholder`);
        // Use scene title or voiceover text as on-screen text instead of pure black
        const sceneTitle = scene.title || `场景 ${scene.sceneNumber}`;
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i",
          `color=c=0x1a1a2e:s=${config.width}x${config.height}:d=60`,
          "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p",
          "-an", materialFile,
        ], { timeout: 15000 });
      }
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
        try {
          await execFileAsync("ffmpeg", [
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
          ], { timeout: 10000 });
        } catch {
          // Last resort minimal MP3
          const silentMp3 = Buffer.from([
            0xFF,0xFB,0x90,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
          ]);
          await writeFile(audioFile, silentMp3).catch(() => {});
        }
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

      // Subtitles: use productionMeta.scripts for per-script chunking, auto-adapt fontsize
      let scripts: string[] | undefined;
      if (scenes[i].productionMeta) {
        try {
          const meta = JSON.parse(scenes[i].productionMeta as string);
          if (meta.scripts?.length) scripts = meta.scripts;
        } catch {}
      }

      const subtitleConfig: SubtitleConfig = {
        videoWidth: config.width,
        videoHeight: config.height,
        audioDuration,
      };
      const subtitleChunks = generateSubtitleChunks(
        scenes[i].voiceoverText,
        subtitleConfig,
        scripts
      );
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
