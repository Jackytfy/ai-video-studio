import "dotenv/config";
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const execFileAsync = promisify(execFile);

// --- S3 client ---
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
  },
});
const BUCKET = process.env.S3_BUCKET || "ai-video-studio";

async function uploadToS3(buffer: Buffer, contentType: string, folder: string): Promise<string> {
  const ext = contentType.split("/")[1] || "bin";
  const key = `${folder}/${randomUUID()}.${ext}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 86400 });
}

// --- Prisma ---
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// --- Redis ---
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// --- Scene data type ---
interface SceneData {
  id: string;
  sceneNumber: number;
  voiceoverText: string;
  visualDesc: string;
  audioUrl: string | null;
  materialId: string | null;
  transition: string;
}

interface RenderJobData {
  jobId: string;
  projectId: string;
  userId: string;
  config: { width: number; height: number; fps: number; format: string };
  scenes: SceneData[];
}

// --- MiMo TTS helper ---
async function generateMiMoTTS(text: string, voice: string, apiKey: string, baseUrl: string): Promise<Buffer> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      messages: [{ role: "assistant", content: text }],
      audio: { format: "wav", voice },
    }),
  });
  if (!res.ok) throw new Error(`MiMo TTS error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const audioData = data.choices?.[0]?.message?.audio?.data;
  if (!audioData) throw new Error("MiMo TTS: no audio data");
  return Buffer.from(audioData, "base64");
}

// --- Stage: TTS ---
async function processTTS(job: Job<RenderJobData>) {
  const { scenes, jobId, userId } = job.data;
  await prisma.renderJob.update({ where: { id: jobId }, data: { status: "TTS_GENERATING", currentStage: "tts" } });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ttsProvider: true, ttsVoice: true, aiBaseUrl: true, aiApiKey: true },
  });

  const isMiMo = user?.ttsProvider === "mimo";
  const mimoVoice = user?.ttsVoice || "冰糖";
  const mimoApiKey = user?.aiApiKey || process.env.MIMO_API_KEY || "";
  const mimoBaseUrl = user?.aiBaseUrl || "https://token-plan-cn.xiaomimimo.com/v1";
  const edgeVoice = user?.ttsVoice || "zh-CN-YunxiNeural";

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.audioUrl) continue;

    await job.updateProgress({ stage: "TTS_GENERATING", progress: ((i + 1) / scenes.length) * 100 });

    if (isMiMo) {
      const buffer = await generateMiMoTTS(scene.voiceoverText, mimoVoice, mimoApiKey, mimoBaseUrl);
      const url = await uploadToS3(buffer, "audio/wav", "tts");
      scene.audioUrl = url;
      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioUrl: url, audioDuration: scene.voiceoverText.length / 4 },
      });
    } else {
      const tmpFile = join(tmpdir(), `tts-${randomUUID()}.mp3`);
      try {
        await execFileAsync("python", [
          "-m", "edge_tts",
          "--voice", edgeVoice,
          "--rate", "+0%",
          "--volume", "+0%",
          "--text", scene.voiceoverText,
          "--write-media", tmpFile,
        ], { timeout: 30000 });

        const buffer = await readFile(tmpFile);
        const url = await uploadToS3(buffer, "audio/mpeg", "tts");
        scene.audioUrl = url;
        await prisma.scene.update({
          where: { id: scene.id },
          data: { audioUrl: url, audioDuration: scene.voiceoverText.length / 4 },
        });
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    }
  }
}

// --- Stage: Materials ---
async function processMaterials(job: Job<RenderJobData>) {
  const { scenes, jobId, projectId } = job.data;
  await prisma.renderJob.update({ where: { id: jobId }, data: { status: "MATERIALS_LOADING", currentStage: "materials" } });

  const workDir = join(tmpdir(), `render-${projectId}`);
  await mkdir(workDir, { recursive: true });

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    await job.updateProgress({ stage: "MATERIALS_LOADING", progress: ((i + 1) / scenes.length) * 100 });

    if (!scene.materialId) continue;

    const material = await prisma.material.findUnique({ where: { id: scene.materialId } });
    if (!material) continue;

    const ext = material.type === "VIDEO" ? "mp4" : "jpg";
    const localPath = join(workDir, `scene-${i}.${ext}`);
    try {
      const res = await fetch(material.fileUrl);
      if (!res.ok) continue;
      await writeFile(localPath, Buffer.from(await res.arrayBuffer()));
    } catch {
      continue;
    }
  }
}

// --- Stage: Compose ---
async function processCompose(job: Job<RenderJobData>) {
  const { scenes, config, jobId, projectId } = job.data;
  await prisma.renderJob.update({ where: { id: jobId }, data: { status: "COMPOSITING", currentStage: "compose" } });

  const workDir = join(tmpdir(), `render-${projectId}`);
  const outputPath = join(workDir, `output.${config.format}`);

  const filterParts: string[] = [];
  const inputArgs: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const materialFile = join(workDir, `scene-${i}.mp4`);
    const audioFile = join(workDir, `tts-${i}.mp3`);

    // Download audio from S3 URL
    if (scene.audioUrl) {
      try {
        const res = await fetch(scene.audioUrl);
        if (res.ok) await writeFile(audioFile, Buffer.from(await res.arrayBuffer()));
      } catch {}
    }

    // Ensure material file exists
    let hasMaterial = true;
    try { await readFile(materialFile); } catch { hasMaterial = false; }

    if (!hasMaterial) {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", `color=c=black:s=${config.width}x${config.height}:d=5`,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "5", "-c:v", "libx264", "-c:a", "aac", materialFile,
      ], { timeout: 30000 });
    }

    // Ensure audio file exists
    let hasAudio = true;
    try { await readFile(audioFile); } catch { hasAudio = false; }

    if (!hasAudio) {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "5", "-c:a", "aac", audioFile,
      ], { timeout: 10000 });
    }

    inputArgs.push("-i", materialFile, "-i", audioFile);

    const videoIdx = i * 2;
    const audioIdx = i * 2 + 1;

    filterParts.push(
      `[${videoIdx}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
    );

    concatInputs.push(`[v${i}][${audioIdx}:a]`);
  }

  if (concatInputs.length === 0) throw new Error("No scenes to compose");

  filterParts.push(
    `${concatInputs.join("")}concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`
  );

  await execFileAsync("ffmpeg", [
    "-y", ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    "-r", String(config.fps),
    outputPath,
  ], { timeout: 600000 });

  const videoBuffer = await readFile(outputPath);
  const outputUrl = await uploadToS3(videoBuffer, "video/mp4", "renders");

  await prisma.renderJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      outputUrl,
      outputFormat: config.format,
      outputSize: videoBuffer.length,
      completedAt: new Date(),
      progress: 100,
    },
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "COMPLETED" },
  });

  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

// --- Worker ---
const renderWorker = new Worker<RenderJobData>(
  "render",
  async (job) => {
    const { jobId, projectId } = job.data;
    console.log(`Processing render job ${jobId} for project ${projectId}`);

    try {
      await prisma.renderJob.update({
        where: { id: jobId },
        data: { status: "PREPARING", startedAt: new Date() },
      });

      await processTTS(job);
      await processMaterials(job);
      await processCompose(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await prisma.renderJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: message },
      });
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "FAILED" },
      });
      throw error;
    }
  },
  { connection, concurrency: 2 }
);

renderWorker.on("completed", (job) => {
  console.log(`Render job ${job.id} completed`);
});

renderWorker.on("failed", (job, err) => {
  console.error(`Render job ${job?.id} failed:`, err.message);
});

console.log("Render worker started");
