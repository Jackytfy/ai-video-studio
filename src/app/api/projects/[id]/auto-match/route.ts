import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { generateAI } from "@/lib/ai/router";
import { decryptSecret } from "@/lib/utils/crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId } = await params;
  const body = await req.json();
  const { script } = body;

  if (!script) {
    return NextResponse.json({ error: "未提供文案内容" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    const prompt = `你是一个专业的视频制作AI助手。分析以下视频文案，进行智能场景拆分和素材匹配。

文案内容：
${script}

请完成以下任务：
1. 将文案拆分为多个场景（每个场景15-30秒为宜）
2. 为每个场景确定：标题、配音文案、视觉描述、素材搜索关键词、情绪氛围
3. 推荐整体的背景音乐风格

请以JSON格式返回：
{
  "title": "视频标题",
  "totalDuration": 预估总时长秒数,
  "mood": "整体情绪",
  "genre": "推荐音乐类型",
  "matches": [
    {
      "sceneId": "scene_1",
      "sceneNumber": 1,
      "sceneTitle": "场景标题",
      "voiceoverText": "该场景的配音文案",
      "suggestedMaterial": "建议的素材类型描述",
      "suggestedMood": "该场景的情绪",
      "keywords": ["关键词1", "关键词2", "关键词3"]
    }
  ]
}

只返回JSON，不要其他文字。`;

    const result = await generateAI({
      provider: (user?.aiProvider as any) || "claude",
      model: user?.aiModel,
      baseUrl: user?.aiBaseUrl || undefined,
      apiKey: decryptSecret(user?.aiApiKey) || undefined,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 3000,
    });

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 分析失败" },
        { status: 500 }
      );
    }

    const data = JSON.parse(jsonMatch[0]);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Auto-match error:", error);
    return NextResponse.json(
      { error: "智能匹配失败" },
      { status: 500 }
    );
  }
}
