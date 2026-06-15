import { NextResponse } from "next/server";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateTTS } from "@/lib/tts/edge-tts";
import { generateMiMoTTS } from "@/lib/tts/mimo-tts";
import { uploadBuffer } from "@/lib/storage/s3";
import { estimateAudioDuration } from "@/lib/render/subtitle";
import { decryptSecret } from "@/lib/utils/crypto";

const execFileAsync = promisify(execFile);

const ttsSchema = z.object({
  sceneId: z.string(),
});

async function generateAudio(text: string, user: {
  ttsProvider?: string;
  ttsVoice?: string;
  aiProvider?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
}): Promise<Buffer> {
  const provider = user.ttsProvider || "edge-tts";

  if (provider === "mimo") {
    return generateMiMoTTS(text, {
      voice: user.ttsVoice || "冰糖",
      apiKey: user.aiApiKey || undefined,
      baseUrl: user.aiBaseUrl || undefined,
    });
  }

  return generateTTS(text, {
    voice: user.ttsVoice || "zh-CN-YunxiNeural",
  });
}

/**
 * Measure actual audio duration using ffprobe.
 * Falls back to estimateAudioDuration() if ffprobe is unavailable.
 */
async function probeAudioDuration(audioBuffer: Buffer): Promise<number> {
  const id = randomUUID();
  // Use appropriate extension: mimo returns WAV, edge_tts returns MP3
  const ext = audioBuffer[0] === 0x52 && audioBuffer[1] === 0x49 ? "wav" : "mp3";
  const tmpFile = join(tmpdir(), `tts-probe-${id}.${ext}`);

  try {
    await writeFile(tmpFile, audioBuffer);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      tmpFile,
    ], { timeout: 5000 });

    const duration = parseFloat(stdout.trim());
    if (!isNaN(duration) && duration > 0) {
      return duration;
    }
  } catch {
    // ffprobe unavailable — fall through to estimate
  } finally {
    await unlink(tmpFile).catch(() => {});
  }

  // Fallback: text-based estimate (less accurate but always available)
  return -1;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;

    const [project, user] = await Promise.all([
      prisma.project.findFirst({ where: { id, userId: session.user.id } }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { ttsProvider: true, ttsVoice: true, aiProvider: true, aiBaseUrl: true, aiApiKey: true },
      }),
    ]);

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const body = await req.json();
    const { sceneId } = ttsSchema.parse(body);

    const scene = await prisma.scene.findFirst({
      where: { id: sceneId, storyboard: { projectId: id } },
    });

    if (!scene) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    const audioBuffer = await generateAudio(scene.voiceoverText, {
      ttsProvider: user?.ttsProvider,
      ttsVoice: user?.ttsVoice,
      aiProvider: user?.aiProvider,
      aiBaseUrl: user?.aiBaseUrl ?? undefined,
      aiApiKey: decryptSecret(user?.aiApiKey) ?? undefined,
    });
    const contentType = user?.ttsProvider === "mimo" ? "audio/wav" : "audio/mpeg";
    const { url } = await uploadBuffer(audioBuffer, contentType, "tts");

    // Use ffprobe for actual audio duration; fall back to text estimate
    let actualDuration = await probeAudioDuration(audioBuffer);
    if (actualDuration <= 0) {
      actualDuration = estimateAudioDuration(scene.voiceoverText);
    }

    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        audioUrl: url,
        audioDuration: actualDuration,
      },
    });

    return NextResponse.json({ audioUrl: url, duration: actualDuration });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("TTS error:", error);
    return NextResponse.json({ error: "TTS 生成失败" }, { status: 500 });
  }
}
