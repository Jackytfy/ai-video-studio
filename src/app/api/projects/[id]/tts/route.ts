import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateTTS } from "@/lib/tts/edge-tts";
import { generateMiMoTTS } from "@/lib/tts/mimo-tts";
import { uploadBuffer } from "@/lib/storage/s3";

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
      aiApiKey: user?.aiApiKey ?? undefined,
    });
    const contentType = user?.ttsProvider === "mimo" ? "audio/wav" : "audio/mpeg";
    const { url } = await uploadBuffer(audioBuffer, contentType, "tts");

    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        audioUrl: url,
        audioDuration: scene.voiceoverText.length / 4,
      },
    });

    return NextResponse.json({ audioUrl: url, duration: scene.voiceoverText.length / 4 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    console.error("TTS error:", error);
    return NextResponse.json({ error: "TTS 生成失败" }, { status: 500 });
  }
}
