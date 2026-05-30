import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

const PROJECT_ID = "cmprr3blf0000ysulze3nrwjd";
const USER_ID = "cmp3v2aqa0000k8ulak8r79d5";

export async function POST() {
  try {
    console.log("[TEST-RENDER] Starting...");

    const project = await prisma.project.findUnique({
      where: { id: PROJECT_ID },
      include: {
        storyboard: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } },
        musicTracks: { where: { isBgm: true }, take: 1 },
      },
    });

    if (!project || !project.storyboard) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const scenes = project.storyboard.scenes;
    const config = { width: 1920, height: 1080, fps: 30, format: "mp4" };
    const workDir = join(tmpdir(), `render-${PROJECT_ID}`);
    await mkdir(workDir, { recursive: true });

    // Create render job
    const renderJob = await prisma.renderJob.create({
      data: { projectId: PROJECT_ID, userId: USER_ID, status: "PREPARING", config: JSON.stringify(config), startedAt: new Date() },
    });

    await prisma.project.update({ where: { id: PROJECT_ID }, data: { status: "RENDERING" } });

    // TTS stage
    await prisma.renderJob.update({ where: { id: renderJob.id }, data: { status: "TTS_GENERATING", currentStage: "tts" } });
    console.log("[TEST-RENDER] TTS stage");

    const user = await prisma.user.findUnique({ where: { id: USER_ID } });
    const mimoVoice = user?.ttsVoice || "冰糖";
    const mimoApiKey = process.env.MIMO_API_KEY || "";
    const mimoBaseUrl = "https://token-plan-cn.xiaomimimo.com/v1";

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const audioFile = join(workDir, `tts-${i}.mp3`);

      try {
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
            console.log(`[TEST-RENDER] Scene ${i} TTS OK`);
          } else {
            throw new Error("No audio data");
          }
        } else {
          throw new Error(`API ${res.status}`);
        }
      } catch (e) {
        console.log(`[TEST-RENDER] Scene ${i} TTS fallback: ${e.message}`);
        await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile], { timeout: 10000 });
      }

      await prisma.scene.update({ where: { id: scene.id }, data: { audioUrl: audioFile, audioDuration: scene.voiceoverText.length / 4 } });
    }

    // Materials stage
    await prisma.renderJob.update({ where: { id: renderJob.id }, data: { status: "MATERIALS_LOADING", currentStage: "materials" } });
    console.log("[TEST-RENDER] Materials stage");

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const materialFile = join(workDir, `scene-${i}.mp4`);

      if (scene.materialId) {
        const material = await prisma.material.findUnique({ where: { id: scene.materialId } });
        if (material) {
          try {
            const res = await fetch(material.fileUrl);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const localPath = join(workDir, `src-${i}.mp4`);
              await writeFile(localPath, buf);
              console.log(`[TEST-RENDER] Scene ${i} downloaded ${buf.length} bytes`);

              await execFileAsync("ffmpeg", [
                "-y", "-i", localPath,
                "-c:v", "libx264", "-preset", "fast",
                "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
                "-an", materialFile,
              ], { timeout: 120000 });
              console.log(`[TEST-RENDER] Scene ${i} material OK`);
              continue;
            }
          } catch (e) {
            console.log(`[TEST-RENDER] Scene ${i} material error: ${e.message}`);
          }
        }
      }

      // Fallback
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=black:s=${config.width}x${config.height}:d=5`, "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p", "-an", materialFile], { timeout: 15000 });
      console.log(`[TEST-RENDER] Scene ${i} placeholder`);
    }

    // Compose stage
    await prisma.renderJob.update({ where: { id: renderJob.id }, data: { status: "COMPOSITING", currentStage: "compose" } });
    console.log("[TEST-RENDER] Compose stage");

    const outputName = `${randomUUID()}.mp4`;
    const outputDir = join(process.cwd(), "uploads", PROJECT_ID, "output");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, outputName);

    const inputArgs = [];
    const filterParts = [];
    const concatInputs = [];

    for (let i = 0; i < scenes.length; i++) {
      inputArgs.push("-i", join(workDir, `scene-${i}.mp4`), "-i", join(workDir, `tts-${i}.mp3`));
      const videoIdx = i * 2;
      const audioIdx = i * 2 + 1;

      // Scale video
      filterParts.push(`[${videoIdx}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);

      // Normalize audio: boost volume + resample
      filterParts.push(`[${audioIdx}:a]volume=2.0,aresample=44100,atrim=0:${scenes[i].voiceoverText.length / 4}[a${i}]`);

      // Add subtitles with Chinese font (apply to scaled video)
      // Split long text into multiple lines for readability
      const fullText = scenes[i].voiceoverText.replace(/'/g, "").replace(/\n/g, " ");
      const subtitleLines = [];
      for (let j = 0; j < fullText.length; j += 20) {
        subtitleLines.push(fullText.substring(j, j + 20));
      }
      const subtitleText = subtitleLines.join("\\n");
      const fontPath = process.platform === "win32"
        ? "C\\:/Windows/Fonts/msyh.ttc"
        : "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
      const voiceDuration = scenes[i].voiceoverText.length / 4;
      // Bigger font (48), bottom center, with background box, show only during voiceover
      filterParts.push(`[v${i}]drawtext=fontfile='${fontPath}':text='${subtitleText}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h-text_h-60:box=1:boxcolor=black@0.4:boxborderw=15:enable='between(t,0,${voiceDuration})'[v${i}sub]`);

      concatInputs.push(`[v${i}sub][a${i}]`);
    }

    filterParts.push(`${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=1[outv][outa]`);

    console.log("[TEST-RENDER] Running FFmpeg...");
    await execFileAsync("ffmpeg", [
      "-y", ...inputArgs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-r", String(config.fps),
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 600000 });

    console.log("[TEST-RENDER] FFmpeg done!");

    const videoBuffer = await readFile(outputPath);
    const outputUrl = `/api/uploads/${PROJECT_ID}/output/${outputName}`;

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "COMPLETED", outputUrl, outputFormat: "mp4", outputSize: videoBuffer.length, completedAt: new Date(), progress: 100 },
    });

    await prisma.project.update({ where: { id: PROJECT_ID }, data: { status: "COMPLETED" } });

    console.log("[TEST-RENDER] DONE!");

    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return NextResponse.json({
      success: true,
      outputUrl,
      size: `${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`,
    });
  } catch (error) {
    console.error("[TEST-RENDER] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
